import { HTTPException } from "hono/http-exception";

import {
	calculateUptimePenalty,
	getKeyMetrics,
	isKeyHealthy,
} from "@/lib/api-key-health.js";
import { findActivePlatformProviderCredentials } from "@/lib/cached-queries.js";
import {
	getRoundRobinValue,
	parseCommaSeparatedEnv,
	peekRoundRobinValue,
} from "@/lib/round-robin-env.js";

import { providerKeyBaseUrlSupportsServiceTier } from "@betarouter/actions";
import { catalogCredentialConfigurationProfile } from "@betarouter/catalog";
import {
	decryptPlatformProviderToken,
	isPlatformProviderCryptoConfigured,
} from "@betarouter/db";
import {
	type EnvVarVariant,
	getProviderEnvValue,
	getProviderEnvVar,
	getProviderEnvConfig,
	getVariantEnvVarName,
	type Provider,
} from "@betarouter/models";
import { assertSafeProviderUrl } from "@betarouter/shared/url-safety-node";

import type { ProviderKeyOptions } from "@betarouter/db";

export interface ProviderEnvResult {
	token: string;
	configIndex: number;
	envVarName: string;
	baseUrl?: string;
	options?: ProviderKeyOptions;
	credentialId?: string;
	source: "database" | "environment";
}

const platformCredentialCounts = new Map<string, number>();

function getPlatformSourceName(provider: Provider): string {
	return `platform-provider:${provider}`;
}

function selectPlatformCredentialIndex(
	sourceName: string,
	priorities: readonly number[],
	selectionScope?: string,
	excludedIndices: ReadonlySet<number> = new Set(),
): number | undefined {
	const candidates = priorities
		.map((priority, index) => ({ index, priority }))
		.filter(({ index }) => !excludedIndices.has(index));
	const priorityBuckets = [
		...new Set(candidates.map((item) => item.priority)),
	].sort((a, b) => a - b);

	for (const priority of priorityBuckets) {
		const healthy = candidates
			.filter(
				(item) =>
					item.priority === priority &&
					isKeyHealthy(sourceName, item.index, selectionScope),
			)
			.sort((a, b) => {
				const aPenalty = calculateUptimePenalty(
					getKeyMetrics(sourceName, a.index, selectionScope).uptime,
				);
				const bPenalty = calculateUptimePenalty(
					getKeyMetrics(sourceName, b.index, selectionScope).uptime,
				);
				return aPenalty - bPenalty || a.index - b.index;
			});
		if (healthy[0]) {
			return healthy[0].index;
		}
	}

	// If every configured key is temporarily unhealthy, preserve deterministic
	// priority order and let the upstream attempt decide whether it has recovered.
	return candidates.sort(
		(a, b) => a.priority - b.priority || a.index - b.index,
	)[0]?.index;
}

function getEnvCredentialCount(
	provider: Provider,
	variant?: EnvVarVariant,
): number {
	const envVar =
		getVariantEnvVarName(provider, variant) ?? getProviderEnvVar(provider);
	const value = envVar ? process.env[envVar] : undefined;
	if (!value) {
		return 0;
	}
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0).length;
}

/**
 * Whether a single env credential index can carry a Flex/Priority service-tier
 * request. Requires:
 * - an eligible base URL (managed default / canonical upstream, not a proxy);
 * - for google-vertex, a global region — Flex/Priority PayGo is served only on
 *   the global endpoint, and a non-global index would have its tier header
 *   dropped by getForwardedServiceTier and be silently served as standard.
 *
 * Base URL and region are comma-indexed in lockstep with the API-key env var,
 * so this is evaluated per index.
 */
function isServiceTierEligibleEnvIndex(
	provider: Provider,
	index: number,
	variant?: EnvVarVariant,
): boolean {
	const baseUrl = getProviderEnvValue(
		provider,
		"baseUrl",
		index,
		undefined,
		variant,
	);
	if (!providerKeyBaseUrlSupportsServiceTier(provider, baseUrl)) {
		return false;
	}
	if (provider === "google-vertex") {
		const region = getProviderEnvValue(
			provider,
			"region",
			index,
			"global",
			variant,
		);
		if (region !== "global") {
			return false;
		}
	}
	return true;
}

