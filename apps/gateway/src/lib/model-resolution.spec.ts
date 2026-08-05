import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	compareCatalogModelResolution,
	resolveEffectiveCatalog,
	sourceMappingPricesToPriceMap,
} from "@betarouter/catalog";
import { logger } from "@betarouter/logger";
import { expandAllProviderRegions, models } from "@betarouter/models";

import {
	buildCatalogParseContext,
	findStaticModelDefinition,
	resetCatalogModelResolutionLogState,
	resolveGatewayModelDefinition,
} from "./model-resolution.js";

import type {
	CatalogResolverInput,
	EffectiveCatalog,
} from "@betarouter/catalog";
import type { ModelDefinition, ProviderModelMapping } from "@betarouter/models";

// The production canary model — reconstructing it from a snapshot with zero
// divergence is the per-model version of the worker sweep's exit gate.
const CANARY_MODEL_ID = "gpt-5.5";

/**
 * Build the resolver input the worker sync would produce for one static
 * model definition (per-million source prices, streaming "only" collapsed,
 * unbounded pricing tiers stored as null, column defaults filled in).
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
	const def = models.find((model) => model.id === CANARY_MODEL_ID);
	expect(def, `static model ${CANARY_MODEL_ID}`).toBeDefined();
	return def as ModelDefinition;
}

function canarySnapshot(): EffectiveCatalog {
	return resolveEffectiveCatalog(resolverInputForStatic(canaryDefinition(), 7));
}

describe("resolveGatewayModelDefinition", () => {
	beforeEach(() => {
		resetCatalogModelResolutionLogState();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("serves static without a snapshot and preserves provider preference", () => {
		const context = {
			snapshot: null,
			baseReadEnabled: false,
			shadowRead: false,
		};
		expect(resolveGatewayModelDefinition(CANARY_MODEL_ID, context)?.id).toBe(
			CANARY_MODEL_ID,
		);
		expect(
			resolveGatewayModelDefinition("definitely-not-a-model", context),
		).toBeUndefined();
		expect(findStaticModelDefinition(CANARY_MODEL_ID, "openai")?.id).toBe(
			CANARY_MODEL_ID,
		);
	});

	it("keeps serving static under shadow read and logs zero divergence for a faithful snapshot", () => {
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
		const resolved = resolveGatewayModelDefinition(CANARY_MODEL_ID, {
			snapshot: canarySnapshot(),
			baseReadEnabled: false,
			shadowRead: true,
		});
		expect(resolved).toBe(findStaticModelDefinition(CANARY_MODEL_ID));
		expect(
			warn.mock.calls.filter(
				(call) => call[0] === "Catalog model resolution divergence",
			),
		).toEqual([]);
		expect(error).not.toHaveBeenCalled();
	});

	it("serves the catalog reconstruction when base reads are enabled", () => {
		const staticDef = canaryDefinition();
		const resolved = resolveGatewayModelDefinition(CANARY_MODEL_ID, {
			snapshot: canarySnapshot(),
			baseReadEnabled: true,
			shadowRead: false,
		});
		expect(resolved).toBeDefined();
		expect(resolved).not.toBe(staticDef);
		expect(compareCatalogModelResolution(staticDef, resolved!)).toEqual([]);
	});

	it("logs a pricing divergence at error level and dedupes per revision", () => {
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const input = resolverInputForStatic(canaryDefinition(), 8);
		const readinessEntries = Object.values(input.mappingReadiness);
		expect(readinessEntries.length).toBeGreaterThan(0);
		for (const readiness of readinessEntries) {
			if (readiness.sourcePrices?.input) {
				readiness.sourcePrices.input = "999";
			}
		}
		const context = {
			snapshot: resolveEffectiveCatalog(input),
			baseReadEnabled: false,
			shadowRead: true,
		};
		resolveGatewayModelDefinition(CANARY_MODEL_ID, context);
		const pricingCalls = error.mock.calls.filter(
			(call) => call[0] === "Catalog model resolution pricing divergence",
		);
		expect(pricingCalls.length).toBeGreaterThan(0);
		expect(pricingCalls[0]?.[1]).toMatchObject({
			modelId: CANARY_MODEL_ID,
			field: "inputPrice",
			pricing: true,
		});

		// Same revision + model → no repeat logging.
		error.mockClear();
		resolveGatewayModelDefinition(CANARY_MODEL_ID, context);
		expect(error).not.toHaveBeenCalled();
	});

	it("falls back to static when the snapshot cannot reconstruct the model", () => {
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const resolved = resolveGatewayModelDefinition("claude-haiku-4-5", {
			snapshot: canarySnapshot(),
			baseReadEnabled: true,
			shadowRead: false,
		});
		expect(resolved).toBe(findStaticModelDefinition("claude-haiku-4-5"));
	});
});

describe("buildCatalogParseContext", () => {
	it("indexes snapshot models and provider pairs, cached per revision", () => {
		const snapshot = canarySnapshot();
		const context = buildCatalogParseContext(snapshot);
		expect(context.modelIds.has(CANARY_MODEL_ID)).toBe(true);
		expect(context.providerIdsByModel.get(CANARY_MODEL_ID)?.has("openai")).toBe(
			true,
		);
		expect(buildCatalogParseContext(snapshot)).toBe(context);
	});
});
