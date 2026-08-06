import { createHash } from "node:crypto";

import type { DisabledCatalogCapability } from "./contracts.js";
import type { PriceMap } from "./pricing.js";
import type { MappingPricingTier } from "@betarouter/db/schema";

export type CatalogLifecycle = "draft" | "active" | "deprecated" | "retired";

export interface SourceProvider {
	id: string;
	status: "active" | "inactive";
}

export interface SourceModel {
	id: string;
	status: "active" | "inactive";
	name?: string;
	family?: string;
	aliases?: string[];
	output?: string[];
	free?: boolean;
	imageInputRequired?: boolean;
	maxVideoDurationSeconds?: number | null;
}

export interface SourceMapping {
	id: string;
	providerId: string;
	modelId: string;
	status: "active" | "inactive";
	externalId: string;
	region?: string | null;
	deprecatedAt?: Date | null;
	deactivatedAt?: Date | null;
	contextSize?: number | null;
	maxOutput?: number | null;
	streaming?: boolean;
	vision?: boolean | null;
	reasoning?: boolean | null;
	reasoningMaxTokens?: boolean;
	tools?: boolean | null;
	jsonOutput?: boolean;
	jsonOutputSchema?: boolean;
	webSearch?: boolean;
	supportedParameters?: string[] | null;
	pricingTiers?: MappingPricingTier[] | null;
	serviceTierMultipliers?: Partial<Record<string, number>> | null;
	embeddings?: boolean;
	imageGenerations?: boolean;
	videoGenerations?: boolean;
	speechGenerations?: boolean;
	transcriptions?: boolean;
	realtime?: boolean;
	realtimeTranscription?: boolean;
	ocr?: boolean;
	rerank?: boolean;
	supportedVideoSizes?: string[] | null;
	supportedVideoDurationsSeconds?: number[] | null;
	supportedVideoDurationsSecondsImageToVideo?: number[] | null;
	supportsVideoAudio?: boolean | null;
	supportsVideoWithoutAudio?: boolean | null;
	supportedVoices?: string[] | null;
	/** Flat USD per content-filter violation, mirrored as a decimal string. */
	contentFilterPrice?: string | null;
}

export interface ProviderPolicy {
	providerId: string;
	visible: boolean;
	enabled: boolean;
	lifecycle: CatalogLifecycle;
	deprecatedAt?: Date | null;
	retireAt?: Date | null;
}

export interface ModelPolicy {
	modelId: string;
	visible: boolean;
	enabled: boolean;
	allowDirect: boolean;
	lifecycle: CatalogLifecycle;
	deprecatedAt?: Date | null;
	retireAt?: Date | null;
	replacementModelId?: string | null;
	retirementMessage?: string | null;
}

export interface MappingPolicy {
	mappingId: string;
	enabled: boolean;
	priority: number;
	weight: number;
	breakerEnabled: boolean;
	externalIdOverride?: string | null;
	contextSizeLimit?: number | null;
	maxOutputLimit?: number | null;
	disabledCapabilities?: DisabledCatalogCapability[];
}

export interface MappingReadiness {
	priceReady: boolean;
	testPassed: boolean;
	/** Exact encrypted platform credential whose current configuration passed. */
	platformCredentialId?: string | null;
	platformCredentialProfile?: string | null;
	sourcePrices?: PriceMap;
	customerPrices?: PriceMap;
	margin?: PriceMap;
	pricingMode?: "source_cost" | "markup" | "fixed" | null;
	markupBps?: number | null;
}

export interface CatalogBreakerState {
	state: "closed" | "open" | "half_open";
}

export type MappingEligibilityReason =
	| "source_provider_inactive"
	| "source_model_inactive"
	| "source_mapping_inactive"
	| "source_mapping_deactivated"
	| "provider_policy_missing"
	| "provider_disabled"
	| "provider_retired"
	| "model_policy_missing"
	| "model_disabled"
	| "model_retired"
	| "mapping_policy_missing"
	| "mapping_disabled"
	| "provider_credential_unavailable"
	| "mapping_price_incomplete"
	| "mapping_test_required"
	| "circuit_open"
	| "circuit_half_open";