/**
 * Env credential indices that are NOT eligible to carry a Flex/Priority
 * service-tier request. Used to exclude those indices from round-robin
 * selection so a service-tier request lands on a credential that hits the real
 * upstream on a tier-capable endpoint.
 */
export function getServiceTierIneligibleEnvIndices(
	provider: Provider,
	variant?: EnvVarVariant,
): Set<number> {
	const ineligible = new Set<number>();
	const count = getEnvCredentialCount(provider, variant);
	for (let index = 0; index < count; index++) {
		if (!isServiceTierEligibleEnvIndex(provider, index, variant)) {
			ineligible.add(index);
		}
	}
	return ineligible;
}

/**
 * Whether at least one env credential for the provider targets an upstream
 * endpoint eligible for service-tier requests.
 */
export function hasServiceTierEligibleEnvCredential(
	provider: Provider,
	variant?: EnvVarVariant,
): boolean {
	const count = getEnvCredentialCount(provider, variant);
	for (let index = 0; index < count; index++) {
		if (isServiceTierEligibleEnvIndex(provider, index, variant)) {
			return true;
		}
	}
	return false;
}

interface GetProviderEnvOptions {
	advanceRoundRobin?: boolean;
	excludedIndices?: ReadonlySet<number>;
	selectionScope?: string;
	/**
	 * Plan-scoped env-var variant (`__ENTERPRISE` / `__PLANS`). Only consulted
	 * when no platform credential is configured for the provider.
	 */
	variant?: EnvVarVariant;
	requireServiceTierSupport?: boolean;
	/** Select only the encrypted credential proven by the active catalog mapping. */
	requiredCredentialId?: string;
	requiredCredentialProfile?: string;
}

/**
 * Get provider token from environment variables with round-robin support
 * Supports comma-separated values in environment variables for load balancing
 * @param usedProvider The provider to get the token for
 * @returns Object containing the token and the config index used
 */
