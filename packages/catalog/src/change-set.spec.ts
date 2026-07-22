import { describe, expect, it } from "vitest";

import {
	applyCatalogOperations,
	CatalogConflictError,
	type CatalogPolicyState,
} from "./change-set.js";

const state: CatalogPolicyState = {
	providers: {
		openai: {
			providerId: "openai",
			visible: false,
			enabled: false,
			lifecycle: "draft",
			updatedAt: "2026-07-22T00:00:00.000Z",
			updatedBy: "admin-1",
		},
	},
	models: {},
	mappings: {},
	prices: {},
};

describe("applyCatalogOperations", () => {
	it("applies a batch to a cloned state and generates an inverse", () => {
		const result = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			operations: [
				{
					version: 1,
					type: "provider.set_policy",
					providerId: "openai",
					expectedUpdatedAt: "2026-07-22T00:00:00.000Z",
					patch: { visible: true, enabled: true, lifecycle: "active" },
				},
			],
		});

		expect(result.state.providers.openai).toMatchObject({
			visible: true,
			enabled: true,
			lifecycle: "active",
			updatedBy: "admin-2",
		});
		expect(state.providers.openai?.enabled).toBe(false);
		expect(result.inverseOperations[0]).toMatchObject({
			type: "provider.set_policy",
			providerId: "openai",
			patch: { visible: false, enabled: false, lifecycle: "draft" },
		});
	});

	it("rejects the complete batch atomically on an optimistic conflict", () => {
		expect(() =>
			applyCatalogOperations({
				state,
				actor: "admin-2",
				updatedAt: "2026-07-22T01:00:00.000Z",
				operations: [
					{
						version: 1,
						type: "provider.set_policy",
						providerId: "openai",
						expectedUpdatedAt: "2026-07-22T00:00:00.000Z",
						patch: { enabled: true },
					},
					{
						version: 1,
						type: "model.set_policy",
						modelId: "gpt-5",
						expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
						patch: { enabled: true },
					},
				],
			}),
		).toThrow(CatalogConflictError);

		expect(state.providers.openai?.enabled).toBe(false);
	});

	it("archives without deleting policy history", () => {
		const result = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			operations: [
				{
					version: 1,
					type: "entity.archive_policy",
					entityType: "provider",
					entityId: "openai",
					expectedUpdatedAt: "2026-07-22T00:00:00.000Z",
				},
			],
		});

		expect(result.state.providers.openai).toMatchObject({
			visible: false,
			enabled: false,
			lifecycle: "retired",
		});
	});
});
