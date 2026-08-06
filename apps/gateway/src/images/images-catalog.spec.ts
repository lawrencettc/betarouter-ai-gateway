import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyCatalogCustomerPrices } from "@/lib/catalog-policy.js";
import {
	findStaticModelDefinition,
	resetCatalogModelResolutionLogState,
} from "@/lib/model-resolution.js";

import {
	compareCatalogModelResolution,
	resolveEffectiveCatalog,
	resolveMappingPrice,
	sourceMappingPricesToPriceMap,
} from "@betarouter/catalog";
import { logger } from "@betarouter/logger";
import { expandAllProviderRegions } from "@betarouter/models";

import {
	assertImageModel,
	findImageModelDefinition,
} from "./resolve-image-model.js";

import type {
	CatalogResolverInput,
	EffectiveMapping,
	PriceMap,
} from "@betarouter/catalog";
import type { ModelDefinition, ProviderModelMapping } from "@betarouter/models";

// The images rollout canaries: token-priced image output (gpt-image-2) and
// flat per-request pricing with a content-filter charge (grok-imagine-image).
const TOKEN_PRICED_MODEL_ID = "gpt-image-2";
const REQUEST_PRICED_MODEL_ID = "grok-imagine-image";

/**
 * Resolver input the worker sync would produce for one static definition —
 * the same shape `model-resolution.spec.ts` and the embeddings slice use.
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

function staticImagesMapping(
	def: ModelDefinition,
	providerId: string,
): ProviderModelMapping {
	const mapping = (def.providers as ProviderModelMapping[]).find(
		(candidate) =>
			candidate.providerId === providerId && candidate.imageGenerations,
	);
	expect(mapping, `image-generation mapping on ${providerId}`).toBeDefined();
	return mapping!;
}

/**
 * Mirror of the chat handler's image billing arithmetic
 * (`apps/gateway/src/lib/costs.ts`): uncached image input tokens at
 * `imageInputPrice`, image output tokens at `imageOutputPrice`, text prompt
 * tokens at `inputPrice`, plus the flat per-request price.
 */
function billedCost(
	mapping: ProviderModelMapping,
	usage: {
		promptTokens: number;
		imageInputTokens: number;
		imageOutputTokens: number;
	},
): number {
	const textInputCost = usage.promptTokens * Number(mapping.inputPrice ?? "0");
	const imageInputCost =
		usage.imageInputTokens * Number(mapping.imageInputPrice ?? "0");
	const imageOutputCost =
		usage.imageOutputTokens * Number(mapping.imageOutputPrice ?? "0");
	const requestCost = Number(mapping.requestPrice ?? "0");
	return textInputCost + imageInputCost + imageOutputCost + requestCost;
}

