import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	applyStoredCatalogChangeSet,
	catalogChangeSetInputSchema,
	normalizePersistedInverseOperations,
	parseStoredCatalogSnapshot,
	refreshCatalogRevisionFromSource,
} from "@betarouter/catalog";
import {
	db,
	desc,
	eq,
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformMappingPolicy,
	platformModelPolicy,
	platformProviderPolicy,
	provider,
} from "@betarouter/db";

import type { CatalogOperationV1 } from "@betarouter/catalog";
import type { PlatformCatalogOperationV1 } from "@betarouter/db";

async function applyOperations(operations: CatalogOperationV1[]) {
	const [latest] = await db
		.select({ id: platformCatalogRevision.id })
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	const [changeSet] = await db
		.insert(platformCatalogChangeSet)
		.values({
			createdBy: "phase6-test",
			title: "Phase 6 direct-update test",
			reason: "Exercise admin-row updates end to end",
			state: "draft",
			baseRevision: latest?.id ?? null,
			operations: operations as unknown as PlatformCatalogOperationV1[],
			idempotencyKey: `phase6-${crypto.randomUUID()}`,
		})
		.returning({ id: platformCatalogChangeSet.id });
	return await applyStoredCatalogChangeSet({
		changeSetId: changeSet!.id,
		actorId: "phase6-test",
	});
}

async function loadLatestSnapshot() {
	const [revision] = await db
		.select({
			checksum: platformCatalogRevision.checksum,
			snapshot: platformCatalogRevision.snapshot,
		})
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	expect(revision).toBeDefined();
	return parseStoredCatalogSnapshot(revision!.snapshot, revision!.checksum);
}

async function seedStaticCatalog() {
	await db.insert(provider).values({
		id: "phase6-prov",
		name: "Phase 6 Provider",
		description: "Direct-update fixture",
	});
	await db.insert(model).values({ id: "phase6-model", family: "phase6" });
	await db.insert(modelProviderMapping).values({
		id: "phase6-map",
		modelId: "phase6-model",
		providerId: "phase6-prov",
		externalId: "phase6-upstream",
		inputPrice: "0.000003",
		outputPrice: "0.00001",
		streaming: true,
	});
}

async function cleanTables() {
	await db.delete(platformMappingPolicy);
	await db.delete(platformModelPolicy);
	await db.delete(platformProviderPolicy);
	await db.delete(modelProviderMapping);
	await db.delete(model);
	await db.delete(provider);
}

