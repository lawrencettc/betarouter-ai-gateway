import { getProviderEnvConfig, getProviderEnvVar } from "@betarouter/models";

import {
	fixedPricesToPriceMap,
	resolveMappingPrice,
	sourceMappingPricesToPriceMap,
} from "./pricing.js";
import {
	applySourceOverridesToRow,
	applySourceUpdateToRow,
	createdMappingSourceRow,
	createdModelSourceRow,
	createdProviderSourceRow,
} from "./source-operations.js";
import {
	catalogCredentialConfigurationProfile,
	catalogMappingProfileForOutputs,
	catalogMappingTestProfile,
} from "./test-target.js";

import type { CatalogBreakerState, CatalogResolverInput } from "./catalog.js";
import type {
	CatalogPolicyState,
	CatalogSourceCreate,
	CatalogSourceUpdate,
} from "./change-set.js";
import type { SourceMappingPriceFields } from "./pricing.js";
import type { MappingPricingTier } from "@betarouter/db/schema";
import type { Provider } from "@betarouter/models";

export interface CatalogProviderRowInput {
	id: string;
	status: "active" | "inactive";
	source: string;
}

export interface CatalogModelRowInput {
	id: string;
	status: "active" | "inactive";
	source: string;
	name: string;
	family: string;
	aliases: string[];
	output: string[];
	free: boolean;
}

export interface CatalogMappingRowInput extends SourceMappingPriceFields {
	id: string;
	providerId: string;
	modelId: string;
	status: "active" | "inactive";
	source: string;
	externalId: string;
	region: string | null;
	deprecatedAt: Date | null;
	deactivatedAt: Date | null;
	contextSize: number | null;
	maxOutput: number | null;
	streaming: boolean;
	vision: boolean | null;
	reasoning: boolean | null;
	reasoningMaxTokens: boolean;
	tools: boolean | null;
	jsonOutput: boolean;
	jsonOutputSchema: boolean;
	webSearch: boolean;
	supportedParameters: string[] | null;
	pricingTiers: MappingPricingTier[] | null;
	serviceTierMultipliers: Partial<Record<string, number>> | null;
}

export interface CatalogCredentialRowInput {
	id: string;
	provider: string;
	tokenFingerprint: string;
	baseUrl: string | null;
	options: unknown;
	priority: number;
}

export function environmentCredentialAvailable(providerId: string): boolean {
	const envVar = getProviderEnvVar(providerId as Provider);
	if (!envVar || !process.env[envVar]?.trim()) {
		return false;
	}
	const required = getProviderEnvConfig(providerId as Provider)?.required;
	return Object.entries(required ?? {}).every(
		([key, variable]) =>
			key === "apiKey" || !variable || Boolean(process.env[variable]?.trim()),
	);
}

/**
 * The single resolver-input builder behind every effective-catalog
 * computation (store snapshots, admin previews, applied revisions). Keeping
 * one implementation is what guarantees preview checksums match applied
 * revisions — the composition order is fixed here and in
 * `resolveEffectiveCatalog`:
 *
 *   code mirror row → sourceOverrides patch → policy overlay → price policy
 *     → breaker
 *
 * `sourceCreates` lets a change set that creates entities resolve its
 * provisional snapshot before the rows are persisted, using exactly the row
 * values persistence will write; `sourceUpdates` does the same for direct
 * edits to admin-created rows.
 */
