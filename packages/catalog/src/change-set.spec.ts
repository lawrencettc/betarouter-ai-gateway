import { describe, expect, it } from "vitest";

import {
	applyCatalogOperations,
	CatalogConflictError,
	catalogSourceLookupFromRows,
	normalizePersistedInverseOperations,
	type CatalogPolicyState,
} from "./change-set.js";
import {
	adminMappingId,
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

describe("source override operations", () => {
	const sources = catalogSourceLookupFromRows({
		providers: [{ id: "openai", source: "static" }],
		models: [{ id: "gpt-5.5", source: "static" }],
		mappings: [
			{
				id: "mapping-1",
				source: "static",
				inputPrice: "1.5e-6",
				vision: false,
			},
			{ id: "mapping-admin", source: "admin" },
		],
	});

	it("records the mirrored base value at set-time and restores on rollback", () => {
		const applied = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "mapping.set_source_override",
					mappingId: "mapping-1",
					expectedUpdatedAt: null,
					patch: { inputPrice: "2e-6", vision: true },
				},
			],
		});

		expect(applied.state.mappings["mapping-1"]?.sourceOverrides).toEqual({
			version: 1,
			fields: {
				inputPrice: {
					value: "2e-6",
					baseValue: "1.5e-6",
					setAt: "2026-07-22T01:00:00.000Z",
					setBy: "admin-2",
				},
				vision: {
					value: true,
					baseValue: false,
					setAt: "2026-07-22T01:00:00.000Z",
					setBy: "admin-2",
				},
			},
		});
		expect(applied.sourceCreates).toEqual([]);
		expect(applied.inverseOperations[0]).toMatchObject({
			type: "mapping.set_source_override",
			mappingId: "mapping-1",
			patch: { inputPrice: null, vision: null },
		});
		expect(
			catalogOperationV1Schema.safeParse(applied.inverseOperations[0]).success,
		).toBe(true);

		const rolledBack = applyCatalogOperations({
			state: applied.state,
			actor: "admin-2",
			updatedAt: "2026-07-22T02:00:00.000Z",
			sources,
			operations: applied.inverseOperations,
		});
		expect(rolledBack.state.mappings["mapping-1"]?.sourceOverrides).toBeNull();
	});

	it("merges per-field patches and clears single fields with null", () => {
		const first = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "mapping.set_source_override",
					mappingId: "mapping-1",
					expectedUpdatedAt: null,
					patch: { inputPrice: "2e-6", vision: true },
				},
			],
		});
		const second = applyCatalogOperations({
			state: first.state,
			actor: "admin-3",
			updatedAt: "2026-07-22T02:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "mapping.set_source_override",
					mappingId: "mapping-1",
					expectedUpdatedAt: "2026-07-22T01:00:00.000Z",
					patch: { inputPrice: null, tools: true },
				},
			],
		});
		const overrides = second.state.mappings["mapping-1"]?.sourceOverrides;
		expect(Object.keys(overrides?.fields ?? {}).sort()).toEqual([
			"tools",
			"vision",
		]);
		expect(second.inverseOperations[0]).toMatchObject({
			patch: { inputPrice: "2e-6", tools: null },
		});
	});

	it("refuses overrides on admin-created entities", () => {
		expect(() =>
			applyCatalogOperations({
				state,
				actor: "admin-2",
				updatedAt: "2026-07-22T01:00:00.000Z",
				sources,
				operations: [
					{
						version: 1,
						type: "mapping.set_source_override",
						mappingId: "mapping-admin",
						expectedUpdatedAt: null,
						patch: { vision: true },
					},
				],
			}),
		).toThrow(/admin-created/);
	});

	it("clears all overrides and produces a full restore inverse", () => {
		const applied = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "mapping.set_source_override",
					mappingId: "mapping-1",
					expectedUpdatedAt: null,
					patch: { inputPrice: "2e-6", vision: true },
				},
			],
		});
		const cleared = applyCatalogOperations({
			state: applied.state,
			actor: "admin-2",
			updatedAt: "2026-07-22T02:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "mapping.clear_source_override",
					mappingId: "mapping-1",
					expectedUpdatedAt: "2026-07-22T01:00:00.000Z",
				},
			],
		});
		expect(cleared.state.mappings["mapping-1"]?.sourceOverrides).toBeNull();
		expect(cleared.inverseOperations[0]).toMatchObject({
			type: "mapping.set_source_override",
			patch: { inputPrice: "2e-6", vision: true },
		});
		expect(
			catalogOperationV1Schema.safeParse(cleared.inverseOperations[0]).success,
		).toBe(true);

		expect(() =>
			applyCatalogOperations({
				state: cleared.state,
				actor: "admin-2",
				updatedAt: "2026-07-22T03:00:00.000Z",
				sources,
				operations: [
					{
						version: 1,
						type: "mapping.clear_source_override",
						mappingId: "mapping-1",
						expectedUpdatedAt: "2026-07-22T02:00:00.000Z",
					},
				],
			}),
		).toThrow(CatalogConflictError);
	});

	it("keeps set_policy inverse patches free of sourceOverrides", () => {
		const withOverride = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "provider.set_source_override",
					providerId: "openai",
					expectedUpdatedAt: "2026-07-22T00:00:00.000Z",
					patch: { priority: 5 },
				},
			],
		});
		const policyChange = applyCatalogOperations({
			state: withOverride.state,
			actor: "admin-2",
			updatedAt: "2026-07-22T02:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "provider.set_policy",
					providerId: "openai",
					expectedUpdatedAt: "2026-07-22T01:00:00.000Z",
					patch: { enabled: true },
				},
			],
		});
		// The policy change must not drop the stored override…
		expect(
			policyChange.state.providers.openai?.sourceOverrides?.fields.priority
				?.value,
		).toBe(5);
		// …and its inverse must survive the strict patch schema.
		expect(
			catalogOperationV1Schema.safeParse(policyChange.inverseOperations[0])
				.success,
		).toBe(true);
	});
});

