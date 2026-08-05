import { describe, expect, it } from "vitest";

import {
	catalogJsonValuesEqual,
	catalogReviewEntryKey,
	catalogReviewJsonImage,
	detectSourceOverrideDrift,
	operationsTouchSourceOverrides,
} from "./upstream-review.js";

import type { SourceOverridesRecord } from "./change-set.js";

function overridesRecord(
	fields: Record<string, { value: unknown; baseValue: unknown }>,
): SourceOverridesRecord {
	return {
		version: 1,
		fields: Object.fromEntries(
			Object.entries(fields).map(([key, field]) => [
				key,
				{
					value: field.value,
					baseValue: field.baseValue,
					setAt: "2026-08-01T00:00:00.000Z",
					setBy: "phase5-test",
				},
			]),
		),
	};
}

describe("catalogReviewJsonImage", () => {
	it("projects values through the jsonb serialization", () => {
		expect(catalogReviewJsonImage(undefined)).toBeNull();
		expect(catalogReviewJsonImage(null)).toBeNull();
		expect(catalogReviewJsonImage(new Date("2026-08-05T12:00:00Z"))).toBe(
			"2026-08-05T12:00:00.000Z",
		);
		expect(catalogReviewJsonImage("0.000003")).toBe("0.000003");
		expect(catalogReviewJsonImage({ a: [1, "b"] })).toEqual({ a: [1, "b"] });
	});
});

