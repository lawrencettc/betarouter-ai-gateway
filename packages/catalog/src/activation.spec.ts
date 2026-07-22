import { describe, expect, it } from "vitest";

import {
	findCatalogRoutabilityLosses,
	validateCatalogActivation,
} from "./activation.js";
import { resolveEffectiveCatalog } from "./catalog.js";

import type { CatalogPolicyState } from "./change-set.js";

function state(mappingIds: string[]): CatalogPolicyState {
	return {
		providers: {
			openai: {
				providerId: "openai",
				visible: true,
				enabled: true,
				lifecycle: "active",
				updatedAt: "2026-07-22T00:00:00.000Z",
				updatedBy: "operator",
			},
		},
		models: {
			gpt: {
				modelId: "gpt",
				visible: true,
				enabled: true,
				allowDirect: true,
				lifecycle: "active",
				updatedAt: "2026-07-22T00:00:00.000Z",
				updatedBy: "operator",
			},
		},
		mappings: Object.fromEntries(
			mappingIds.map((mappingId) => [
				mappingId,
				{
					mappingId,
					enabled: mappingId !== "primary",
					updatedAt: "2026-07-22T00:00:00.000Z",
					updatedBy: "operator",
				},
			]),
		),
		prices: {},
	};
}

function snapshot(mappingIds: string[]) {
	const policyState = state(mappingIds);
	return {
		policyState,
		snapshot: resolveEffectiveCatalog({
			revision: 1,
			now: new Date("2026-07-22T00:00:00.000Z"),
			providers: [{ id: "openai", status: "active" }],
			models: [{ id: "gpt", status: "active" }],
			mappings: mappingIds.map((id) => ({
				id,
				providerId: "openai",
				modelId: "gpt",
				status: "active" as const,
				externalId: id,
			})),
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
					allowDirect: true,
					lifecycle: "active",
				},
			],
			mappingPolicies: Object.values(policyState.mappings).map((policy) => ({
				mappingId: policy.mappingId,
				enabled: policy.enabled,
				priority: 100,
				weight: 100,
				breakerEnabled: true,
			})),
			providerCredentialAvailability: { openai: true },
			mappingReadiness: Object.fromEntries(
				mappingIds.map((id) => [id, { priceReady: true, testPassed: true }]),
			),
			breakerStates: {},
		}),
	};
}

describe("validateCatalogActivation", () => {
	it("blocks disabling the last available mapping for an enabled model/provider", () => {
		const result = snapshot(["primary"]);

		expect(() =>
			validateCatalogActivation(result.snapshot, result.policyState, [
				"primary",
			]),
		).toThrow(/no available mapping/);
	});

	it("allows a mapping disable when an available fallback remains", () => {
		const result = snapshot(["primary", "fallback"]);

		expect(() =>
			validateCatalogActivation(result.snapshot, result.policyState, [
				"primary",
			]),
		).not.toThrow();
	});

	it("reports only routability lost by the proposed change", () => {
		const before = snapshot(["primary", "fallback"]);
		const after = structuredClone(before.snapshot);
		for (const mapping of after.mappings) {
			mapping.routable = false;
		}

		expect(
			findCatalogRoutabilityLosses(before.snapshot, after, before.policyState),
		).toEqual(["gpt"]);
		expect(
			findCatalogRoutabilityLosses(after, after, before.policyState),
		).toEqual([]);
		expect(() =>
			validateCatalogActivation(
				after,
				before.policyState,
				["fallback"],
				before.snapshot,
			),
		).toThrow(/fallback coverage lost/);
	});
});
