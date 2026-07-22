import { describe, expect, it } from "vitest";

import { resolveEffectiveCatalog } from "./catalog.js";
import {
	applyCatalogLifecycleAt,
	parseStoredCatalogSnapshot,
	selectCatalogBreakerMappingIds,
} from "./runtime.js";

import type { CatalogResolverInput } from "./catalog.js";

describe("parseStoredCatalogSnapshot", () => {
	it("accepts a valid stored snapshot and rejects a corrupted checksum", () => {
		const resolved = resolveEffectiveCatalog({
			revision: 1,
			now: new Date("2026-07-22T00:00:00.000Z"),
			providers: [],
			models: [],
			mappings: [],
			providerPolicies: [],
			modelPolicies: [],
			mappingPolicies: [],
			providerCredentialAvailability: {},
			mappingReadiness: {},
			breakerStates: {},
		});

		expect(parseStoredCatalogSnapshot(resolved).revision).toBe(1);
		expect(() =>
			parseStoredCatalogSnapshot({ ...resolved, checksum: "sha256:corrupt" }),
		).toThrow("checksum");
	});

	it("enforces scheduled retirement and source deactivation without a new revision", () => {
		const input: CatalogResolverInput = {
			revision: 7,
			now: new Date("2026-07-22T00:00:00.000Z"),
			providers: [{ id: "relay", status: "active" }],
			models: [{ id: "gpt", status: "active" }],
			mappings: [
				{
					id: "relay-gpt",
					providerId: "relay",
					modelId: "gpt",
					status: "active",
					externalId: "gpt",
					deactivatedAt: new Date("2026-07-24T00:00:00.000Z"),
				},
			],
			providerPolicies: [
				{
					providerId: "relay",
					visible: true,
					enabled: true,
					lifecycle: "active",
				},
			],
			modelPolicies: [
				{
					modelId: "gpt",
					visible: true,
					enabled: true,
					allowDirect: false,
					lifecycle: "active",
					retireAt: new Date("2026-07-23T00:00:00.000Z"),
				},
			],
			mappingPolicies: [
				{
					mappingId: "relay-gpt",
					enabled: true,
					priority: 0,
					weight: 100,
					breakerEnabled: true,
				},
			],
			providerCredentialAvailability: { relay: true },
			mappingReadiness: {
				"relay-gpt": { priceReady: true, testPassed: true },
			},
			breakerStates: {},
		};
		const stored = resolveEffectiveCatalog(input);

		expect(stored.routableMappingIds).toEqual(["relay-gpt"]);
		const retired = applyCatalogLifecycleAt(
			stored,
			new Date("2026-07-23T00:00:00.000Z"),
		);
		expect(retired.models[0]).toMatchObject({
			lifecycle: "retired",
			visible: false,
			available: false,
		});
		expect(retired.mappings[0]?.reasons).toContain("model_retired");
		expect(retired.routableMappingIds).toEqual([]);

		const deactivated = applyCatalogLifecycleAt(
			stored,
			new Date("2026-07-24T00:00:00.000Z"),
		);
		expect(deactivated.mappings[0]?.reasons).toContain(
			"source_mapping_deactivated",
		);
	});

	it("limits breaker state reads and probe leases to request candidates", () => {
		const snapshot = resolveEffectiveCatalog({
			revision: 8,
			now: new Date("2026-07-22T00:00:00.000Z"),
			providers: [],
			models: [],
			mappings: [],
			providerPolicies: [],
			modelPolicies: [],
			mappingPolicies: [],
			providerCredentialAvailability: {},
			mappingReadiness: {},
			breakerStates: {},
		});
		snapshot.mappings = [
			{ id: "requested" },
			{ id: "unrelated" },
		] as typeof snapshot.mappings;

		expect(selectCatalogBreakerMappingIds(snapshot, ["requested"])).toEqual([
			"requested",
		]);
		expect(selectCatalogBreakerMappingIds(snapshot, [])).toEqual([]);
	});
});
