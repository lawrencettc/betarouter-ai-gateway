import { describe, expect, it } from "vitest";

import { buildBootstrapPolicies } from "./bootstrap.js";

const source = {
	providerIds: ["openai"],
	modelIds: ["gpt-5"],
	mappingIds: ["mapping-1"],
	actor: "platform-admin-1",
};

describe("buildBootstrapPolicies", () => {
	it("defaults every source entity to an explicit hidden and disabled policy", () => {
		const result = buildBootstrapPolicies({ ...source, mode: "curated" });

		expect(result.providerPolicies[0]).toMatchObject({
			visible: false,
			enabled: false,
			lifecycle: "draft",
		});
		expect(result.modelPolicies[0]).toMatchObject({
			visible: false,
			enabled: false,
			allowDirect: false,
			lifecycle: "draft",
		});
		expect(result.mappingPolicies[0]).toMatchObject({ enabled: false });
		expect(result.pricePolicies).toEqual([]);
	});

	it("can seed legacy-compatible policy explicitly for shadow comparison", () => {
		const result = buildBootstrapPolicies({ ...source, mode: "legacy" });

		expect(result.providerPolicies[0]).toMatchObject({
			visible: true,
			enabled: true,
			lifecycle: "active",
		});
		expect(result.modelPolicies[0]).toMatchObject({
			visible: true,
			enabled: true,
			lifecycle: "active",
		});
		expect(result.mappingPolicies[0]).toMatchObject({ enabled: true });
		expect(result.pricePolicies[0]).toMatchObject({ mode: "source_cost" });
	});
});
