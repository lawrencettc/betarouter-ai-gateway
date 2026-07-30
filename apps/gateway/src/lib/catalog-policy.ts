import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import {
	evaluateCatalogRequest,
	getEffectiveCatalogSnapshot,
	readCatalogFeatureFlags,
} from "@betarouter/catalog";
import { logger } from "@betarouter/logger";

import type {
	CatalogRequestDecision,
	CatalogRequestInput,
	EffectiveMapping,
} from "@betarouter/catalog";
import type { ProviderModelMapping } from "@betarouter/models";

interface EnforceCatalogRequestOptions {
	operation: "chat" | "deferred_non_chat";
	setHeader?: (name: string, value: string) => void;
}

// Tenant custom providers are org-owned BYOK endpoints (provider key rows with
// provider "custom", addressed as `custom/<name>/<model>` or `<name>/<model>`).
// They are the customer's own inventory, not operator inventory, so the
// platform catalogue never lists them and must not gate them: enforcing here
// would 404 every custom-provider request the moment catalog routing is
// enabled. Operator-scoped platform providers remain fully governed.
export const TENANT_CUSTOM_PROVIDER_ID = "custom";

export function isTenantCustomProviderId(
	providerId: string | undefined | null,
): boolean {
	return (
		providerId === TENANT_CUSTOM_PROVIDER_ID ||
		providerId?.startsWith(`${TENANT_CUSTOM_PROVIDER_ID}/`) === true
	);
}

export function isCatalogOperationEnabled(
	operation: EnforceCatalogRequestOptions["operation"],
): boolean {
	return operation === "chat";
}

function perUnit(value: string | undefined): string | undefined {
	return value === undefined
		? undefined
		: new Decimal(value).div(1_000_000).toString();
}

export function applyCatalogCustomerPrices(
	provider: ProviderModelMapping,
	mapping: EffectiveMapping,
): ProviderModelMapping {
	const prices = mapping.customerPrices;
	const priceMultiplier =
		mapping.pricingMode === "markup"
			? new Decimal(1).plus(new Decimal(mapping.markupBps ?? 0).div(10_000))
			: null;
	const pricingTiers = provider.pricingTiers?.map((tier) => {
		if (mapping.pricingMode === "source_cost" || !mapping.pricingMode) {
			return tier;
		}
		if (mapping.pricingMode === "markup" && priceMultiplier) {
			return {
				...tier,
				inputPrice: new Decimal(tier.inputPrice)
					.mul(priceMultiplier)
					.toString(),
				outputPrice: new Decimal(tier.outputPrice)
					.mul(priceMultiplier)
					.toString(),
				cachedInputPrice:
					tier.cachedInputPrice === undefined
						? undefined
						: new Decimal(tier.cachedInputPrice)
								.mul(priceMultiplier)
								.toString(),
				cacheReadInputPrice:
					tier.cacheReadInputPrice === undefined
						? undefined
						: new Decimal(tier.cacheReadInputPrice)
								.mul(priceMultiplier)
								.toString(),
				cacheWriteInputPrice:
					tier.cacheWriteInputPrice === undefined
						? undefined
						: new Decimal(tier.cacheWriteInputPrice)
								.mul(priceMultiplier)
								.toString(),
				cacheWriteInputPrice1h:
					tier.cacheWriteInputPrice1h === undefined
						? undefined
						: new Decimal(tier.cacheWriteInputPrice1h)
								.mul(priceMultiplier)
								.toString(),
			};
		}
		return {
			...tier,
			...(perUnit(prices.input) !== undefined && {
				inputPrice: perUnit(prices.input)!,
			}),
			...(perUnit(prices.output) !== undefined && {
				outputPrice: perUnit(prices.output)!,
			}),
			cachedInputPrice: perUnit(prices.cachedInput),
			cacheReadInputPrice: perUnit(prices.cacheRead),
			cacheWriteInputPrice: perUnit(prices.cacheWrite),
			cacheWriteInputPrice1h: perUnit(prices.cacheWrite1h),
		};
	});
	const restrictedCapabilities = Object.fromEntries(
		mapping.disabledCapabilities.map((capability) => [capability, false]),
	) as Partial<ProviderModelMapping>;
	return {
		...provider,
		...restrictedCapabilities,
		catalogPriority: mapping.priority,
		catalogWeight: mapping.weight,
		catalogMappingId: mapping.id,
		platformCredentialId: mapping.platformCredentialId ?? undefined,
		platformCredentialProfile: mapping.platformCredentialProfile ?? undefined,
		contextSize:
			mapping.contextSizeLimit === null
				? provider.contextSize
				: Math.min(
						provider.contextSize ?? mapping.contextSizeLimit,
						mapping.contextSizeLimit,
					),
		maxOutput:
			mapping.maxOutputLimit === null
				? provider.maxOutput
				: Math.min(
						provider.maxOutput ?? mapping.maxOutputLimit,
						mapping.maxOutputLimit,
					),
		externalId: mapping.externalId,
		region: mapping.region ?? undefined,
		inputPrice: perUnit(prices.input),
		outputPrice: perUnit(prices.output),
		cachedInputPrice: perUnit(prices.cachedInput),
		cacheReadInputPrice: perUnit(prices.cacheRead),
		cacheWriteInputPrice: perUnit(prices.cacheWrite),
		cacheWriteInputPrice1h: perUnit(prices.cacheWrite1h),
		imageInputPrice: perUnit(prices.imageInput),
		imageOutputPrice: perUnit(prices.imageOutput),
		inputAudioPrice: perUnit(prices.audioInput),
		cachedImageInputPrice: perUnit(prices.cachedImageInput),
		cachedInputAudioPrice: perUnit(prices.cachedAudioInput),
		outputAudioPrice: perUnit(prices.audioOutput),
		inputCharacterPrice: perUnit(prices.inputCharacters),
		requestPrice: prices.request,
		webSearchPrice: prices.webSearch,
		ocrPagePrice: prices.ocrPage,
		perSecondPrice: Object.fromEntries(
			Object.entries(prices).flatMap(([unit, value]) =>
				unit.startsWith("second:") && value !== undefined
					? [[unit.slice("second:".length), value]]
					: [],
			),
		),
		pricingTiers,
	};
}

