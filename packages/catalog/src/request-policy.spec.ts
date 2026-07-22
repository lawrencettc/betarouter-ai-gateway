import { describe, expect, it } from "vitest";

import { evaluateCatalogRequest } from "./request-policy.js";

import type { EffectiveCatalog } from "./catalog.js";

function snapshot(overrides: Partial<EffectiveCatalog> = {}): EffectiveCatalog {
	return {
		revision: 8,
		checksum: "sha256:test",
		providers: [],
		models: [
			{
				id: "gpt",
				lifecycle: "active",
				configuredVisible: true,
				visible: true,
				available: true,
				allowDirect: false,
				replacementModelId: null,
				deprecatedAt: null,
				retireAt: null,
				retirementMessage: null,
			},
		],
		mappings: [
			{
				id: "mapping-1",
				providerId: "openai",
				modelId: "gpt",
				region: null,
				externalId: "gpt-upstream",
				displayable: true,
				available: true,
				routable: true,
				probeOnly: false,
				priority: 1,
				weight: 100,
				sourcePrices: {},
				customerPrices: {},
				margin: {},
				pricingMode: null,
				markupBps: null,
				reasons: [],
			},
		],
		visibleProviderIds: ["openai"],
		visibleModelIds: ["gpt"],
		availableModelIds: ["gpt"],
		routableMappingIds: ["mapping-1"],
		...overrides,
	};
}

describe("evaluateCatalogRequest", () => {
	it("rejects a hidden model unless allowDirect is explicit", () => {
		const hidden = snapshot({
			models: [{ ...snapshot().models[0]!, visible: false }],
		});

		expect(evaluateCatalogRequest(hidden, { modelId: "gpt" })).toMatchObject({
			allowed: false,
			status: 404,
			code: "model_not_available",
		});
		expect(
			evaluateCatalogRequest(
				snapshot({
					models: [
						{ ...snapshot().models[0]!, visible: false, allowDirect: true },
					],
				}),
				{ modelId: "gpt" },
			).allowed,
		).toBe(true);
	});

	it("returns replacement guidance for retired models", () => {
		const retired = snapshot({
			models: [
				{
					...snapshot().models[0]!,
					lifecycle: "retired",
					available: false,
					replacementModelId: "gpt-next",
				},
			],
		});

		expect(evaluateCatalogRequest(retired, { modelId: "gpt" })).toMatchObject({
			allowed: false,
			status: 410,
			code: "model_retired",
			replacementModelId: "gpt-next",
		});
	});

	it("returns retryable unavailability when breakers remove every route", () => {
		const unavailable = snapshot({
			mappings: [
				{
					...snapshot().mappings[0]!,
					routable: false,
					reasons: ["circuit_open"],
				},
			],
			routableMappingIds: [],
		});

		expect(
			evaluateCatalogRequest(unavailable, { modelId: "gpt" }),
		).toMatchObject({
			allowed: false,
			status: 503,
			code: "model_temporarily_unavailable",
			retryable: true,
		});
	});

	it("limits a pinned provider to its routable mappings", () => {
		expect(
			evaluateCatalogRequest(snapshot(), {
				modelId: "gpt",
				providerId: "anthropic",
			}),
		).toMatchObject({ allowed: false, status: 404 });
		expect(
			evaluateCatalogRequest(snapshot(), {
				modelId: "gpt",
				providerId: "openai",
			}),
		).toMatchObject({ allowed: true, mappingIds: ["mapping-1"] });
	});

	it("orders routing candidates by priority, weight, then stable id", () => {
		const base = snapshot();
		const decision = evaluateCatalogRequest(
			{
				...base,
				mappings: [
					{ ...base.mappings[0]!, id: "later", priority: 20, weight: 100 },
					{ ...base.mappings[0]!, id: "lighter", priority: 10, weight: 20 },
					{ ...base.mappings[0]!, id: "heavier", priority: 10, weight: 80 },
				],
				routableMappingIds: ["later", "lighter", "heavier"],
			},
			{ modelId: "gpt" },
		);

		expect(decision).toMatchObject({
			allowed: true,
			mappingIds: ["heavier", "lighter", "later"],
		});
	});
});