describe("creation operations", () => {
	const sources = catalogSourceLookupFromRows({
		providers: [{ id: "openai", source: "static" }],
		models: [{ id: "gpt-5.5", source: "static" }],
		mappings: [],
	});

	it("creates provider, model, and mapping with draft policies and archive inverses", () => {
		const appliedAt = "2026-07-22T01:00:00.000Z";
		const applied = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: appliedAt,
			sources,
			operations: [
				{
					version: 1,
					type: "provider.create",
					expectedUpdatedAt: null,
					create: {
						providerId: "acme-relay",
						name: "Acme Relay",
						description: "OpenAI-compatible relay",
						protocol: "openai-chat",
					},
				},
				{
					version: 1,
					type: "model.create",
					expectedUpdatedAt: null,
					create: { modelId: "acme-model", family: "acme" },
				},
				{
					version: 1,
					type: "mapping.create",
					expectedUpdatedAt: null,
					create: {
						modelId: "gpt-5.5",
						providerId: "acme-relay",
						externalId: "gpt-5.5",
						inputPrice: "1.5e-6",
						outputPrice: "6e-6",
					},
				},
			],
		});

		const mappingId = adminMappingId({
			modelId: "gpt-5.5",
			providerId: "acme-relay",
		});
		expect(mappingId).toBe("adm:gpt-5.5:acme-relay");
		expect(applied.state.providers["acme-relay"]).toMatchObject({
			visible: false,
			enabled: false,
			lifecycle: "draft",
		});
		expect(applied.state.models["acme-model"]).toMatchObject({
			enabled: false,
			allowDirect: false,
		});
		expect(applied.state.mappings[mappingId]).toMatchObject({
			enabled: false,
		});
		expect(applied.sourceCreates.map((item) => item.entityId)).toEqual([
			"acme-relay",
			"acme-model",
			mappingId,
		]);
		expect(
			applied.inverseOperations.map((operation) => operation.type),
		).toEqual([
			"entity.archive_policy",
			"entity.archive_policy",
			"entity.archive_policy",
		]);
		expect(
			applied.inverseOperations.every(
				(operation) => catalogOperationV1Schema.safeParse(operation).success,
			),
		).toBe(true);

		// The inverse retires the created entries without deleting anything.
		const rolledBack = applyCatalogOperations({
			state: applied.state,
			actor: "admin-2",
			updatedAt: "2026-07-22T02:00:00.000Z",
			sources,
			operations: applied.inverseOperations,
		});
		expect(rolledBack.state.providers["acme-relay"]?.lifecycle).toBe("retired");
		expect(rolledBack.state.mappings[mappingId]?.enabled).toBe(false);
	});

	it("rejects creating an entity that already exists in the source tables", () => {
		expect(() =>
			applyCatalogOperations({
				state,
				actor: "admin-2",
				updatedAt: "2026-07-22T01:00:00.000Z",
				sources,
				operations: [
					{
						version: 1,
						type: "provider.create",
						expectedUpdatedAt: null,
						create: {
							providerId: "openai",
							name: "OpenAI again",
							description: "duplicate",
							protocol: "openai-chat",
						},
					},
				],
			}),
		).toThrow(CatalogConflictError);
	});
});

