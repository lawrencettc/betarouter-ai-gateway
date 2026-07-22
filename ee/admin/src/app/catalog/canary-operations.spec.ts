import { describe, expect, it } from "vitest";

import { prepareHiddenCanaryOperations } from "./canary-operations.js";

describe("hidden catalog canary operations", () => {
	it("atomically enables hidden dependencies and forces zero mapping weight", () => {
		const operations = prepareHiddenCanaryOperations(
			{
				id: "mapping-id",
				providerId: "openai",
				modelId: "gpt-5.5",
				providerPolicy: { updatedAt: "2026-07-22T14:00:00.000Z" },
				modelPolicy: { updatedAt: "2026-07-22T14:01:00.000Z" },
			} as Parameters<typeof prepareHiddenCanaryOperations>[0],
			[
				{
					version: 1,
					type: "mapping.set_policy",
					mappingId: "mapping-id",
					expectedUpdatedAt: null,
					patch: { enabled: false, priority: 100, weight: 9000 },
				},
				{
					version: 1,
					type: "mapping.set_price_policy",
					mappingId: "mapping-id",
					expectedUpdatedAt: null,
					policy: { mode: "source_cost" },
				},
			],
		);

		expect(operations).toEqual([
			{
				version: 1,
				type: "provider.set_policy",
				providerId: "openai",
				expectedUpdatedAt: "2026-07-22T14:00:00.000Z",
				patch: { enabled: true, visible: false, lifecycle: "active" },
			},
			{
				version: 1,
				type: "model.set_policy",
				modelId: "gpt-5.5",
				expectedUpdatedAt: "2026-07-22T14:01:00.000Z",
				patch: {
					enabled: true,
					visible: false,
					allowDirect: false,
					lifecycle: "active",
				},
			},
			{
				version: 1,
				type: "mapping.set_policy",
				mappingId: "mapping-id",
				expectedUpdatedAt: null,
				patch: { enabled: true, priority: 100, weight: 0 },
			},
			{
				version: 1,
				type: "mapping.set_price_policy",
				mappingId: "mapping-id",
				expectedUpdatedAt: null,
				policy: { mode: "source_cost" },
			},
		]);
	});
});