export interface CatalogResolverInput {
	revision: number;
	now: Date;
	providers: SourceProvider[];
	models: SourceModel[];
	mappings: SourceMapping[];
	providerPolicies: ProviderPolicy[];
	modelPolicies: ModelPolicy[];
	mappingPolicies: MappingPolicy[];
	providerCredentialAvailability: Record<string, boolean>;
	mappingReadiness: Record<string, MappingReadiness>;
	breakerStates: Record<string, CatalogBreakerState>;
}

export interface EffectiveProvider {
	id: string;
	lifecycle: CatalogLifecycle;
	deprecatedAt?: string | null;
	retireAt?: string | null;
	configuredVisible: boolean;
	visible: boolean;
	available: boolean;
}

export interface EffectiveModel {
	id: string;
	lifecycle: CatalogLifecycle;
	configuredVisible: boolean;
	visible: boolean;
	available: boolean;
	allowDirect: boolean;
	replacementModelId: string | null;
	deprecatedAt: string | null;
	retireAt: string | null;
	retirementMessage: string | null;
	// Base model data mirrored from the source row. Optional because
	// snapshots stored before this data existed must still parse.
	name?: string;
	family?: string;
	aliases?: string[];
	output?: string[];
	free?: boolean;
	imageInputRequired?: boolean;
	maxVideoDurationSeconds?: number | null;
}

export interface EffectiveMapping {
	id: string;
	providerId: string;
	modelId: string;
	region: string | null;
	deactivatedAt?: string | null;
	externalId: string;
	/** Exact tested credential that managed-credit routing must use. */
	platformCredentialId: string | null;
	/** Fingerprint of the exact tested secret, endpoint, and credential options. */
	platformCredentialProfile: string | null;
	displayable: boolean;
	available: boolean;
	routable: boolean;
	probeOnly: boolean;
	priority: number;
	weight: number;
	contextSizeLimit: number | null;
	maxOutputLimit: number | null;
	disabledCapabilities: DisabledCatalogCapability[];
	sourcePrices: PriceMap;
	customerPrices: PriceMap;
	margin: PriceMap;
	pricingMode: "source_cost" | "markup" | "fixed" | null;
	markupBps: number | null;
	reasons: MappingEligibilityReason[];
	// Base capability data mirrored from the source row. Optional because
	// snapshots stored before this data existed must still parse.
	contextSize?: number | null;
	maxOutput?: number | null;
	streaming?: boolean;
	vision?: boolean | null;
	reasoning?: boolean | null;
	reasoningMaxTokens?: boolean;
	tools?: boolean | null;
	jsonOutput?: boolean;
	jsonOutputSchema?: boolean;
	webSearch?: boolean;
	supportedParameters?: string[] | null;
	pricingTiers?: MappingPricingTier[] | null;
	serviceTierMultipliers?: Partial<Record<string, number>> | null;
	// Modality routing flags. Optional for the same reason: snapshots stored
	// before the modality-flag mirror existed must still parse (reconstruction
	// falls back to the static graft for those revisions).
	embeddings?: boolean;
	imageGenerations?: boolean;
	videoGenerations?: boolean;
	speechGenerations?: boolean;
	transcriptions?: boolean;
	realtime?: boolean;
	realtimeTranscription?: boolean;
	ocr?: boolean;
	rerank?: boolean;
	// Modality serving-config, same optionality contract as the flags above.
	supportedVideoSizes?: string[] | null;
	supportedVideoDurationsSeconds?: number[] | null;
	supportedVideoDurationsSecondsImageToVideo?: number[] | null;
	supportsVideoAudio?: boolean | null;
	supportsVideoWithoutAudio?: boolean | null;
	supportedVoices?: string[] | null;
	contentFilterPrice?: string | null;
}