export function buildCatalogResolverInput(input: {
	revision: number;
	now?: Date;
	providers: readonly CatalogProviderRowInput[];
	models: readonly CatalogModelRowInput[];
	mappings: readonly CatalogMappingRowInput[];
	state: CatalogPolicyState;
	sourceCreates?: readonly CatalogSourceCreate[];
	sourceUpdates?: readonly CatalogSourceUpdate[];
	credentials: readonly CatalogCredentialRowInput[];
	passedTests: ReadonlySet<string>;
	breakerStates?: Record<string, CatalogBreakerState>;
}): CatalogResolverInput {
	const providerRows: CatalogProviderRowInput[] = [...input.providers];
	const modelRows: CatalogModelRowInput[] = [...input.models];
	const mappingRows: CatalogMappingRowInput[] = [...input.mappings];
	for (const created of input.sourceCreates ?? []) {
		if (created.entityType === "provider") {
			providerRows.push(createdProviderSourceRow(created.create));
		} else if (created.entityType === "model") {
			modelRows.push(createdModelSourceRow(created.create));
		} else {
			mappingRows.push(
				createdMappingSourceRow(created.entityId, created.create),
			);
		}
	}
	for (const updated of input.sourceUpdates ?? []) {
		if (updated.entityType === "provider") {
			const index = providerRows.findIndex(
				(row) => row.id === updated.entityId,
			);
			if (index >= 0) {
				providerRows[index] = applySourceUpdateToRow(
					providerRows[index],
					updated.patch,
				);
			}
		} else if (updated.entityType === "model") {
			const index = modelRows.findIndex((row) => row.id === updated.entityId);
			if (index >= 0) {
				modelRows[index] = applySourceUpdateToRow(
					modelRows[index],
					updated.patch,
				);
			}
		} else {
			const index = mappingRows.findIndex((row) => row.id === updated.entityId);
			if (index >= 0) {
				mappingRows[index] = applySourceUpdateToRow(
					mappingRows[index],
					updated.patch,
				);
			}
		}
	}

	const providers = providerRows.map((row) =>
		applySourceOverridesToRow(
			row,
			input.state.providers[row.id]?.sourceOverrides,
		),
	);
	const models = modelRows.map((row) =>
		applySourceOverridesToRow(row, input.state.models[row.id]?.sourceOverrides),
	);
	const mappings = mappingRows.map((row) =>
		applySourceOverridesToRow(
			row,
			input.state.mappings[row.id]?.sourceOverrides,
		),
	);

	const credentialProviderIds = new Set(
		input.credentials.map((credential) => credential.provider),
	);
	const providerCredentialAvailability = Object.fromEntries(
		providers.map((row) => [
			row.id,
			credentialProviderIds.has(row.id) ||
				environmentCredentialAvailable(row.id),
		]),
	);

	const modelOutputById = new Map(models.map((row) => [row.id, row.output]));
	const mappingReadiness: CatalogResolverInput["mappingReadiness"] = {};
	for (const mapping of mappings) {
		const pricePolicy = input.state.prices[mapping.id]?.policy;
		const sourcePrices = sourceMappingPricesToPriceMap(mapping);
		const prices = pricePolicy
			? resolveMappingPrice({
					sourcePrices,
					policy:
						pricePolicy.mode === "fixed"
							? {
									mode: "fixed",
									fixedPrices: fixedPricesToPriceMap(pricePolicy.fixedPrices),
									allowNegativeMargin: pricePolicy.allowNegativeMargin,
									negativeMarginReason: pricePolicy.negativeMarginReason,
								}
							: pricePolicy.mode === "markup"
								? {
										mode: "markup",
										markupBps: pricePolicy.markupBps,
										allowNegativeMargin: pricePolicy.allowNegativeMargin,
										negativeMarginReason: pricePolicy.negativeMarginReason,
									}
								: { mode: "source_cost" },
				})
			: null;
		const mappingPolicy = input.state.mappings[mapping.id];
		const testedCredential = input.credentials
			.filter((credential) => credential.provider === mapping.providerId)
			.sort(
				(left, right) =>
					left.priority - right.priority || left.id.localeCompare(right.id),
			)
			.find((credential) => {
				const profile = catalogMappingTestProfile({
					mappingId: mapping.id,
					providerId: mapping.providerId,
					region: mapping.region,
					externalId: mappingPolicy?.externalIdOverride ?? mapping.externalId,
					contextSizeLimit: mappingPolicy?.contextSizeLimit,
					maxOutputLimit: mappingPolicy?.maxOutputLimit,
					disabledCapabilities: mappingPolicy?.disabledCapabilities,
					credentialId: credential.id,
					credentialFingerprint: credential.tokenFingerprint,
					baseUrl: credential.baseUrl,
					credentialOptions: credential.options,
					// Modality-specific probe: an embeddings mapping is satisfied only
					// by a passed minimal-embeddings run, never by a chat probe.
					profile:
						catalogMappingProfileForOutputs(
							modelOutputById.get(mapping.modelId) ?? [],
						) ?? undefined,
				});
				return input.passedTests.has(`${mapping.id}:${profile}`);
			});
		mappingReadiness[mapping.id] = {
			priceReady: prices?.ready ?? false,
			testPassed: testedCredential !== undefined,
			platformCredentialId: testedCredential?.id ?? null,
			platformCredentialProfile: testedCredential
				? catalogCredentialConfigurationProfile({
						credentialId: testedCredential.id,
						credentialFingerprint: testedCredential.tokenFingerprint,
						baseUrl: testedCredential.baseUrl,
						credentialOptions: testedCredential.options,
					})
				: null,
			sourcePrices,
			customerPrices: prices?.customerPrices ?? {},
			margin: prices?.margin ?? {},
			pricingMode: pricePolicy?.mode ?? null,
			markupBps: pricePolicy?.mode === "markup" ? pricePolicy.markupBps : null,
		};
	}

	return {
		revision: input.revision,
		now: input.now ?? new Date(),
		providers: providers.map((row) => ({ id: row.id, status: row.status })),
		models: models.map((row) => ({
			id: row.id,
			status: row.status,
			name: row.name,
			family: row.family,
			aliases: row.aliases,
			output: row.output,
			free: row.free,
		})),
		mappings: mappings.map((row) => ({
			id: row.id,
			providerId: row.providerId,
			modelId: row.modelId,
			status: row.status,
			externalId: row.externalId,
			region: row.region,
			deprecatedAt: row.deprecatedAt,
			deactivatedAt: row.deactivatedAt,
			contextSize: row.contextSize,
			maxOutput: row.maxOutput,
			streaming: row.streaming,
			vision: row.vision,
			reasoning: row.reasoning,
			reasoningMaxTokens: row.reasoningMaxTokens,
			tools: row.tools,
			jsonOutput: row.jsonOutput,
			jsonOutputSchema: row.jsonOutputSchema,
			webSearch: row.webSearch,
			supportedParameters: row.supportedParameters,
			pricingTiers: row.pricingTiers,
			serviceTierMultipliers: row.serviceTierMultipliers,
		})),
		providerPolicies: Object.values(input.state.providers).map((item) => ({
			providerId: item.providerId,
			visible: item.visible,
			enabled: item.enabled,
			lifecycle: item.lifecycle,
			deprecatedAt: item.deprecatedAt ? new Date(item.deprecatedAt) : null,
			retireAt: item.retireAt ? new Date(item.retireAt) : null,
		})),
		modelPolicies: Object.values(input.state.models).map((item) => ({
			modelId: item.modelId,
			visible: item.visible,
			enabled: item.enabled,
			allowDirect: item.allowDirect,
			lifecycle: item.lifecycle,
			deprecatedAt: item.deprecatedAt ? new Date(item.deprecatedAt) : null,
			retireAt: item.retireAt ? new Date(item.retireAt) : null,
			replacementModelId: item.replacementModelId,
			retirementMessage: item.retirementMessage,
		})),
		mappingPolicies: Object.values(input.state.mappings).map((item) => ({
			mappingId: item.mappingId,
			enabled: item.enabled,
			priority: item.priority ?? 100,
			weight: item.weight ?? 100,
			breakerEnabled: item.breakerEnabled ?? true,
			externalIdOverride: item.externalIdOverride,
			contextSizeLimit: item.contextSizeLimit,
			maxOutputLimit: item.maxOutputLimit,
			disabledCapabilities: item.disabledCapabilities,
		})),
		providerCredentialAvailability,
		mappingReadiness,
		breakerStates: input.breakerStates ?? {},
	};
}
