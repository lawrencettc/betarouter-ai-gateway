import { describe, expect, it } from "vitest";

import { filterProviderMappingsByCatalog } from "./catalog-policy.js";

import type { CatalogRequestDecision } from "@llmgateway/catalog";
import type { ProviderModelMapping } from "@llmgateway/models";

describe("filterProviderMappingsByCatalog", () => {
	it("removes disabled fallbacks and applies the effective external id", () => {
		const providers = [
			{ providerId: "openai", externalId: "old", streaming: true },
			{ providerId: "relay", externalId: "relay", streaming: true },
		] as ProviderModelMapping[];
		const decision = {
			allowed: true,
			revision: 4,
			mappingIds: ["mapping-2", "mapping-1"],
			mappings: [
				{
					id: "mapping-2",
					providerId: "relay",
					modelId: "gpt",
					region: "us-east",
					externalId: "relay-priority",
					displayable: true,
					available: true,
					routable: true,
					probeOnly: false,
					priority: 0,
					weight: 100,
					reasons: [],
				},
				{
					id: "mapping-1",
					providerId: "openai",
					modelId: "gpt",
					region: null,
					externalId: "new-upstream-id",
					displayable: true,
					available: true,
					routable: true,
					probeOnly: false,
					priority: 1,
					weight: 100,
					reasons: [],
				},
			],
			deprecated: false,
			deprecatedAt: null,
			retireAt: null,
			replacementModelId: null,
		} satisfies Extract<CatalogRequestDecision, { allowed: true }>;

		expect(filterProviderMappingsByCatalog(providers, decision)).toEqual([
			expect.objectContaining({
				providerId: "relay",
				region: "us-east",
				externalId: "relay-priority",
			}),
			expect.objectContaining({
				providerId: "openai",
				externalId: "new-upstream-id",
			}),
		]);
	});
});