function effectiveMappingWith(
	overrides: Partial<EffectiveMapping> & { customerPrices: PriceMap },
): EffectiveMapping {
	return {
		id: "images-mapping",
		providerId: "openai",
		modelId: TOKEN_PRICED_MODEL_ID,
		region: null,
		deactivatedAt: null,
		externalId: "gpt-image-2",
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

const STATIC_CONTEXT = {
	snapshot: null,
	baseReadEnabled: false,
	shadowRead: false,
};

describe("images catalog resolution", () => {
	beforeEach(() => {
		resetCatalogModelResolutionLogState();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reconstructs the token-priced canary with zero divergence and identical billed cost", () => {
		const staticDef = staticDefinition(TOKEN_PRICED_MODEL_ID);
		const snapshot = resolveEffectiveCatalog(
			resolverInputForStatic(staticDef, 13),
		);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		const match = findImageModelDefinition(TOKEN_PRICED_MODEL_ID, {
			snapshot,
			baseReadEnabled: true,
			shadowRead: true,
		});
		expect(match).not.toBeNull();
		expect(match!.modelKey).toBe(TOKEN_PRICED_MODEL_ID);
		// The definition really came from the snapshot, and the imageGenerations
		// serving flag was grafted from the static mapping.
		expect(match!.modelDef).not.toBe(staticDef);
		expect(match!.modelDef.output).toEqual(["image"]);
		const reconstructed = match!.modelDef.providers[0] as ProviderModelMapping;
		expect(reconstructed.providerId).toBe("openai");
		expect(reconstructed.imageGenerations).toBe(true);

		expect(compareCatalogModelResolution(staticDef, match!.modelDef)).toEqual(
			[],
		);
		expect(
			warn.mock.calls.filter(
				(call) => call[0] === "Catalog model resolution divergence",
			),
		).toEqual([]);
		expect(error).not.toHaveBeenCalled();

		const staticMapping = staticImagesMapping(staticDef, "openai");
		const usage = {
			promptTokens: 42,
			imageInputTokens: 512,
			imageOutputTokens: 4160,
		};
		expect(
			new Decimal(reconstructed.imageOutputPrice!).eq(
				new Decimal(staticMapping.imageOutputPrice!),
			),
		).toBe(true);
		expect(billedCost(reconstructed, usage)).toBe(
			billedCost(staticMapping, usage),
		);
	});

	it("reconstructs the request-priced canary and its content-filter charge", () => {
		const staticDef = staticDefinition(REQUEST_PRICED_MODEL_ID);
		const snapshot = resolveEffectiveCatalog(
			resolverInputForStatic(staticDef, 13),
		);
		const match = findImageModelDefinition(REQUEST_PRICED_MODEL_ID, {
			snapshot,
			baseReadEnabled: true,
			shadowRead: false,
		});
		expect(match).not.toBeNull();
		expect(compareCatalogModelResolution(staticDef, match!.modelDef)).toEqual(
			[],
		);

		const staticMapping = staticImagesMapping(staticDef, "xai");
		const reconstructed = match!.modelDef.providers.find(
			(candidate) => candidate.providerId === "xai" && !candidate.deactivatedAt,
		) as ProviderModelMapping;
		expect(reconstructed).toBeDefined();
		// Flat per-request pricing is the billing unit for this mapping.
		expect(
			new Decimal(reconstructed.requestPrice!).eq(
				new Decimal(staticMapping.requestPrice!),
			),
		).toBe(true);
		// contentFilterPrice is mirrored (serving-config slice); the snapshot
		// value round-trips so filtered generations keep billing their flat
		// charge, admin-created mappings included.
		expect(reconstructed.contentFilterPrice).toBe(
			staticMapping.contentFilterPrice,
		);
		const usage = {
			promptTokens: 0,
			imageInputTokens: 1,
			imageOutputTokens: 0,
		};
		expect(billedCost(reconstructed, usage)).toBe(
			billedCost(staticMapping, usage),
		);
	});

	it("gates the images surface on declared output modalities", () => {
		// Image-only and text+image models pass; provider pinning resolves.
		expect(() =>
			assertImageModel(TOKEN_PRICED_MODEL_ID, STATIC_CONTEXT),
		).not.toThrow();
		expect(() =>
			assertImageModel(`openai/${TOKEN_PRICED_MODEL_ID}`, STATIC_CONTEXT),
		).not.toThrow();
		expect(() =>
			assertImageModel("gemini-3-pro-image-preview", STATIC_CONTEXT),
		).not.toThrow();

		// Text-only models are rejected before the chat re-dispatch.
		const chatModel = staticDefinition("gpt-5.5");
		expect(() => assertImageModel(chatModel.id, STATIC_CONTEXT)).toThrow(
			/cannot be used with \/v1\/images\/generations/,
		);

		// Unknown models pass through: the chat handler rejects them as
		// "model not found", exactly as before the rewire.
		expect(() => assertImageModel("not-a-model", STATIC_CONTEXT)).not.toThrow();
		expect(findImageModelDefinition("not-a-model", STATIC_CONTEXT)).toBeNull();
		// "auto" and "custom" resolve dynamically and always pass.
		expect(() => assertImageModel("auto", STATIC_CONTEXT)).not.toThrow();
		expect(() =>
			assertImageModel("acme-relay/custom", STATIC_CONTEXT),
		).not.toThrow();
	});

	it("carries image pricing units through price policies into billing", () => {
		const staticDef = staticDefinition(TOKEN_PRICED_MODEL_ID);
		const staticMapping = staticImagesMapping(staticDef, "openai");
		const sourcePrices = sourceMappingPricesToPriceMap(staticMapping);
		// Per-token 30e-6 mirrors as USD 30 per million tokens.
		expect(
			new Decimal(sourcePrices.imageOutput!).eq(
				new Decimal(staticMapping.imageOutputPrice!).mul(1_000_000),
			),
		).toBe(true);
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
		for (const field of [
			"imageInputPrice",
			"imageOutputPrice",
			"cachedImageInputPrice",
		] as const) {
			expect(
				new Decimal(billed[field]!).eq(new Decimal(staticMapping[field]!)),
				field,
			).toBe(true);
		}
		const usage = {
			promptTokens: 42,
			imageInputTokens: 512,
			imageOutputTokens: 4160,
		};
		expect(billedCost(billed, usage)).toBe(billedCost(staticMapping, usage));

		const markup = resolveMappingPrice({
			sourcePrices,
			policy: { mode: "markup", markupBps: 2500 },
		});
		expect(markup.ready).toBe(true);
		const markedUp = applyCatalogCustomerPrices(
			staticMapping,
			effectiveMappingWith({
				customerPrices: markup.customerPrices,
				pricingMode: "markup",
				markupBps: 2500,
			}),
		);
		expect(
			new Decimal(markedUp.imageOutputPrice!).eq(
				new Decimal(staticMapping.imageOutputPrice!).mul("1.25"),
			),
		).toBe(true);

		// Flat per-request image pricing (grok/reve style) survives the round
		// trip without the per-million conversion.
		const requestPriced = staticImagesMapping(
			staticDefinition(REQUEST_PRICED_MODEL_ID),
			"xai",
		);
		const requestSource = sourceMappingPricesToPriceMap(requestPriced);
		expect(requestSource.request).toBe(requestPriced.requestPrice);
		const requestResolved = resolveMappingPrice({
			sourcePrices: requestSource,
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
			new Decimal(requestBilled.requestPrice!).eq(
				new Decimal(requestPriced.requestPrice!),
			),
		).toBe(true);
	});
});
