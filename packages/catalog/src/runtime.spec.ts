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

	it("accepts a matching legacy database checksum without weakening v2 validation", () => {
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
		const legacy = { ...resolved, checksum: "sha256:legacy" };

		expect(parseStoredCatalogSnapshot(legacy, "sha256:legacy").revision).toBe(
			1,
		);
		expect(() =>
			parseStoredCatalogSnapshot(legacy, "sha256:different"),
		).toThrow("checksum");
	});

	it("round-trips base model and mapping data through a stored snapshot", () => {
		const resolved = resolveEffectiveCatalog({
			revision: 9,
			now: new Date("2026-07-22T00:00:00.000Z"),
			providers: [{ id: "relay", status: "active" }],
			models: [
				{
					id: "gpt",
					status: "active",
					name: "GPT",
					family: "openai",
					aliases: ["gpt-latest"],
					output: ["text", "image"],
					free: false,
				},
			],
			mappings: [
				{
					id: "relay-gpt",
					providerId: "relay",
					modelId: "gpt",
					status: "active",
					externalId: "gpt",
					contextSize: 128_000,
					maxOutput: 16_384,
					streaming: true,
					vision: true,
					reasoning: null,
					reasoningMaxTokens: false,
					tools: true,
					jsonOutput: true,
					jsonOutputSchema: false,
					webSearch: false,
					supportedParameters: ["temperature", "max_tokens"],
					pricingTiers: [
						{
							name: "128K",
							upToTokens: 128_000,
							inputPrice: "1.4e-6",
							outputPrice: "5.6e-6",
						},
						{
							name: "unbounded",
							upToTokens: null,
							inputPrice: "2.8e-6",
							outputPrice: "1.12e-5",
						},
					],
					serviceTierMultipliers: { flex: 0.5, priority: 2 },
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
					allowDirect: true,
					lifecycle: "active",
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
		});

		const parsed = parseStoredCatalogSnapshot(
			JSON.parse(JSON.stringify(resolved)),
		);
		expect(parsed.models[0]).toMatchObject({
			name: "GPT",
			family: "openai",
			aliases: ["gpt-latest"],
			output: ["text", "image"],
			free: false,
		});
		expect(parsed.mappings[0]).toMatchObject({
			contextSize: 128_000,
			maxOutput: 16_384,
			streaming: true,
			vision: true,
			reasoning: null,
			reasoningMaxTokens: false,
			tools: true,
			jsonOutput: true,
			jsonOutputSchema: false,
			webSearch: false,
			supportedParameters: ["temperature", "max_tokens"],
			serviceTierMultipliers: { flex: 0.5, priority: 2 },
		});
		expect(parsed.mappings[0]?.pricingTiers).toEqual(
			resolved.mappings[0]?.pricingTiers,
		);

		const recomputed = applyCatalogLifecycleAt(
			parsed,
			new Date("2026-07-22T00:00:00.000Z"),
		);
		expect(recomputed.models[0]?.name).toBe("GPT");
		expect(recomputed.mappings[0]?.pricingTiers).toEqual(
			resolved.mappings[0]?.pricingTiers,
		);
	});

	it("parses snapshots stored before base data existed", () => {
		const resolved = resolveEffectiveCatalog({
			revision: 4,
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
				},
			],
			providerPolicies: [],
			modelPolicies: [],
			mappingPolicies: [],
			providerCredentialAvailability: {},
			mappingReadiness: {},
			breakerStates: {},
		});
		const stored = JSON.parse(JSON.stringify(resolved)) as {
			models: object[];
			mappings: object[];
		};
		expect(stored.models[0]).not.toHaveProperty("name");
		expect(stored.mappings[0]).not.toHaveProperty("contextSize");
		expect(parseStoredCatalogSnapshot(stored).revision).toBe(4);
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
		expect(retired.checksum).not.toBe(stored.checksum);

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
