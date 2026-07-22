import { describe, expect, it } from "vitest";

import { compareCatalogRevision } from "./catalog-store.js";
import {
	calculateCatalogChecksum,
	resolveEffectiveCatalog,
	type CatalogResolverInput,
} from "./catalog.js";

const now = new Date("2026-07-22T00:00:00.000Z");

function input(
	overrides: Partial<CatalogResolverInput> = {},
): CatalogResolverInput {
	return {
		revision: 7,
		now,
		providers: [{ id: "openai", status: "active" }],
		models: [{ id: "gpt", status: "active" }],
		mappings: [
			{
				id: "openai-gpt",
				providerId: "openai",
				modelId: "gpt",
				status: "active",
				externalId: "gpt-upstream",
			},
		],
		providerPolicies: [],
		modelPolicies: [],
		mappingPolicies: [],
		providerCredentialAvailability: {},
		mappingReadiness: {},
		breakerStates: {},
		...overrides,
	};
}

describe("resolveEffectiveCatalog", () => {
	it("calculates the same v2 checksum regardless of object key order", () => {
		const left = {
			providers: [{ id: "openai", visible: false }],
			prices: { input: "5", output: "30" },
		};
		const right = {
			prices: { output: "30", input: "5" },
			providers: [{ visible: false, id: "openai" }],
		};

		expect(calculateCatalogChecksum(left)).toBe(
			calculateCatalogChecksum(right),
		);
		expect(calculateCatalogChecksum(left)).toMatch(/^sha256:v2:[a-f0-9]{64}$/);
	});

	it("keeps source entries hidden and unavailable until the operator publishes policy", () => {
		const catalog = resolveEffectiveCatalog(input());

		expect(catalog.visibleProviderIds).toEqual([]);
		expect(catalog.visibleModelIds).toEqual([]);
		expect(catalog.availableModelIds).toEqual([]);
		expect(catalog.routableMappingIds).toEqual([]);
		expect(catalog.mappings[0]?.reasons).toContain("mapping_policy_missing");
	});

	it("keeps visibility separate from availability when credentials are missing", () => {
		const catalog = resolveEffectiveCatalog(
			input({
				providerPolicies: [
					{
						providerId: "openai",
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
					},
				],
				mappingPolicies: [
					{
						mappingId: "openai-gpt",
						enabled: true,
						priority: 100,
						weight: 100,
						breakerEnabled: true,
					},
				],
				mappingReadiness: {
					"openai-gpt": { priceReady: true, testPassed: true },
				},
			}),
		);

		expect(catalog.visibleProviderIds).toEqual(["openai"]);
		expect(catalog.visibleModelIds).toEqual(["gpt"]);
		expect(catalog.availableModelIds).toEqual([]);
		expect(catalog.routableMappingIds).toEqual([]);
		expect(catalog.mappings[0]?.reasons).toContain(
			"provider_credential_unavailable",
		);
	});

	it("does not let a credential bypass disabled mapping policy", () => {
		const catalog = resolveEffectiveCatalog(
			input({
				providerPolicies: [
					{
						providerId: "openai",
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
					},
				],
				mappingPolicies: [
					{
						mappingId: "openai-gpt",
						enabled: false,
						priority: 100,
						weight: 100,
						breakerEnabled: true,
					},
				],
				providerCredentialAvailability: { openai: true },
				mappingReadiness: {
					"openai-gpt": { priceReady: true, testPassed: true },
				},
			}),
		);

		expect(catalog.routableMappingIds).toEqual([]);
		expect(catalog.mappings[0]?.reasons).toContain("mapping_disabled");
	});

	it("removes an open mapping from routing while retaining a healthy fallback", () => {
		const catalog = resolveEffectiveCatalog(
			input({
				providers: [
					{ id: "openai", status: "active" },
					{ id: "relay", status: "active" },
				],
				mappings: [
					{
						id: "openai-gpt",
						providerId: "openai",
						modelId: "gpt",
						status: "active",
						externalId: "gpt-upstream",
					},
					{
						id: "relay-gpt",
						providerId: "relay",
						modelId: "gpt",
						status: "active",
						externalId: "gpt-relay",
					},
				],
				providerPolicies: ["openai", "relay"].map((providerId) => ({
					providerId,
					visible: true,
					enabled: true,
					lifecycle: "active" as const,
				})),
				modelPolicies: [
					{
						modelId: "gpt",
						visible: true,
						enabled: true,
						allowDirect: false,
						lifecycle: "active",
					},
				],
				mappingPolicies: ["openai-gpt", "relay-gpt"].map(
					(mappingId, priority) => ({
						mappingId,
						enabled: true,
						priority,
						weight: 100,
						breakerEnabled: true,
					}),
				),
				providerCredentialAvailability: { openai: true, relay: true },
				mappingReadiness: {
					"openai-gpt": { priceReady: true, testPassed: true },
					"relay-gpt": { priceReady: true, testPassed: true },
				},
				breakerStates: {
					"openai-gpt": { state: "open" },
					"relay-gpt": { state: "closed" },
				},
			}),
		);

		expect(catalog.availableModelIds).toEqual(["gpt"]);
		expect(catalog.routableMappingIds).toEqual(["relay-gpt"]);
		expect(catalog.mappings[0]?.reasons).toContain("circuit_open");
	});

	it("transitions from deprecated to retired at the configured dates", () => {
		const base = input({
			providerPolicies: [
				{
					providerId: "openai",
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
					deprecatedAt: new Date("2026-07-20T00:00:00.000Z"),
					retireAt: new Date("2026-07-23T00:00:00.000Z"),
				},
			],
			mappingPolicies: [
				{
					mappingId: "openai-gpt",
					enabled: true,
					priority: 100,
					weight: 100,
					breakerEnabled: true,
				},
			],
			providerCredentialAvailability: { openai: true },
			mappingReadiness: {
				"openai-gpt": { priceReady: true, testPassed: true },
			},
		});

		expect(resolveEffectiveCatalog(base).models[0]?.lifecycle).toBe(
			"deprecated",
		);
		expect(
			resolveEffectiveCatalog({
				...base,
				now: new Date("2026-07-23T00:00:00.000Z"),
			}).models[0]?.lifecycle,
		).toBe("retired");
	});

	it("produces a stable checksum independent of source row order", () => {
		const first = resolveEffectiveCatalog(input());
		const second = resolveEffectiveCatalog(
			input({
				providers: [...input().providers].reverse(),
				models: [...input().models].reverse(),
				mappings: [...input().mappings].reverse(),
			}),
		);

		expect(second.checksum).toBe(first.checksum);
	});

	it("uses a content checksum that can repeat across rollback revisions", () => {
		const first = resolveEffectiveCatalog(input());
		const restored = resolveEffectiveCatalog({ ...input(), revision: 99 });

		expect(restored.checksum).toBe(first.checksum);
		expect(restored.revision).toBe(99);
	});
});

