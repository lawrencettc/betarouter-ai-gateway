import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyCatalogCustomerPrices } from "@/lib/catalog-policy.js";
import {
	findStaticModelDefinition,
	resetCatalogModelResolutionLogState,
	resolveGatewayModelDefinition,
} from "@/lib/model-resolution.js";

import {
	compareCatalogModelResolution,
	resolveEffectiveCatalog,
	resolveMappingPrice,
	sourceMappingPricesToPriceMap,
} from "@betarouter/catalog";
import { logger } from "@betarouter/logger";
import { expandAllProviderRegions } from "@betarouter/models";

import type {
	CatalogResolverInput,
	EffectiveMapping,
	PriceMap,
} from "@betarouter/catalog";
import type { ModelDefinition, ProviderModelMapping } from "@betarouter/models";

// The videos rollout canaries: per-second-by-resolution pricing with a
// per-image input charge (grok-imagine-video-1-5) and the highest-traffic
// vertex deployment (veo-3.1).
const PER_SECOND_MODEL_ID = "grok-imagine-video-1-5";
const VERTEX_MODEL_ID = "veo-3.1-generate-preview";

/**
 * Resolver input the worker sync would produce for one static definition —
 * the same shape the chat, embeddings, and images slices use.
 */
function resolverInputForStatic(
	def: ModelDefinition,
	revision: number,
): CatalogResolverInput {
	const expanded = expandAllProviderRegions(
		def.providers as ProviderModelMapping[],
	);
	const mappings = expanded.map((mapping) => ({
		id: `${def.id}:${mapping.providerId}:${mapping.region ?? ""}`,
		providerId: mapping.providerId as string,
		modelId: def.id,
		status: "active" as const,
		externalId: mapping.externalId,
		region: mapping.region ?? null,
		deactivatedAt: mapping.deactivatedAt ?? null,
		contextSize: mapping.contextSize ?? null,
		maxOutput: mapping.maxOutput ?? null,
		streaming: mapping.streaming !== false,
		vision: mapping.vision ?? null,
		reasoning: mapping.reasoning ?? null,
		reasoningMaxTokens: mapping.reasoningMaxTokens ?? false,
		tools: mapping.tools ?? null,
		jsonOutput: mapping.jsonOutput ?? false,
		jsonOutputSchema: mapping.jsonOutputSchema ?? false,
		webSearch: mapping.webSearch ?? false,
		embeddings: mapping.embeddings ?? false,
		imageGenerations: mapping.imageGenerations ?? false,
		videoGenerations: mapping.videoGenerations ?? false,
		speechGenerations: mapping.speechGenerations ?? false,
		transcriptions: mapping.transcriptions ?? false,
		realtime: mapping.realtime ?? false,
		realtimeTranscription: mapping.realtimeTranscription ?? false,
		ocr: mapping.ocr ?? false,
		rerank: mapping.rerank ?? false,
		supportedParameters: mapping.supportedParameters ?? null,
		pricingTiers: mapping.pricingTiers
			? mapping.pricingTiers.map((tier) => ({
					...tier,
					upToTokens: Number.isFinite(tier.upToTokens) ? tier.upToTokens : null,
				}))
			: null,
		serviceTierMultipliers: mapping.serviceTierMultipliers ?? null,
		supportedVideoSizes: mapping.supportedVideoSizes ?? null,
		supportedVideoDurationsSeconds:
			mapping.supportedVideoDurationsSeconds ?? null,
		supportedVideoDurationsSecondsImageToVideo:
			mapping.supportedVideoDurationsSecondsImageToVideo ?? null,
		supportsVideoAudio: mapping.supportsVideoAudio ?? null,
		supportsVideoWithoutAudio: mapping.supportsVideoWithoutAudio ?? null,
		contentFilterPrice: mapping.contentFilterPrice?.toString() ?? null,
	}));
	return {
		revision,
		now: new Date("2026-08-05T00:00:00.000Z"),
		providers: [...new Set(expanded.map((mapping) => mapping.providerId))].map(
			(id) => ({ id: id as string, status: "active" as const }),
		),
		models: [
			{
				id: def.id,
				status: "active",
				name: def.name ?? "(empty)",
				family: def.family,
				aliases: def.aliases ?? [],
				output: def.output ?? ["text"],
				free: def.free ?? false,
				imageInputRequired: def.imageInputRequired ?? false,
				maxVideoDurationSeconds: def.maxVideoDurationSeconds ?? null,
			},
		],
		mappings,
		providerPolicies: [],
		modelPolicies: [],
		mappingPolicies: [],
		providerCredentialAvailability: {},
		mappingReadiness: Object.fromEntries(
			mappings.map((mapping, index) => [
				mapping.id,
				{
					priceReady: true,
					testPassed: true,
					sourcePrices: sourceMappingPricesToPriceMap(expanded[index]!),
				},
			]),
		),
		breakerStates: {},
	};
}