export async function enforceCatalogRequest(
	input: CatalogRequestInput,
	options: EnforceCatalogRequestOptions,
): Promise<Extract<CatalogRequestDecision, { allowed: true }> | null> {
	if (!isCatalogOperationEnabled(options.operation)) {
		return null;
	}
	if (input.modelId === "auto" || input.modelId === "custom") {
		return null;
	}
	if (isTenantCustomProviderId(input.providerId)) {
		return null;
	}
	const flags = readCatalogFeatureFlags();
	if (!flags.routingEnabled && !flags.shadowRead) {
		return null;
	}
	const baseSnapshot = await getEffectiveCatalogSnapshot({
		breakerMappingIds: [],
	});
	const baseDecision = evaluateCatalogRequest(baseSnapshot, input);
	const snapshot =
		flags.routingEnabled &&
		flags.breakerMode === "enforce" &&
		baseDecision.allowed
			? await getEffectiveCatalogSnapshot({
					breakerMappingIds: baseDecision.mappingIds,
					claimBreakerProbes: true,
				})
			: baseSnapshot;
	const decision = evaluateCatalogRequest(snapshot, input);
	if (flags.shadowRead) {
		logger.info("Catalog routing decision", {
			mode: flags.routingEnabled ? "enforce" : "shadow",
			revision: snapshot.revision,
			modelId: input.modelId,
			providerId: input.providerId,
			region: input.region,
			allowed: decision.allowed,
			...(decision.allowed
				? { mappingIds: decision.mappingIds }
				: { code: decision.code, status: decision.status }),
		});
	}
	if (!flags.routingEnabled) {
		return null;
	}
	if (!decision.allowed) {
		const body = {
			error: {
				code: decision.code,
				message:
					decision.code === "model_retired"
						? "The requested model has been retired"
						: decision.code === "model_temporarily_unavailable"
							? "The requested model is temporarily unavailable"
							: "The requested model is not available",
				retryable: decision.retryable,
				replacementModelId: decision.replacementModelId,
				retireAt: decision.retireAt,
			},
		};
		throw new HTTPException(decision.status, {
			res: new Response(JSON.stringify(body), {
				status: decision.status,
				headers: {
					"content-type": "application/json",
					...(decision.retryable ? { "retry-after": "60" } : {}),
				},
			}),
		});
	}
	if (decision.deprecated) {
		options.setHeader?.("Deprecation", "true");
		if (decision.retireAt) {
			options.setHeader?.("Sunset", new Date(decision.retireAt).toUTCString());
		}
		if (decision.replacementModelId) {
			options.setHeader?.(
				"BetaRouter-Replacement-Model",
				decision.replacementModelId,
			);
		}
	}
	return decision;
}

export function filterProviderMappingsByCatalog(
	providers: ProviderModelMapping[],
	decision: Extract<CatalogRequestDecision, { allowed: true }> | null,
): ProviderModelMapping[] {
	if (!decision) {
		return providers;
	}
	// Tenant custom providers are never present in the catalogue snapshot (see
	// isTenantCustomProviderId): pass their synthetic mappings through instead of
	// dropping them when a catalogue decision is in play.
	const tenantCustomProviders = providers.filter((provider) =>
		isTenantCustomProviderId(provider.providerId),
	);
	return [
		...tenantCustomProviders,
		...decision.mappings.flatMap((mapping) => {
			const provider = findProviderMappingForCatalogMapping(providers, mapping);
			return provider ? [applyCatalogCustomerPrices(provider, mapping)] : [];
		}),
	];
}

export function findProviderMappingForCatalogMapping(
	providers: readonly ProviderModelMapping[],
	mapping: EffectiveMapping,
): ProviderModelMapping | undefined {
	return (
		providers.find(
			(candidate) =>
				candidate.providerId === mapping.providerId &&
				(candidate.region ?? null) === mapping.region,
		) ??
		providers.find(
			(candidate) =>
				candidate.providerId === mapping.providerId &&
				candidate.region === undefined,
		)
	);
}

export async function filterAutoCandidateByCatalog(
	modelId: string,
	providers: ProviderModelMapping[],
): Promise<{
	providers: ProviderModelMapping[];
	decision: Extract<CatalogRequestDecision, { allowed: true }> | null;
	enforced: boolean;
}> {
	try {
		const decision = await enforceCatalogRequest(
			{ modelId },
			{ operation: "chat" },
		);
		return {
			providers: filterProviderMappingsByCatalog(providers, decision),
			decision,
			enforced: decision !== null,
		};
	} catch (error) {
		if (
			error instanceof HTTPException &&
			new Set([404, 410, 503]).has(error.status)
		) {
			return { providers: [], decision: null, enforced: true };
		}
		throw error;
	}
}

export function findCatalogMappingForProvider(
	decision: Extract<CatalogRequestDecision, { allowed: true }> | null,
	providerId: string | undefined,
	region?: string | null,
): EffectiveMapping | null {
	if (!decision) {
		return null;
	}
	if (!providerId) {
		return null;
	}
	return (
		decision.mappings.find(
			(mapping) =>
				mapping.providerId === providerId &&
				(region === undefined || mapping.region === region),
		) ?? null
	);
}