describe("compareCatalogRevision", () => {
	it("reports an unpublished catalog as drifted", () => {
		const current = resolveEffectiveCatalog(input());
		const status = compareCatalogRevision(null, current, null);

		expect(status).toMatchObject({
			revision: 0,
			drifted: true,
			sourceAhead: false,
			publishedAt: null,
			publishedChecksum: null,
			publishedCounts: { providers: 0, models: 0, mappings: 0 },
		});
	});

	it("reports a matching published checksum as current", () => {
		const current = resolveEffectiveCatalog(input());
		const status = compareCatalogRevision(
			{
				id: 7,
				createdAt: now,
				checksum: current.checksum,
				snapshot: current as unknown as Record<string, unknown>,
			},
			current,
			new Date("2026-07-22T00:01:00.000Z"),
		);

		expect(status).toMatchObject({
			revision: 7,
			drifted: false,
			sourceAhead: false,
			publishedChecksum: current.checksum,
			currentChecksum: current.checksum,
			publishedCounts: { providers: 1, models: 1, mappings: 1 },
		});
	});

	it("reports checksum and source-count drift from the published snapshot", () => {
		const current = resolveEffectiveCatalog(input());
		const publishedAt = new Date("2026-07-22T00:00:00.000Z");
		const status = compareCatalogRevision(
			{
				id: 6,
				createdAt: publishedAt,
				checksum: "sha256:previous",
				snapshot: { providers: [], models: [], mappings: [] },
			},
			current,
			new Date("2026-07-22T00:01:00.000Z"),
		);

		expect(status).toMatchObject({
			revision: 6,
			drifted: true,
			sourceAhead: true,
			publishedChecksum: "sha256:previous",
			currentChecksum: current.checksum,
			publishedCounts: { providers: 0, models: 0, mappings: 0 },
			currentCounts: { providers: 1, models: 1, mappings: 1 },
		});
	});
});