function staticDefinition(modelId: string): ModelDefinition {
	const def = findStaticModelDefinition(modelId);
	expect(def, `static model ${modelId}`).toBeDefined();
	return def!;
}

function staticVideoMapping(
	def: ModelDefinition,
	providerId: string,
): ProviderModelMapping {
	const mapping = (def.providers as ProviderModelMapping[]).find(
		(candidate) =>
			candidate.providerId === providerId && candidate.videoGenerations,
	);
	expect(mapping, `video-generation mapping on ${providerId}`).toBeDefined();
	return mapping!;
}

/**
 * Mirror of the worker's video billing arithmetic
 * (`apps/worker/src/services/video-jobs.ts`): duration times the per-second
 * price for the resolution, plus per-image input charges; mappings without
 * per-second pricing bill the flat request price.
 */
function billedCost(
	mapping: ProviderModelMapping,
	usage: { durationSeconds: number; resolution: string; imageCount: number },
): number {
	const perSecond = mapping.perSecondPrice?.[usage.resolution];
	const outputCost =
		perSecond !== undefined
			? usage.durationSeconds * Number(perSecond)
			: Number(mapping.requestPrice ?? "0");
	const imageCost = usage.imageCount * Number(mapping.imageInputPrice ?? "0");
	return Number((outputCost + imageCost).toFixed(6));
}

function effectiveMappingWith(
	overrides: Partial<EffectiveMapping> & { customerPrices: PriceMap },
): EffectiveMapping {
	return {
		id: "videos-mapping",
		providerId: "xai",
		modelId: PER_SECOND_MODEL_ID,
		region: null,
		deactivatedAt: null,
		externalId: "grok-imagine-video-1.5",
		platformCredentialId: null,
		platformCredentialProfile: null,
		displayable: true,
		available: true,
		routable: true,
		probeOnly: false,
		priority: 0,
		weight: 100,
		contextSizeLimit: null,
		maxOutputLimit: null,
		disabledCapabilities: [],
		sourcePrices: {},
		margin: {},
		pricingMode: null,
		markupBps: null,
		reasons: [],
		...overrides,
	};
}

