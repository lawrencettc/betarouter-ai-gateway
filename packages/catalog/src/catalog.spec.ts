import { describe, expect, it } from "vitest";

import {
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
});
