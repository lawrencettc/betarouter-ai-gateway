import { describe, expect, it } from "vitest";

import {
	applyCatalogOperations,
	CatalogConflictError,
	normalizePersistedInverseOperations,
	type CatalogPolicyState,
} from "./change-set.js";
import {
	catalogChangeSetInputSchema,
	catalogOperationV1Schema,
	type CatalogOperationV1,
} from "./contracts.js";

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

	it("generates inverse policy operations that survive persisted schema validation", () => {
		const existingState: CatalogPolicyState = {
			providers: state.providers,
			models: {
				"gpt-5.5": {
					modelId: "gpt-5.5",
					visible: false,
					enabled: false,
					allowDirect: false,
					lifecycle: "draft",
					updatedAt: "2026-07-22T00:00:00.000Z",
					updatedBy: "admin-1",
				},
			},
			mappings: {
				"mapping-1": {
					mappingId: "mapping-1",
					enabled: false,
					weight: 0,
					updatedAt: "2026-07-22T00:00:00.000Z",
					updatedBy: "admin-1",
				},
			},
			prices: {},
		};
		const applied = applyCatalogOperations({
			state: existingState,
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
					modelId: "gpt-5.5",
					expectedUpdatedAt: "2026-07-22T00:00:00.000Z",
					patch: { enabled: true },
				},
				{
					version: 1,
					type: "mapping.set_policy",
					mappingId: "mapping-1",
					expectedUpdatedAt: "2026-07-22T00:00:00.000Z",
					patch: { enabled: true },
				},
			],
		});

		expect(
			applied.inverseOperations.map(
				(operation) => catalogOperationV1Schema.safeParse(operation).success,
			),
		).toEqual([true, true, true]);
	});

	it("normalizes identity fields from legacy persisted inverse patches", () => {
		const legacyOperations = [
			{
				version: 1,
				type: "provider.set_policy",
				providerId: "openai",
				expectedUpdatedAt: "2026-07-22T01:00:00.000Z",
				patch: {
					providerId: "openai",
					enabled: false,
					updatedAt: "2026-07-22T00:00:00.000Z",
					updatedBy: "admin-1",
				},
			},
			{
				version: 1,
				type: "model.set_policy",
				modelId: "gpt-5.5",
				expectedUpdatedAt: "2026-07-22T01:00:00.000Z",
				patch: {
					modelId: "gpt-5.5",
					enabled: false,
					updatedAt: "2026-07-22T00:00:00.000Z",
					updatedBy: "admin-1",
				},
			},
			{
				version: 1,
				type: "mapping.set_policy",
				mappingId: "mapping-1",
				expectedUpdatedAt: "2026-07-22T01:00:00.000Z",
				patch: {
					mappingId: "mapping-1",
					enabled: false,
					updatedAt: "2026-07-22T00:00:00.000Z",
					updatedBy: "admin-1",
				},
			},
		];

		expect(
			catalogOperationV1Schema
				.array()
				.safeParse(normalizePersistedInverseOperations(legacyOperations))
				.success,
		).toBe(true);
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

	it("supports a 500-row bulk change without partial application", () => {
		const bulkState: CatalogPolicyState = {
			providers: {},
			models: {},
			mappings: {},
			prices: {},
		};
		const operations: CatalogOperationV1[] = Array.from(
			{ length: 500 },
			(_, index) => ({
				version: 1,
				type: "model.set_policy",
				modelId: `bulk-model-${index}`,
				expectedUpdatedAt: null,
				patch: {
					visible: false,
					enabled: false,
					allowDirect: false,
					lifecycle: "draft",
				},
			}),
		);
		const changeSet = {
			title: "Curate 500 models",
			reason: "Verify the documented bulk-operation launch boundary",
			baseRevision: 40,
			effectiveAt: null,
			idempotencyKey: "bulk-500-models",
			operations,
		};

		expect(catalogChangeSetInputSchema.safeParse(changeSet).success).toBe(true);
		expect(
			catalogChangeSetInputSchema.safeParse({
				...changeSet,
				operations: [...operations, operations[0]],
			}).success,
		).toBe(false);

		const applied = applyCatalogOperations({
			state: bulkState,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			operations,
		});
		expect(Object.keys(applied.state.models)).toHaveLength(500);
		expect(applied.affectedEntityIds).toHaveLength(500);
		expect(applied.inverseOperations).toHaveLength(500);
		expect(bulkState.models).toEqual({});

		const conflictingOperations = operations.map((operation, index) =>
			index === operations.length - 1 && operation.type === "model.set_policy"
				? {
						...operation,
						expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
					}
				: operation,
		);
		expect(() =>
			applyCatalogOperations({
				state: bulkState,
				actor: "admin-2",
				updatedAt: "2026-07-22T01:00:00.000Z",
				operations: conflictingOperations,
			}),
		).toThrow(CatalogConflictError);
		expect(bulkState.models).toEqual({});
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

	it("rolls a newly created price policy back to absence", () => {
		const appliedAt = "2026-07-22T01:00:00.000Z";
		const applied = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: appliedAt,
			operations: [
				{
					version: 1,
					type: "mapping.set_price_policy",
					mappingId: "mapping-1",
					expectedUpdatedAt: null,
					policy: {
						mode: "source_cost",
						currency: "USD",
						allowNegativeMargin: false,
					},
				},
			],
		});
		expect(applied.inverseOperations).toEqual([
			{
				version: 1,
				type: "mapping.clear_price_policy",
				mappingId: "mapping-1",
				expectedUpdatedAt: appliedAt,
			},
		]);

		const rolledBack = applyCatalogOperations({
			state: applied.state,
			actor: "admin-2",
			updatedAt: "2026-07-22T02:00:00.000Z",
			operations: applied.inverseOperations,
		});
		expect(rolledBack.state.prices).toEqual({});
	});
});