describe("videos catalog resolution", () => {
	beforeEach(() => {
		resetCatalogModelResolutionLogState();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reconstructs the per-second canary with zero divergence and identical billed cost", () => {
		const staticDef = staticDefinition(PER_SECOND_MODEL_ID);
		const snapshot = resolveEffectiveCatalog(
			resolverInputForStatic(staticDef, 17),
		);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		const resolved = resolveGatewayModelDefinition(PER_SECOND_MODEL_ID, {
			snapshot,
			baseReadEnabled: true,
			shadowRead: true,
		});
		expect(resolved).toBeDefined();
		// The definition really came from the snapshot, which now carries the
		// videoGenerations flag and the model-level imageInputRequired
		// constraint itself (mirrored since the modality-flag and
		// serving-config slices).
		expect(resolved).not.toBe(staticDef);
		expect(resolved!.output).toEqual(["video"]);
		expect(
			"imageInputRequired" in resolved! && resolved!.imageInputRequired,
		).toBe(true);
		const reconstructed = resolved!.providers[0] as ProviderModelMapping;
		expect(reconstructed.providerId).toBe("xai");
		expect(reconstructed.videoGenerations).toBe(true);

		expect(compareCatalogModelResolution(staticDef, resolved!)).toEqual([]);
		expect(
			warn.mock.calls.filter(
				(call) => call[0] === "Catalog model resolution divergence",
			),
		).toEqual([]);
		expect(error).not.toHaveBeenCalled();

		const staticMapping = staticVideoMapping(staticDef, "xai");
		expect(reconstructed.perSecondPrice).toEqual(staticMapping.perSecondPrice);
		for (const usage of [
			{ durationSeconds: 12, resolution: "480p", imageCount: 1 },
			{ durationSeconds: 8, resolution: "720p", imageCount: 2 },
			{ durationSeconds: 6, resolution: "default", imageCount: 0 },
		]) {
			expect(billedCost(reconstructed, usage)).toBe(
				billedCost(staticMapping, usage),
			);
		}
	});

	it("reconstructs the vertex veo canary with zero divergence", () => {
		const staticDef = staticDefinition(VERTEX_MODEL_ID);
		const snapshot = resolveEffectiveCatalog(
			resolverInputForStatic(staticDef, 17),
		);
		const resolved = resolveGatewayModelDefinition(VERTEX_MODEL_ID, {
			snapshot,
			baseReadEnabled: true,
			shadowRead: false,
		});
		expect(resolved).toBeDefined();
		expect(compareCatalogModelResolution(staticDef, resolved!)).toEqual([]);

		const staticMapping = staticVideoMapping(staticDef, "google-vertex");
		const reconstructed = resolved!.providers.find(
			(candidate) => candidate.providerId === "google-vertex",
		) as ProviderModelMapping;
		expect(reconstructed).toBeDefined();
		expect(reconstructed.videoGenerations).toBe(true);
		expect(reconstructed.perSecondPrice).toEqual(staticMapping.perSecondPrice);
	});

	it("carries video pricing units through price policies into billing", () => {
		const staticDef = staticDefinition(PER_SECOND_MODEL_ID);
		const staticMapping = staticVideoMapping(staticDef, "xai");
		const sourcePrices = sourceMappingPricesToPriceMap(staticMapping);
		// Per-second prices are flat USD per second — never per-million.
		expect(sourcePrices["second:480p"]).toBe("0.08");
		expect(sourcePrices["second:720p"]).toBe("0.14");
		expect(sourcePrices["second:default"]).toBe("0.14");
		// Per-image input mirrors per million like every token-family unit.
		expect(
			new Decimal(sourcePrices.imageInput!).eq(
				new Decimal(staticMapping.imageInputPrice!).mul(1_000_000),
			),
		).toBe(true);

		const sourceCost = resolveMappingPrice({
			sourcePrices,
			policy: { mode: "source_cost" },
		});
		expect(sourceCost.ready).toBe(true);
		const billed = applyCatalogCustomerPrices(
			staticMapping,
			effectiveMappingWith({
				customerPrices: sourceCost.customerPrices,
				pricingMode: "source_cost",
			}),
		);
		// applyCatalogCustomerPrices rebuilds perSecondPrice from the
		// `second:*` units, so dispatch-time selection sees identical prices.
		expect(billed.perSecondPrice).toEqual(staticMapping.perSecondPrice);
		expect(
			new Decimal(billed.imageInputPrice!).eq(
				new Decimal(staticMapping.imageInputPrice!),
			),
		).toBe(true);
		for (const usage of [
			{ durationSeconds: 15, resolution: "480p", imageCount: 1 },
			{ durationSeconds: 10, resolution: "720p", imageCount: 0 },
		]) {
			expect(billedCost(billed, usage)).toBe(billedCost(staticMapping, usage));
		}

		// Markup multiplies every unit uniformly, including per-second keys.
		const markup = resolveMappingPrice({
			sourcePrices,
			policy: { mode: "markup", markupBps: 2500 },
		});
		expect(markup.ready).toBe(true);
		expect(
			new Decimal(markup.customerPrices["second:480p"]!).eq(
				new Decimal("0.08").mul("1.25"),
			),
		).toBe(true);
		const markedUp = applyCatalogCustomerPrices(
			staticMapping,
			effectiveMappingWith({
				customerPrices: markup.customerPrices,
				pricingMode: "markup",
				markupBps: 2500,
			}),
		);
		expect(
			new Decimal(markedUp.perSecondPrice!["720p"]!).eq(
				new Decimal("0.14").mul("1.25"),
			),
		).toBe(true);

		// Request-priced fallback (mappings without per-second pricing) stays
		// flat through the round trip.
		const requestPriced = {
			providerId: "xai",
			externalId: "flat-video",
			streaming: false,
			videoGenerations: true,
			requestPrice: "0.07",
		} as ProviderModelMapping;
		const requestResolved = resolveMappingPrice({
			sourcePrices: sourceMappingPricesToPriceMap(requestPriced),
			policy: { mode: "source_cost" },
		});
		expect(requestResolved.ready).toBe(true);
		const requestBilled = applyCatalogCustomerPrices(
			requestPriced,
			effectiveMappingWith({
				customerPrices: requestResolved.customerPrices,
				pricingMode: "source_cost",
			}),
		);
		expect(
			new Decimal(requestBilled.requestPrice!).eq(new Decimal("0.07")),
		).toBe(true);
		expect(
			billedCost(requestBilled, {
				durationSeconds: 10,
				resolution: "480p",
				imageCount: 0,
			}),
		).toBe(0.07);
	});
});