export interface EffectiveCatalog {
	revision: number;
	checksum: string;
	providers: EffectiveProvider[];
	models: EffectiveModel[];
	mappings: EffectiveMapping[];
	visibleProviderIds: string[];
	visibleModelIds: string[];
	availableModelIds: string[];
	routableMappingIds: string[];
}

function dateReached(value: Date | null | undefined, now: Date): boolean {
	return (
		value !== null && value !== undefined && value.getTime() <= now.getTime()
	);
}

function effectiveLifecycle(
	lifecycle: CatalogLifecycle | undefined,
	deprecatedAt: Date | null | undefined,
	retireAt: Date | null | undefined,
	now: Date,
): CatalogLifecycle {
	if (lifecycle === "retired" || dateReached(retireAt, now)) {
		return "retired";
	}
	if (lifecycle === "deprecated" || dateReached(deprecatedAt, now)) {
		return "deprecated";
	}
	return lifecycle ?? "draft";
}

export function calculateCatalogChecksum(value: unknown): string {
	const canonical = JSON.stringify(value, (_key, current) => {
		if (
			current === null ||
			typeof current !== "object" ||
			Array.isArray(current)
		) {
			return current;
		}
		return Object.fromEntries(
			Object.entries(current as Record<string, unknown>).sort(
				([left], [right]) => left.localeCompare(right),
			),
		);
	});
	return `sha256:v2:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function resolveEffectiveCatalog(
	input: CatalogResolverInput,
): EffectiveCatalog {
	const providers = [...input.providers].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	const models = [...input.models].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	const mappings = [...input.mappings].sort((left, right) =>
		left.id.localeCompare(right.id),
	);

	const sourceProviders = new Map(providers.map((item) => [item.id, item]));
	const sourceModels = new Map(models.map((item) => [item.id, item]));
	const providerPolicies = new Map(
		input.providerPolicies.map((item) => [item.providerId, item]),
	);
	const modelPolicies = new Map(
		input.modelPolicies.map((item) => [item.modelId, item]),
	);
	const mappingPolicies = new Map(
		input.mappingPolicies.map((item) => [item.mappingId, item]),
	);

	const providerLifecycle = new Map(
		providers.map((item) => {
			const policy = providerPolicies.get(item.id);
			return [
				item.id,
				effectiveLifecycle(
					policy?.lifecycle,
					policy?.deprecatedAt,
					policy?.retireAt,
					input.now,
				),
			] as const;
		}),
	);
	const modelLifecycle = new Map(
		models.map((item) => {
			const policy = modelPolicies.get(item.id);
			return [
				item.id,
				effectiveLifecycle(
					policy?.lifecycle,
					policy?.deprecatedAt,
					policy?.retireAt,
					input.now,
				),
			] as const;
		}),
	);

	const effectiveMappings: EffectiveMapping[] = mappings.map((mapping) => {
		const sourceProvider = sourceProviders.get(mapping.providerId);
		const sourceModel = sourceModels.get(mapping.modelId);
		const providerPolicy = providerPolicies.get(mapping.providerId);
		const modelPolicy = modelPolicies.get(mapping.modelId);
		const mappingPolicy = mappingPolicies.get(mapping.id);
		const readiness = input.mappingReadiness[mapping.id];
		const breaker = input.breakerStates[mapping.id];
		const reasons: MappingEligibilityReason[] = [];

		if (!sourceProvider || sourceProvider.status !== "active") {
			reasons.push("source_provider_inactive");
		}
		if (!sourceModel || sourceModel.status !== "active") {
			reasons.push("source_model_inactive");
		}
		if (mapping.status !== "active") {
			reasons.push("source_mapping_inactive");
		}
		if (dateReached(mapping.deactivatedAt, input.now)) {
			reasons.push("source_mapping_deactivated");
		}
		if (!providerPolicy) {
			reasons.push("provider_policy_missing");
		} else {
			if (!providerPolicy.enabled) {
				reasons.push("provider_disabled");
			}
			if (providerLifecycle.get(mapping.providerId) === "retired") {
				reasons.push("provider_retired");
			}
		}
		if (!modelPolicy) {
			reasons.push("model_policy_missing");
		} else {
			if (!modelPolicy.enabled) {
				reasons.push("model_disabled");
			}
			if (modelLifecycle.get(mapping.modelId) === "retired") {
				reasons.push("model_retired");
			}
		}
		if (!mappingPolicy) {
			reasons.push("mapping_policy_missing");
		} else if (!mappingPolicy.enabled) {
			reasons.push("mapping_disabled");
		}
		if (!input.providerCredentialAvailability[mapping.providerId]) {
			reasons.push("provider_credential_unavailable");
		}
		if (!readiness?.priceReady) {
			reasons.push("mapping_price_incomplete");
		}
		if (!readiness?.testPassed) {
			reasons.push("mapping_test_required");
		}

		const staticReasonCount = reasons.length;
		const breakerEnabled = mappingPolicy?.breakerEnabled ?? true;
		if (breakerEnabled && breaker?.state === "open") {
			reasons.push("circuit_open");
		}
		if (breakerEnabled && breaker?.state === "half_open") {
			reasons.push("circuit_half_open");
		}

		const displayable = Boolean(
			sourceProvider?.status === "active" &&
			sourceModel?.status === "active" &&
			mapping.status === "active" &&
			!dateReached(mapping.deactivatedAt, input.now) &&
			providerPolicy?.visible &&
			providerLifecycle.get(mapping.providerId) !== "retired" &&
			modelPolicy?.visible &&
			modelLifecycle.get(mapping.modelId) !== "retired" &&
			mappingPolicy?.enabled,
		);
		const available = staticReasonCount === 0;
		const probeOnly =
			available && breakerEnabled && breaker?.state === "half_open";
		const routable =
			available &&
			(!breakerEnabled || breaker === undefined || breaker.state === "closed");

		return {
			id: mapping.id,
			providerId: mapping.providerId,
			modelId: mapping.modelId,
			region: mapping.region ?? null,
			deactivatedAt: mapping.deactivatedAt?.toISOString() ?? null,
			externalId: mappingPolicy?.externalIdOverride ?? mapping.externalId,
			platformCredentialId: readiness?.platformCredentialId ?? null,
			platformCredentialProfile: readiness?.platformCredentialProfile ?? null,
			displayable,
			available,
			routable,
			probeOnly,
			priority: mappingPolicy?.priority ?? 100,
			weight: mappingPolicy?.weight ?? 0,
			contextSizeLimit: mappingPolicy?.contextSizeLimit ?? null,
			maxOutputLimit: mappingPolicy?.maxOutputLimit ?? null,
			disabledCapabilities: mappingPolicy?.disabledCapabilities ?? [],
			sourcePrices: readiness?.sourcePrices ?? {},
			customerPrices: readiness?.customerPrices ?? {},
			margin: readiness?.margin ?? {},
			pricingMode: readiness?.pricingMode ?? null,
			markupBps: readiness?.markupBps ?? null,
			reasons: reasons.sort(),
			contextSize: mapping.contextSize,
			maxOutput: mapping.maxOutput,
			streaming: mapping.streaming,
			vision: mapping.vision,
			reasoning: mapping.reasoning,
			reasoningMaxTokens: mapping.reasoningMaxTokens,
			tools: mapping.tools,
			jsonOutput: mapping.jsonOutput,
			jsonOutputSchema: mapping.jsonOutputSchema,
			webSearch: mapping.webSearch,
			supportedParameters: mapping.supportedParameters,
			pricingTiers: mapping.pricingTiers,
			serviceTierMultipliers: mapping.serviceTierMultipliers,
			embeddings: mapping.embeddings,
			imageGenerations: mapping.imageGenerations,
			videoGenerations: mapping.videoGenerations,
			speechGenerations: mapping.speechGenerations,
			transcriptions: mapping.transcriptions,
			realtime: mapping.realtime,
			realtimeTranscription: mapping.realtimeTranscription,
			ocr: mapping.ocr,
			rerank: mapping.rerank,
			supportedVideoSizes: mapping.supportedVideoSizes,
			supportedVideoDurationsSeconds: mapping.supportedVideoDurationsSeconds,
			supportedVideoDurationsSecondsImageToVideo:
				mapping.supportedVideoDurationsSecondsImageToVideo,
			supportsVideoAudio: mapping.supportsVideoAudio,
			supportsVideoWithoutAudio: mapping.supportsVideoWithoutAudio,
			supportedVoices: mapping.supportedVoices,
			contentFilterPrice: mapping.contentFilterPrice,
		};
	});

	const effectiveModels: EffectiveModel[] = models.map((model) => {
		const policy = modelPolicies.get(model.id);
		const lifecycle = modelLifecycle.get(model.id) ?? "draft";
		const modelMappings = effectiveMappings.filter(
			(mapping) => mapping.modelId === model.id,
		);
		const configuredVisible = Boolean(policy?.visible);
		return {
			id: model.id,
			lifecycle,
			configuredVisible,
			visible:
				configuredVisible &&
				lifecycle !== "retired" &&
				modelMappings.some((mapping) => mapping.displayable),
			available:
				Boolean(policy?.enabled) &&
				lifecycle !== "retired" &&
				modelMappings.some((mapping) => mapping.available),
			allowDirect: policy?.allowDirect ?? false,
			replacementModelId: policy?.replacementModelId ?? null,
			deprecatedAt: policy?.deprecatedAt?.toISOString() ?? null,
			retireAt: policy?.retireAt?.toISOString() ?? null,
			retirementMessage: policy?.retirementMessage ?? null,
			name: model.name,
			family: model.family,
			aliases: model.aliases,
			output: model.output,
			free: model.free,
			imageInputRequired: model.imageInputRequired,
			maxVideoDurationSeconds: model.maxVideoDurationSeconds,
		};
	});

	const effectiveProviders: EffectiveProvider[] = providers.map((provider) => {
		const policy = providerPolicies.get(provider.id);
		const lifecycle = providerLifecycle.get(provider.id) ?? "draft";
		const providerMappings = effectiveMappings.filter(
			(mapping) => mapping.providerId === provider.id,
		);
		const configuredVisible = Boolean(policy?.visible);
		return {
			id: provider.id,
			lifecycle,
			deprecatedAt: policy?.deprecatedAt?.toISOString() ?? null,
			retireAt: policy?.retireAt?.toISOString() ?? null,
			configuredVisible,
			visible:
				configuredVisible &&
				lifecycle !== "retired" &&
				providerMappings.some((mapping) => mapping.displayable),
			available:
				Boolean(policy?.enabled) &&
				lifecycle !== "retired" &&
				Boolean(input.providerCredentialAvailability[provider.id]),
		};
	});

	const snapshotContent = {
		providers: effectiveProviders,
		models: effectiveModels,
		mappings: effectiveMappings,
		visibleProviderIds: effectiveProviders
			.filter((item) => item.visible)
			.map((item) => item.id),
		visibleModelIds: effectiveModels
			.filter((item) => item.visible)
			.map((item) => item.id),
		availableModelIds: effectiveModels
			.filter((item) => item.available)
			.map((item) => item.id),
		routableMappingIds: effectiveMappings
			.filter((item) => item.routable)
			.map((item) => item.id),
	};

	return {
		revision: input.revision,
		...snapshotContent,
		checksum: calculateCatalogChecksum(snapshotContent),
	};
}