export async function getProviderEnv(
	usedProvider: Provider,
	options: GetProviderEnvOptions = {},
): Promise<ProviderEnvResult> {
	const platformCredentials = isPlatformProviderCryptoConfigured()
		? await findActivePlatformProviderCredentials(usedProvider)
		: [];
	if (platformCredentials.length > 0) {
		const sourceName = getPlatformSourceName(usedProvider);
		platformCredentialCounts.set(sourceName, platformCredentials.length);
		const excludedPlatformIndices = new Set(options.excludedIndices ?? []);
		if (options.requireServiceTierSupport) {
			platformCredentials.forEach((credential, index) => {
				if (
					!providerKeyBaseUrlSupportsServiceTier(
						usedProvider,
						credential.baseUrl,
					)
				) {
					excludedPlatformIndices.add(index);
				}
			});
		}
		const requiredIndex = options.requiredCredentialId
			? platformCredentials.findIndex(
					(credential) => credential.id === options.requiredCredentialId,
				)
			: undefined;
		if (requiredIndex === -1) {
			throw new HTTPException(503, {
				message: `The tested platform credential is no longer active for provider: ${usedProvider}`,
			});
		}
		if (
			requiredIndex !== undefined &&
			excludedPlatformIndices.has(requiredIndex)
		) {
			throw new HTTPException(503, {
				message: `The tested platform credential is not eligible for this request: ${usedProvider}`,
			});
		}
		const selectedIndex =
			requiredIndex ??
			selectPlatformCredentialIndex(
				sourceName,
				platformCredentials.map((credential) => credential.priority),
				options.selectionScope,
				excludedPlatformIndices,
			);
		const selected =
			selectedIndex === undefined
				? undefined
				: platformCredentials[selectedIndex];
		if (!selected) {
			throw new HTTPException(500, {
				message: `No eligible platform credentials remain for provider: ${usedProvider}`,
			});
		}
		if (
			options.requiredCredentialProfile &&
			catalogCredentialConfigurationProfile({
				credentialId: selected.id,
				credentialFingerprint: selected.tokenFingerprint,
				baseUrl: selected.baseUrl,
				credentialOptions: selected.options,
			}) !== options.requiredCredentialProfile
		) {
			throw new HTTPException(503, {
				message: `The platform credential changed after its catalog test: ${usedProvider}`,
			});
		}
		const resolvedIndex = selectedIndex;
		if (resolvedIndex === undefined) {
			throw new HTTPException(500, {
				message: `No eligible platform credentials remain for provider: ${usedProvider}`,
			});
		}
		if (selected.baseUrl) {
			await assertSafeProviderUrl(selected.baseUrl);
		}
		let token: string;
		try {
			token = decryptPlatformProviderToken(
				selected,
				selected.id,
				selected.provider,
			);
		} catch {
			throw new HTTPException(500, {
				message: "Platform provider credential could not be decrypted",
			});
		}
		return {
			token,
			configIndex: resolvedIndex,
			envVarName: sourceName,
			baseUrl: selected.baseUrl ?? undefined,
			options: selected.options ?? undefined,
			credentialId: selected.id,
			source: "database",
		};
	}
	if (options.requiredCredentialId) {
		throw new HTTPException(503, {
			message: `The tested platform credential is unavailable for provider: ${usedProvider}`,
		});
	}

	const envVar = getProviderEnvVar(usedProvider);
	if (!envVar) {
		throw new HTTPException(500, {
			message: `No environment variable set for provider: ${usedProvider}`,
		});
	}
	// Enterprise-plan orgs use the optional `{BASE}__ENTERPRISE` override and
	// plan-based (DevPass/Chat plan) orgs `{BASE}__PLANS` when set; everyone
	// else (and matching orgs without the override) uses the base env var.
	const effectiveEnvVar =
		getVariantEnvVarName(usedProvider, options.variant) ?? envVar;
	const envValue = process.env[effectiveEnvVar];
	if (!envValue) {
		throw new HTTPException(500, {
			message: `No API key set in environment for provider: ${usedProvider}`,
		});
	}

	// Validate required env vars for the provider
	const config = getProviderEnvConfig(usedProvider);
	if (config?.required) {
		for (const [key, envVarName] of Object.entries(config.required)) {
			if (key === "apiKey" || !envVarName) {
				continue;
			} // Already validated above
			if (!process.env[envVarName]) {
				throw new HTTPException(500, {
					message: `${envVarName} environment variable is required for ${usedProvider} provider`,
				});
			}
		}
	}

	const advanceRoundRobin = options.advanceRoundRobin ?? true;
	const excludedIndices = new Set(options.excludedIndices ?? []);
	if (options.requireServiceTierSupport) {
		for (const index of getServiceTierIneligibleEnvIndices(
			usedProvider,
			options.variant,
		)) {
			excludedIndices.add(index);
		}
	}
	const selectionScope = options.selectionScope;
	const result = advanceRoundRobin
		? getRoundRobinValue(
				effectiveEnvVar,
				envValue,
				selectionScope,
				excludedIndices,
			)
		: peekRoundRobinValue(
				effectiveEnvVar,
				envValue,
				selectionScope,
				excludedIndices,
			);

	return {
		token: result.value,
		configIndex: result.index,
		envVarName: effectiveEnvVar,
		baseUrl: getProviderEnvValue(
			usedProvider,
			"baseUrl",
			result.index,
			undefined,
			options.variant,
		),
		source: "environment",
	};
}

/**
 * Returns the number of comma-separated values configured in the named env
 * var, or 0 if it's unset/empty. Pass the resolved `envVarName` from the
 * provider context — it may be a regional override (e.g. `*__SINGAPORE`)
 * rather than the provider's base var.
 */
export function getEnvKeyCount(envVarName: string | undefined): number {
	if (!envVarName) {
		return 0;
	}
	if (envVarName.startsWith("platform-provider:")) {
		return platformCredentialCounts.get(envVarName) ?? 0;
	}
	const value = process.env[envVarName];
	if (!value) {
		return 0;
	}
	return parseCommaSeparatedEnv(value).length;
}