describe("catalogJsonValuesEqual", () => {
	it("compares primitives, arrays, and objects structurally", () => {
		expect(catalogJsonValuesEqual("0.000003", "0.000003")).toBe(true);
		expect(catalogJsonValuesEqual("0.000003", "0.000004")).toBe(false);
		expect(catalogJsonValuesEqual(null, null)).toBe(true);
		expect(catalogJsonValuesEqual(null, "x")).toBe(false);
		expect(catalogJsonValuesEqual([1, 2], [1, 2])).toBe(true);
		expect(catalogJsonValuesEqual([1, 2], [2, 1])).toBe(false);
		expect(catalogJsonValuesEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(
			catalogJsonValuesEqual(
				{ a: 1, b: { c: [true] } },
				{ b: { c: [true] }, a: 1 },
			),
		).toBe(true);
		expect(catalogJsonValuesEqual({ a: 1 }, { a: 1, b: null })).toBe(false);
	});
});

describe("catalogReviewEntryKey", () => {
	it("derives deterministic keys per kind", () => {
		expect(
			catalogReviewEntryKey("override_drift", "mapping", "map-1", "inputPrice"),
		).toBe("drift:mapping:map-1:inputPrice");
		expect(catalogReviewEntryKey("entity_added", "model", "gpt-x")).toBe(
			"added:model:gpt-x",
		);
		expect(catalogReviewEntryKey("entity_retired", "provider", "acme")).toBe(
			"retired:provider:acme",
		);
	});
});

describe("operationsTouchSourceOverrides", () => {
	it("detects override operations only", () => {
		expect(
			operationsTouchSourceOverrides([
				{ type: "mapping.set_source_override" },
				{ type: "model.set_policy" },
			]),
		).toBe(true);
		expect(
			operationsTouchSourceOverrides([
				{ type: "provider.clear_source_override" },
			]),
		).toBe(true);
		expect(
			operationsTouchSourceOverrides([
				{ type: "mapping.set_policy" },
				{ type: "provider.create" },
			]),
		).toBe(false);
	});
});

describe("detectSourceOverrideDrift", () => {
	const emptyOverrides = { providers: [], models: [], mappings: [] };

	it("reports a field only when the mirror moved since base capture", () => {
		const drift = detectSourceOverrideDrift(
			{
				providers: [],
				models: [],
				mappings: [
					{
						id: "map-drifted",
						source: "static",
						inputPrice: "0.000004",
						outputPrice: "0.00001",
					},
					{
						id: "map-stable",
						source: "static",
						inputPrice: "0.000003",
					},
				],
			},
			{
				providers: [],
				models: [],
				mappings: [
					{
						mappingId: "map-drifted",
						sourceOverrides: overridesRecord({
							inputPrice: { value: "2.5e-6", baseValue: "0.000003" },
							outputPrice: { value: "9e-6", baseValue: "0.00001" },
						}),
					},
					{
						mappingId: "map-stable",
						sourceOverrides: overridesRecord({
							inputPrice: { value: "2.5e-6", baseValue: "0.000003" },
						}),
					},
				],
			},
		);
		expect(drift).toEqual([
			{
				entityType: "mapping",
				entityId: "map-drifted",
				field: "inputPrice",
				overrideValue: "2.5e-6",
				baseValue: "0.000003",
				mirrorValue: "0.000004",
			},
		]);
	});

	it("uses deep equality for jsonb fields", () => {
		const tiers = [
			{ upToTokens: 128000, inputPrice: "1e-6" },
			{ upToTokens: null, inputPrice: "2e-6" },
		];
		const stable = detectSourceOverrideDrift(
			{
				providers: [],
				models: [],
				mappings: [{ id: "map-1", source: "static", pricingTiers: tiers }],
			},
			{
				...emptyOverrides,
				mappings: [
					{
						mappingId: "map-1",
						sourceOverrides: overridesRecord({
							pricingTiers: {
								value: null,
								baseValue: [
									{ inputPrice: "1e-6", upToTokens: 128000 },
									{ inputPrice: "2e-6", upToTokens: null },
								],
							},
						}),
					},
				],
			},
		);
		expect(stable).toEqual([]);

		const moved = detectSourceOverrideDrift(
			{
				providers: [],
				models: [],
				mappings: [
					{
						id: "map-1",
						source: "static",
						pricingTiers: [{ upToTokens: 64000, inputPrice: "1e-6" }],
					},
				],
			},
			{
				...emptyOverrides,
				mappings: [
					{
						mappingId: "map-1",
						sourceOverrides: overridesRecord({
							pricingTiers: {
								value: null,
								baseValue: [{ upToTokens: 128000, inputPrice: "1e-6" }],
							},
						}),
					},
				],
			},
		);
		expect(moved).toHaveLength(1);
		expect(moved[0]).toMatchObject({ field: "pricingTiers" });
	});

	it("treats null base and null mirror as unchanged", () => {
		const drift = detectSourceOverrideDrift(
			{
				providers: [],
				models: [],
				mappings: [
					{ id: "map-1", source: "static", cachedInputPrice: null },
					{ id: "map-2", source: "static", cachedInputPrice: "1e-7" },
				],
			},
			{
				...emptyOverrides,
				mappings: [
					{
						mappingId: "map-1",
						sourceOverrides: overridesRecord({
							cachedInputPrice: { value: "5e-8", baseValue: null },
						}),
					},
					{
						mappingId: "map-2",
						sourceOverrides: overridesRecord({
							cachedInputPrice: { value: "5e-8", baseValue: null },
						}),
					},
				],
			},
		);
		expect(drift).toEqual([
			expect.objectContaining({ entityId: "map-2", field: "cachedInputPrice" }),
		]);
	});

	it("skips admin rows and overrides without a mirrored row", () => {
		const drift = detectSourceOverrideDrift(
			{
				providers: [{ id: "acme", source: "admin", name: "Acme" }],
				models: [],
				mappings: [],
			},
			{
				...emptyOverrides,
				providers: [
					{
						providerId: "acme",
						sourceOverrides: overridesRecord({
							name: { value: "Acme 2", baseValue: "Acme Prime" },
						}),
					},
					{
						providerId: "ghost",
						sourceOverrides: overridesRecord({
							name: { value: "Ghost", baseValue: "Casper" },
						}),
					},
				],
			},
		);
		expect(drift).toEqual([]);
	});
});