describe("catalog admin-row direct updates", () => {
	beforeEach(cleanTables);
	afterEach(cleanTables);

	// Phase 6 exit support (decision 2): admin-created rows are edited
	// directly through change-set preview/apply; the snapshot, the source row,
	// and the rollback inverse all agree on the values.
	it("updates an admin mapping through a change set and restores it via the inverse", async () => {
		await seedStaticCatalog();
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });

		await applyOperations([
			{
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "phase6-relay",
					name: "Phase 6 Relay",
					description: "OpenAI-compatible relay",
					protocol: "openai-chat",
				},
			},
			{
				version: 1,
				type: "mapping.create",
				expectedUpdatedAt: null,
				create: {
					modelId: "phase6-model",
					providerId: "phase6-relay",
					externalId: "phase6-relay-upstream",
					inputPrice: "2e-6",
					outputPrice: "8e-6",
				},
			},
		]);
		const mappingId = "adm:phase6-model:phase6-relay";
		let snapshot = await loadLatestSnapshot();
		expect(
			snapshot.mappings.find((item) => item.id === mappingId)?.sourcePrices
				.input,
		).toBe("2");

		const [policy] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, mappingId));
		const updateResult = await applyOperations([
			{
				version: 1,
				type: "mapping.update",
				mappingId,
				expectedUpdatedAt: policy!.updatedAt.toISOString(),
				patch: {
					externalId: "phase6-relay-v2",
					inputPrice: "3e-6",
					vision: true,
				},
			},
		]);

		// The source row itself carries the new values (numeric columns come
		// back Postgres-normalized), and the published snapshot follows.
		const [updatedRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, mappingId));
		expect(updatedRow).toMatchObject({
			source: "admin",
			externalId: "phase6-relay-v2",
			inputPrice: "0.000003",
			vision: true,
		});
		snapshot = await loadLatestSnapshot();
		const updatedMapping = snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		expect(updatedMapping?.sourcePrices.input).toBe("3");
		expect(updatedMapping?.externalId).toBe("phase6-relay-v2");

		// Replaying the persisted inverse (exactly what the rollback route
		// does) restores the previous source values.
		const [appliedChangeSet] = await db
			.select()
			.from(platformCatalogChangeSet)
			.where(eq(platformCatalogChangeSet.id, updateResult.changeSetId));
		const inverse = catalogChangeSetInputSchema.shape.operations.parse(
			normalizePersistedInverseOperations(appliedChangeSet!.inverseOperations),
		);
		expect(inverse[0]).toMatchObject({
			type: "mapping.update",
			mappingId,
			patch: {
				externalId: "phase6-relay-upstream",
				inputPrice: "0.000002",
				vision: null,
			},
		});
		await applyOperations(inverse);
		const [restoredRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, mappingId));
		expect(restoredRow).toMatchObject({
			externalId: "phase6-relay-upstream",
			inputPrice: "0.000002",
			vision: null,
		});
		snapshot = await loadLatestSnapshot();
		expect(
			snapshot.mappings.find((item) => item.id === mappingId)?.sourcePrices
				.input,
		).toBe("2");
	});

	it("updates admin provider and model rows and reflects model changes in the snapshot", async () => {
		await seedStaticCatalog();
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		await applyOperations([
			{
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "phase6-relay",
					name: "Phase 6 Relay",
					description: "OpenAI-compatible relay",
					protocol: "openai-chat",
				},
			},
			{
				version: 1,
				type: "model.create",
				expectedUpdatedAt: null,
				create: { modelId: "phase6-admin-model", family: "phase6" },
			},
		]);

		const [providerPolicy] = await db
			.select()
			.from(platformProviderPolicy)
			.where(eq(platformProviderPolicy.providerId, "phase6-relay"));
		const [modelPolicy] = await db
			.select()
			.from(platformModelPolicy)
			.where(eq(platformModelPolicy.modelId, "phase6-admin-model"));
		await applyOperations([
			{
				version: 1,
				type: "provider.update",
				providerId: "phase6-relay",
				expectedUpdatedAt: providerPolicy!.updatedAt.toISOString(),
				patch: { name: "Phase 6 Relay EU", website: "https://relay.example" },
			},
			{
				version: 1,
				type: "model.update",
				modelId: "phase6-admin-model",
				expectedUpdatedAt: modelPolicy!.updatedAt.toISOString(),
				patch: { name: "Phase 6 Admin Model", family: "phase6-2" },
			},
		]);

		const [providerRow] = await db
			.select()
			.from(provider)
			.where(eq(provider.id, "phase6-relay"));
		expect(providerRow).toMatchObject({
			name: "Phase 6 Relay EU",
			website: "https://relay.example",
			source: "admin",
		});
		const snapshot = await loadLatestSnapshot();
		expect(
			snapshot.models.find((item) => item.id === "phase6-admin-model"),
		).toMatchObject({ name: "Phase 6 Admin Model", family: "phase6-2" });
	});

	it("rejects direct updates that target code-defined rows", async () => {
		await seedStaticCatalog();
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		await expect(
			applyOperations([
				{
					version: 1,
					type: "mapping.update",
					mappingId: "phase6-map",
					expectedUpdatedAt: null,
					patch: { inputPrice: "9e-6" },
				},
			]),
		).rejects.toThrow(/update_targets_static_entity/);
		const [row] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, "phase6-map"));
		expect(row?.inputPrice).toBe("0.000003");
	});
});
