import { describe, expect, it } from "vitest";

import {
	catalogOperationV1Schema,
	providerSourceOverridePatchSchema,
} from "./contracts.js";
import {
	applySourceOverridesToRow,
	catalogOperationTargets,
	catalogSourceInvariantBlockers,
} from "./source-operations.js";

import type { CatalogOperationV1 } from "./contracts.js";

describe("applySourceOverridesToRow", () => {
	const overrides = {
		version: 1 as const,
		fields: {
			inputPrice: {
				value: "2e-6",
				baseValue: "1.5e-6",
				setAt: "2026-08-05T00:00:00.000Z",
				setBy: "operator",
			},
		},
	};

	it("patches static rows and leaves admin rows untouched", () => {
		const staticRow = { id: "m1", source: "static", inputPrice: "1.5e-6" };
		expect(applySourceOverridesToRow(staticRow, overrides).inputPrice).toBe(
			"2e-6",
		);
		expect(staticRow.inputPrice).toBe("1.5e-6");

		const adminRow = { id: "m2", source: "admin", inputPrice: "1.5e-6" };
		expect(applySourceOverridesToRow(adminRow, overrides).inputPrice).toBe(
			"1.5e-6",
		);
	});
});

describe("catalogSourceInvariantBlockers", () => {
	const rows = {
		providers: [
			{ id: "openai", source: "static" },
			{ id: "old-relay", source: "admin" },
		],
		models: [{ id: "gpt-5.5", source: "static" }],
		mappings: [
			{
				id: "map-1",
				modelId: "gpt-5.5",
				providerId: "openai",
				region: null,
				source: "static",
			},
		],
	};

	const mappingCreate = (
		providerId: string,
		region?: string | null,
	): CatalogOperationV1 =>
		catalogOperationV1Schema.parse({
			version: 1,
			type: "mapping.create",
			expectedUpdatedAt: null,
			create: {
				modelId: "gpt-5.5",
				providerId,
				externalId: "gpt-5.5",
				...(region === undefined ? {} : { region }),
			},
		});

	it("catches NULL-region duplicates the unique constraint cannot", () => {
		expect(
			catalogSourceInvariantBlockers(rows, [mappingCreate("openai", null)]),
		).toEqual([
			{
				entityId: "adm:gpt-5.5:openai",
				reasons: ["duplicate_provider_region_mapping"],
			},
		]);
		// A distinct region on the same provider is a valid new slot.
		expect(
			catalogSourceInvariantBlockers(rows, [mappingCreate("openai", "eu")]),
		).toEqual([]);
	});

	it("catches duplicate slots within one change set", () => {
		const create: CatalogOperationV1 = catalogOperationV1Schema.parse({
			version: 1,
			type: "provider.create",
			expectedUpdatedAt: null,
			create: {
				providerId: "acme-relay",
				name: "Acme",
				description: "",
				protocol: "openai-chat",
			},
		});
		const blockers = catalogSourceInvariantBlockers(rows, [
			create,
			mappingCreate("acme-relay"),
			mappingCreate("acme-relay"),
		]);
		expect(blockers).toEqual([
			{
				entityId: "adm:gpt-5.5:acme-relay",
				reasons: ["duplicate_provider_region_mapping", "entity_already_exists"],
			},
		]);
	});

	it("refuses reserved namespaces and missing parents", () => {
		const reserved = catalogSourceInvariantBlockers(rows, [
			catalogOperationV1Schema.parse({
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "llmgateway",
					name: "Nope",
					description: "",
					protocol: "openai-chat",
				},
			}),
			mappingCreate("custom"),
		]);
		expect(reserved).toEqual([
			{ entityId: "llmgateway", reasons: ["reserved_entity_id"] },
			{
				entityId: "adm:gpt-5.5:custom",
				reasons: [
					"mapping_provider_missing",
					"reserved_tenant_provider_namespace",
				],
			},
		]);
	});

	it("flags overrides that target admin-created entities", () => {
		expect(
			catalogSourceInvariantBlockers(rows, [
				{
					version: 1,
					type: "provider.set_source_override",
					providerId: "old-relay",
					expectedUpdatedAt: null,
					patch: providerSourceOverridePatchSchema.parse({ priority: 1 }),
				},
			]),
		).toEqual([
			{ entityId: "old-relay", reasons: ["override_targets_admin_entity"] },
		]);
	});

	it("flags direct updates that target code-defined entities", () => {
		expect(
			catalogSourceInvariantBlockers(rows, [
				{
					version: 1,
					type: "provider.update",
					providerId: "openai",
					expectedUpdatedAt: null,
					patch: { name: "Renamed" },
				},
				{
					version: 1,
					type: "mapping.update",
					mappingId: "map-1",
					expectedUpdatedAt: null,
					patch: { inputPrice: "2e-6" },
				},
				{
					version: 1,
					type: "provider.update",
					providerId: "old-relay",
					expectedUpdatedAt: null,
					patch: { name: "Still fine" },
				},
			]),
		).toEqual([
			{ entityId: "openai", reasons: ["update_targets_static_entity"] },
			{ entityId: "map-1", reasons: ["update_targets_static_entity"] },
		]);
	});
});

describe("catalogOperationTargets", () => {
	it("routes every operation type to its policy table", () => {
		const providerCreate = catalogOperationV1Schema.parse({
			version: 1,
			type: "provider.create",
			expectedUpdatedAt: null,
			create: {
				providerId: "acme-relay",
				name: "Acme",
				description: "",
				protocol: "openai-chat",
			},
		});
		expect(catalogOperationTargets(providerCreate).providerIds).toEqual([
			"acme-relay",
		]);
		const priceOp = catalogOperationV1Schema.parse({
			version: 1,
			type: "mapping.set_price_policy",
			mappingId: "map-1",
			expectedUpdatedAt: null,
			policy: {
				mode: "source_cost",
				currency: "USD",
				allowNegativeMargin: false,
			},
		});
		expect(catalogOperationTargets(priceOp).priceMappingIds).toEqual(["map-1"]);
		const overrideOp = catalogOperationV1Schema.parse({
			version: 1,
			type: "mapping.set_source_override",
			mappingId: "map-1",
			expectedUpdatedAt: null,
			patch: { vision: true },
		});
		expect(catalogOperationTargets(overrideOp).mappingIds).toEqual(["map-1"]);
	});
});
