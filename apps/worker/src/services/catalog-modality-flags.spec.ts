import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	applyStoredCatalogChangeSet,
	parseStoredCatalogSnapshot,
	refreshCatalogRevisionFromSource,
	resolveModelFromCatalog,
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
			createdBy: "modality-flags-test",
			title: "Modality-flag snapshot test",
			reason: "Exercise modality flags end to end",
			state: "draft",
			baseRevision: latest?.id ?? null,
			operations: operations as unknown as PlatformCatalogOperationV1[],
			idempotencyKey: `modality-${crypto.randomUUID()}`,
		})
		.returning({ id: platformCatalogChangeSet.id });
	return await applyStoredCatalogChangeSet({
		changeSetId: changeSet!.id,
		actorId: "modality-flags-test",
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

async function cleanTables() {
	await db.delete(platformMappingPolicy);
	await db.delete(platformModelPolicy);
	await db.delete(platformProviderPolicy);
	await db.delete(modelProviderMapping);
	await db.delete(model);
	await db.delete(provider);
}

describe("catalog modality-flag snapshot gap", () => {
	beforeEach(cleanTables);
	afterEach(cleanTables);

	// Exit gate: an admin-created non-chat model has no static definition to
	// graft modality flags from, so the snapshot alone must route it — create
	// through change-set ops, publish, parse the stored revision, and
	// reconstruct a definition that carries the flags.
	it("serves admin-created non-chat mappings from the snapshot alone", async () => {
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		await applyOperations([
			{
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "modality-prov",
					name: "Modality Provider",
					description: "Video relay",
					protocol: "openai-chat",
				},
			},
			{
				version: 1,
				type: "model.create",
				expectedUpdatedAt: null,
				create: {
					modelId: "modality-video-model",
					family: "modality",
					output: ["video"],
					imageInputRequired: true,
				},
			},
			{
				version: 1,
				type: "mapping.create",
				expectedUpdatedAt: null,
				create: {
					modelId: "modality-video-model",
					providerId: "modality-prov",
					externalId: "modality-video-upstream",
					videoGenerations: true,
					perSecondPrice: { "720p": "0.14" },
				},
			},
		]);
		const mappingId = "adm:modality-video-model:modality-prov";

		// The source rows themselves carry the flags (persistSourceCreates).
		const [modelRow] = await db
			.select()
			.from(model)
			.where(eq(model.id, "modality-video-model"));
		expect(modelRow).toMatchObject({
			source: "admin",
			imageInputRequired: true,
		});
		const [mappingRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, mappingId));
		expect(mappingRow).toMatchObject({
			source: "admin",
			videoGenerations: true,
			embeddings: false,
		});

		// The provisional snapshot was resolved from in-memory synthesized rows;
		// a source-driven refresh finding the same checksum proves persistence
		// wrote exactly those values (flags included).
		expect(
			await refreshCatalogRevisionFromSource({ deferInvalidation: true }),
		).toBeNull();

		const snapshot = await loadLatestSnapshot();
		expect(
			snapshot.models.find((item) => item.id === "modality-video-model"),
		).toMatchObject({ output: ["video"], imageInputRequired: true });
		expect(
			snapshot.mappings.find((item) => item.id === mappingId),
		).toMatchObject({ videoGenerations: true, embeddings: false });

		const resolved = resolveModelFromCatalog("modality-video-model", snapshot, {
			staticModels: [],
		});
		expect(resolved).not.toBeNull();
		expect(resolved?.imageInputRequired).toBe(true);
		expect(resolved?.output).toEqual(["video"]);
		expect(resolved?.providers[0]).toMatchObject({
			providerId: "modality-prov",
			externalId: "modality-video-upstream",
			videoGenerations: true,
		});
	});

	it("round-trips modality flags through direct updates and the snapshot", async () => {
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		await applyOperations([
			{
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "modality-prov",
					name: "Modality Provider",
					description: "Rerank relay",
					protocol: "openai-chat",
				},
			},
			{
				version: 1,
				type: "model.create",
				expectedUpdatedAt: null,
				create: {
					modelId: "modality-rerank-model",
					family: "modality",
					output: ["rerank"],
				},
			},
			{
				version: 1,
				type: "mapping.create",
				expectedUpdatedAt: null,
				create: {
					modelId: "modality-rerank-model",
					providerId: "modality-prov",
					externalId: "modality-rerank-upstream",
					embeddings: true,
				},
			},
		]);
		const mappingId = "adm:modality-rerank-model:modality-prov";
		const [policy] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, mappingId));
		await applyOperations([
			{
				version: 1,
				type: "mapping.update",
				mappingId,
				expectedUpdatedAt: policy!.updatedAt.toISOString(),
				patch: { embeddings: false, rerank: true },
			},
		]);

		const [updatedRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, mappingId));
		expect(updatedRow).toMatchObject({ embeddings: false, rerank: true });
		const snapshot = await loadLatestSnapshot();
		expect(
			snapshot.mappings.find((item) => item.id === mappingId),
		).toMatchObject({ embeddings: false, rerank: true });
	});
});
