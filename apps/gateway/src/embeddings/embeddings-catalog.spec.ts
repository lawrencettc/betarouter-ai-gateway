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

import { findEmbeddingMapping } from "./embeddings.js";

import type {
	CatalogResolverInput,
	EffectiveMapping,
	PriceMap,
} from "@betarouter/catalog";
import type { ModelDefinition, ProviderModelMapping } from "@betarouter/models";

// The embeddings rollout canary: the exit gate compares billed cost between
// static and catalog resolution on this mapping.
const CANARY_MODEL_ID = "text-embedding-3-small";

/**
 * Resolver input the worker sync would produce for one static definition —
 * the same shape `model-resolution.spec.ts` uses for the chat canary.
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
		supportedParameters: mapping.supportedParameters ?? null,
		pricingTiers: mapping.pricingTiers
			? mapping.pricingTiers.map((tier) => ({
					...tier,
					upToTokens: Number.isFinite(tier.upToTokens) ? tier.upToTokens : null,
				}))
			: null,
		serviceTierMultipliers: mapping.serviceTierMultipliers ?? null,
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

function canaryDefinition(): ModelDefinition {
	const def = findStaticModelDefinition(CANARY_MODEL_ID);
	expect(def, `static model ${CANARY_MODEL_ID}`).toBeDefined();
	return def!;
}

function staticEmbeddingsMapping(def: ModelDefinition): ProviderModelMapping {
	const mapping = (def.providers as ProviderModelMapping[]).find(
		(candidate) => candidate.embeddings,
	);
	expect(mapping, "embeddings-capable static mapping").toBeDefined();
	return mapping!;
}

/**
 * Mirror of the embeddings handler's billing arithmetic
 * (`apps/gateway/src/embeddings/embeddings.ts`): per-token input price times
 * prompt tokens, plus the flat per-request price.
 */
function billedCost(
	mapping: ProviderModelMapping,
	promptTokens: number,
): number {
	const inputCost = promptTokens * Number(mapping.inputPrice ?? "0");
	return inputCost + Number(mapping.requestPrice ?? "0");
}

function effectiveMappingWith(
	overrides: Partial<EffectiveMapping> & { customerPrices: PriceMap },
): EffectiveMapping {
	return {
		id: "embed-mapping",
		providerId: "openai",
		modelId: CANARY_MODEL_ID,
		region: null,
		deactivatedAt: null,
		externalId: "text-embedding-3-small",
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

describe("embeddings catalog resolution", () => {
	beforeEach(() => {
		resetCatalogModelResolutionLogState();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reconstructs the canary with zero divergence and identical billed cost", () => {
		const staticDef = canaryDefinition();
		const snapshot = resolveEffectiveCatalog(
			resolverInputForStatic(staticDef, 11),
		);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		const match = findEmbeddingMapping(CANARY_MODEL_ID, {
			snapshot,
			baseReadEnabled: true,
			shadowRead: true,
		});
		expect(match).not.toBeNull();
		expect(match!.modelDefId).toBe(CANARY_MODEL_ID);
		expect(match!.explicitProvider).toBe(false);
		// The definition really came from the snapshot, and the embeddings
		// capability flag was grafted from the static mapping.
		expect(match!.modelDef).not.toBe(staticDef);
		expect(match!.mapping.embeddings).toBe(true);
		expect(match!.mapping.providerId).toBe("openai");

		expect(compareCatalogModelResolution(staticDef, match!.modelDef)).toEqual(
			[],
		);
		expect(
			warn.mock.calls.filter(
				(call) => call[0] === "Catalog model resolution divergence",
			),
		).toEqual([]);
		expect(error).not.toHaveBeenCalled();

		const staticMapping = staticEmbeddingsMapping(staticDef);
		expect(
			new Decimal(match!.mapping.inputPrice!).eq(
				new Decimal(staticMapping.inputPrice!),
			),
		).toBe(true);
		expect(billedCost(match!.mapping, 1234)).toBe(
			billedCost(staticMapping, 1234),
		);
	});

	it("keeps provider-prefix selection and the embeddings capability filter", () => {
		const staticContext = {
			snapshot: null,
			baseReadEnabled: false,
			shadowRead: false,
		};
		const pinned = findEmbeddingMapping(
			"google-vertex/gemini-embedding-001",
			staticContext,
		);
		expect(pinned?.mapping.providerId).toBe("google-vertex");
		expect(pinned?.explicitProvider).toBe(true);

		const bare = findEmbeddingMapping("gemini-embedding-001", staticContext);
		expect(bare?.mapping.providerId).toBe("google-ai-studio");
		expect(bare?.explicitProvider).toBe(false);
		expect(bare?.mapping.embeddings).toBe(true);

		// Chat models have no embeddings-capable mapping; unknown ids resolve
		// to nothing. Both come back null exactly as before the rewire.
		expect(findEmbeddingMapping("gpt-5.5", staticContext)).toBeNull();
		expect(findEmbeddingMapping("not-a-model", staticContext)).toBeNull();
	});

	it("carries embeddings pricing units through price policies into billing", () => {
		const staticDef = canaryDefinition();
		const staticMapping = staticEmbeddingsMapping(staticDef);
		const sourcePrices = sourceMappingPricesToPriceMap(staticMapping);
		// Per-token 0.02e-6 mirrors as USD 0.02 per million tokens.
		expect(
			new Decimal(sourcePrices.input!).eq(
				new Decimal(staticMapping.inputPrice!).mul(1_000_000),
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
		expect(
			new Decimal(billed.inputPrice!).eq(
				new Decimal(staticMapping.inputPrice!),
			),
		).toBe(true);
		expect(billedCost(billed, 4321)).toBe(billedCost(staticMapping, 4321));

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
			new Decimal(markedUp.inputPrice!).eq(
				new Decimal(staticMapping.inputPrice!).mul("1.25"),
			),
		).toBe(true);

		// Character- and request-priced embeddings units survive the round trip
		// too (no static embeddings mapping uses them today, but the units are
		// part of the modality's price surface).
		const characterPriced = {
			providerId: "openai",
			externalId: "char-embed",
			streaming: false,
			embeddings: true,
			inputCharacterPrice: "0.1e-6",
			requestPrice: "0.001",
		} as ProviderModelMapping;
		const characterSource = sourceMappingPricesToPriceMap(characterPriced);
		const characterResolved = resolveMappingPrice({
			sourcePrices: characterSource,
			policy: { mode: "source_cost" },
		});
		expect(characterResolved.ready).toBe(true);
		const characterBilled = applyCatalogCustomerPrices(
			characterPriced,
			effectiveMappingWith({
				customerPrices: characterResolved.customerPrices,
				pricingMode: "source_cost",
			}),
		);
		expect(
			new Decimal(characterBilled.inputCharacterPrice!).eq(
				new Decimal("0.1e-6"),
			),
		).toBe(true);
		expect(
			new Decimal(characterBilled.requestPrice!).eq(new Decimal("0.001")),
		).toBe(true);
	});
});