describe("direct update operations", () => {
	const sources = catalogSourceLookupFromRows({
		providers: [
			{ id: "openai", source: "static" },
			{
				id: "acme-relay",
				source: "admin",
				name: "Acme Relay",
				description: "OpenAI-compatible relay",
				protocol: "openai-chat",
				website: null,
			},
		],
		models: [{ id: "acme-model", source: "admin", family: "acme" }],
		mappings: [
			{ id: "mapping-1", source: "static", inputPrice: "1.5e-6" },
			{
				id: "adm:gpt-5.5:acme-relay",
				source: "admin",
				externalId: "gpt-5.5",
				inputPrice: "2e-6",
				outputPrice: "8e-6",
				vision: null,
				streaming: true,
			},
		],
	});

	it("updates an admin mapping, captures previous values in the inverse, and restores on rollback", () => {
		const applied = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "mapping.update",
					mappingId: "adm:gpt-5.5:acme-relay",
					expectedUpdatedAt: null,
					patch: { inputPrice: "3e-6", vision: true, externalId: "gpt-5.5-v2" },
				},
			],
		});

		expect(applied.sourceUpdates).toEqual([
			{
				entityType: "mapping",
				entityId: "adm:gpt-5.5:acme-relay",
				patch: { inputPrice: "3e-6", vision: true, externalId: "gpt-5.5-v2" },
			},
		]);
		// A policy record now anchors optimistic concurrency for the row.
		expect(applied.state.mappings["adm:gpt-5.5:acme-relay"]).toMatchObject({
			enabled: false,
			updatedAt: "2026-07-22T01:00:00.000Z",
		});
		// The inverse restores each touched field's previous value; a
		// previously-NULL nullable column round-trips as null.
		expect(applied.inverseOperations[0]).toMatchObject({
			type: "mapping.update",
			mappingId: "adm:gpt-5.5:acme-relay",
			patch: { inputPrice: "2e-6", vision: null, externalId: "gpt-5.5" },
		});
		expect(
			catalogOperationV1Schema.safeParse(applied.inverseOperations[0]).success,
		).toBe(true);

		const rolledBack = applyCatalogOperations({
			state: applied.state,
			actor: "admin-2",
			updatedAt: "2026-07-22T02:00:00.000Z",
			sources,
			operations: applied.inverseOperations,
		});
		expect(rolledBack.sourceUpdates).toEqual([
			{
				entityType: "mapping",
				entityId: "adm:gpt-5.5:acme-relay",
				patch: { inputPrice: "2e-6", vision: null, externalId: "gpt-5.5" },
			},
		]);
	});

	it("updates admin providers and models with schema-valid inverses", () => {
		const applied = applyCatalogOperations({
			state,
			actor: "admin-2",
			updatedAt: "2026-07-22T01:00:00.000Z",
			sources,
			operations: [
				{
					version: 1,
					type: "provider.update",
					providerId: "acme-relay",
					expectedUpdatedAt: null,
					patch: { name: "Acme Relay EU", website: "https://acme.example" },
				},
				{
					version: 1,
					type: "model.update",
					modelId: "acme-model",
					expectedUpdatedAt: null,
					patch: { family: "acme-2" },
				},
			],
		});
		expect(applied.sourceUpdates).toEqual([
			{
				entityType: "provider",
				entityId: "acme-relay",
				patch: { name: "Acme Relay EU", website: "https://acme.example" },
			},
			{
				entityType: "model",
				entityId: "acme-model",
				patch: { family: "acme-2" },
			},
		]);
		expect(
			applied.inverseOperations.map((operation) => operation.type),
		).toEqual(["model.update", "provider.update"]);
		expect(applied.inverseOperations[1]).toMatchObject({
			patch: { name: "Acme Relay", website: null },
		});
		expect(
			applied.inverseOperations.every(
				(operation) => catalogOperationV1Schema.safeParse(operation).success,
			),
		).toBe(true);
	});

	it("refuses direct updates on code-defined entities", () => {
		expect(() =>
			applyCatalogOperations({
				state,
				actor: "admin-2",
				updatedAt: "2026-07-22T01:00:00.000Z",
				sources,
				operations: [
					{
						version: 1,
						type: "mapping.update",
						mappingId: "mapping-1",
						expectedUpdatedAt: null,
						patch: { inputPrice: "3e-6" },
					},
				],
			}),
		).toThrow(/code-defined/);
	});

	it("treats a missing target row as a conflict", () => {
		expect(() =>
			applyCatalogOperations({
				state,
				actor: "admin-2",
				updatedAt: "2026-07-22T01:00:00.000Z",
				sources,
				operations: [
					{
						version: 1,
						type: "provider.update",
						providerId: "ghost-provider",
						expectedUpdatedAt: null,
						patch: { name: "Ghost" },
					},
				],
			}),
		).toThrow(CatalogConflictError);
	});
});
