import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	applyStoredCatalogChangeSet,
	parseStoredCatalogSnapshot,
	reconcileCatalogReviewEntries,
	refreshCatalogRevisionFromSource,
} from "@betarouter/catalog";
import {
	asc,
	db,
	desc,
	eq,
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogReviewEntry,
	platformCatalogRevision,
	platformMappingPolicy,
	platformModelPolicy,
	platformProviderPolicy,
	provider,
} from "@betarouter/db";

import { syncProvidersAndModels } from "./sync-models.js";

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
			createdBy: "phase5-test",
			title: "Phase 5 upstream-change review test",
			reason: "Exercise the review queue end to end",
			state: "draft",
			baseRevision: latest?.id ?? null,
			operations: operations as unknown as PlatformCatalogOperationV1[],
			idempotencyKey: `phase5-${crypto.randomUUID()}`,
		})
		.returning({ id: platformCatalogChangeSet.id });
	return await applyStoredCatalogChangeSet({
		changeSetId: changeSet!.id,
		actorId: "phase5-test",
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

async function openEntries() {
	return await db
		.select()
		.from(platformCatalogReviewEntry)
		.where(eq(platformCatalogReviewEntry.status, "open"))
		.orderBy(asc(platformCatalogReviewEntry.entryKey));
}

async function seedStaticCatalog() {
	await db.insert(provider).values({
		id: "phase5-prov",
		name: "Phase 5 Provider",
		description: "Upstream-change review fixture",
	});
	await db.insert(model).values({ id: "phase5-model", family: "phase5" });
	await db.insert(modelProviderMapping).values({
		id: "phase5-map",
		modelId: "phase5-model",
		providerId: "phase5-prov",
		externalId: "phase5-upstream",
		inputPrice: "0.000003",
		outputPrice: "0.00001",
		streaming: true,
	});
}

async function cleanTables() {
	await db.delete(platformCatalogReviewEntry);
	await db.delete(platformMappingPolicy);
	await db.delete(platformModelPolicy);
	await db.delete(platformProviderPolicy);
	await db.delete(modelProviderMapping);
	await db.delete(model);
	await db.delete(provider);
}

describe("catalog upstream-change review", () => {
	beforeEach(cleanTables);
	afterEach(cleanTables);

	// Phase 5 exit gate (acceptance criterion 4): an upstream price change
	// under an override produces a review-queue entry and does not silently
	// alter the effective price; the operator resolves by keeping (which
	// re-captures the base value) or clearing the override.
	it("surfaces upstream drift under an override without changing the effective price", async () => {
		await seedStaticCatalog();
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });

		const baselineRun = await reconcileCatalogReviewEntries();
		expect(baselineRun.baseline).toBe(true);
		expect(baselineRun.openEntries).toBe(0);
		const seeded = await db.select().from(platformCatalogReviewEntry);
		expect(seeded.length).toBeGreaterThanOrEqual(3);
		expect(
			seeded.every(
				(entry) =>
					entry.status === "resolved" && entry.resolution === "baseline",
			),
		).toBe(true);
		expect(seeded.map((entry) => entry.entryKey)).toEqual(
			expect.arrayContaining([
				"added:provider:phase5-prov",
				"added:model:phase5-model",
				"added:mapping:phase5-map",
			]),
		);

		await applyOperations([
			{
				version: 1,
				type: "mapping.set_source_override",
				mappingId: "phase5-map",
				expectedUpdatedAt: null,
				patch: { inputPrice: "2.5e-6" },
			},
		]);
		expect(await openEntries()).toHaveLength(0);
		let snapshot = await loadLatestSnapshot();
		expect(
			snapshot.mappings.find((item) => item.id === "phase5-map")?.sourcePrices
				.input,
		).toBe("2.5");

		// The next code deploy moves the upstream price; the sync writes the
		// mirror and refreshes the revision, then the review job runs.
		await db
			.update(modelProviderMapping)
			.set({ inputPrice: "0.000004" })
			.where(eq(modelProviderMapping.id, "phase5-map"));
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		const driftRun = await reconcileCatalogReviewEntries();
		expect(driftRun).toMatchObject({
			baseline: false,
			driftOpened: 1,
			driftResolved: 0,
			openEntries: 1,
		});

		const [driftEntry] = await openEntries();
		expect(driftEntry).toMatchObject({
			entryKey: "drift:mapping:phase5-map:inputPrice",
			kind: "override_drift",
			entityType: "mapping",
			entityId: "phase5-map",
			field: "inputPrice",
			driftValues: {
				version: 1,
				override: "2.5e-6",
				base: "0.000003",
				mirror: "0.000004",
			},
		});

		// The override keeps serving: the refreshed revision still prices the
		// mapping at the operator's value, not the moved upstream value.
		snapshot = await loadLatestSnapshot();
		expect(
			snapshot.mappings.find((item) => item.id === "phase5-map")?.sourcePrices
				.input,
		).toBe("2.5");

		// KEEP: re-setting the override re-captures the base value, and the
		// store apply reconciles the queue in the same transaction.
		const [policyBeforeKeep] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, "phase5-map"));
		await applyOperations([
			{
				version: 1,
				type: "mapping.set_source_override",
				mappingId: "phase5-map",
				expectedUpdatedAt: policyBeforeKeep!.updatedAt.toISOString(),
				patch: { inputPrice: "2.5e-6" },
			},
		]);
		expect(await openEntries()).toHaveLength(0);
		const [keptEntry] = await db
			.select()
			.from(platformCatalogReviewEntry)
			.where(
				eq(
					platformCatalogReviewEntry.entryKey,
					"drift:mapping:phase5-map:inputPrice",
				),
			);
		expect(keptEntry).toMatchObject({
			status: "resolved",
			resolution: "override_kept",
			resolvedBy: "phase5-test",
		});
		const [policyAfterKeep] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, "phase5-map"));
		expect(policyAfterKeep?.sourceOverrides?.fields.inputPrice?.baseValue).toBe(
			"0.000004",
		);

		// The same field can drift again after a keep; history stays intact as
		// a second row under the same key.
		await db
			.update(modelProviderMapping)
			.set({ inputPrice: "0.000005" })
			.where(eq(modelProviderMapping.id, "phase5-map"));
		const secondDrift = await reconcileCatalogReviewEntries();
		expect(secondDrift.driftOpened).toBe(1);
		const driftRows = await db
			.select()
			.from(platformCatalogReviewEntry)
			.where(
				eq(
					platformCatalogReviewEntry.entryKey,
					"drift:mapping:phase5-map:inputPrice",
				),
			);
		expect(driftRows).toHaveLength(2);

		// CLEAR: the entry resolves as cleared and the effective price follows
		// the mirrored upstream value again.
		const [policyBeforeClear] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, "phase5-map"));
		await applyOperations([
			{
				version: 1,
				type: "mapping.clear_source_override",
				mappingId: "phase5-map",
				expectedUpdatedAt: policyBeforeClear!.updatedAt.toISOString(),
			},
		]);
		expect(await openEntries()).toHaveLength(0);
		const clearedRows = await db
			.select()
			.from(platformCatalogReviewEntry)
			.where(
				eq(
					platformCatalogReviewEntry.entryKey,
					"drift:mapping:phase5-map:inputPrice",
				),
			)
			.orderBy(desc(platformCatalogReviewEntry.detectedAt));
		expect(clearedRows.map((entry) => entry.resolution).sort()).toEqual([
			"override_cleared",
			"override_kept",
		]);
		snapshot = await loadLatestSnapshot();
		expect(
			snapshot.mappings.find((item) => item.id === "phase5-map")?.sourcePrices
				.input,
		).toBe("5");
	});

	it("queues new upstream entities and code-side retirements as informational entries", async () => {
		await seedStaticCatalog();
		const baselineRun = await reconcileCatalogReviewEntries();
		expect(baselineRun.baseline).toBe(true);

		// The next sync brings a new static model with a mapping, and code
		// retires the original mapping.
		await db.insert(model).values({ id: "phase5-model-2", family: "phase5" });
		await db.insert(modelProviderMapping).values({
			id: "phase5-map-2",
			modelId: "phase5-model-2",
			providerId: "phase5-prov",
			externalId: "phase5-upstream-2",
		});
		await db
			.update(modelProviderMapping)
			.set({ deactivatedAt: new Date("2026-08-05") })
			.where(eq(modelProviderMapping.id, "phase5-map"));

		const review = await reconcileCatalogReviewEntries();
		expect(review).toMatchObject({
			baseline: false,
			driftOpened: 0,
			entitiesAdded: 2,
			entitiesRetired: 1,
			openEntries: 3,
		});
		const open = await openEntries();
		expect(open.map((entry) => entry.entryKey)).toEqual([
			"added:mapping:phase5-map-2",
			"added:model:phase5-model-2",
			"retired:mapping:phase5-map",
		]);
		expect(open.every((entry) => entry.field === null)).toBe(true);

		// Admin-created entities are operator actions, not upstream changes.
		await db
			.insert(model)
			.values({ id: "phase5-admin-model", family: "phase5", source: "admin" });
		const adminRun = await reconcileCatalogReviewEntries();
		expect(adminRun.entitiesAdded).toBe(0);

		// A retirement reverted upstream before review no longer describes
		// reality and closes as superseded.
		await db
			.update(modelProviderMapping)
			.set({ deactivatedAt: null })
			.where(eq(modelProviderMapping.id, "phase5-map"));
		const revertedRun = await reconcileCatalogReviewEntries();
		expect(revertedRun.retirementsSuperseded).toBe(1);
		const [retiredEntry] = await db
			.select()
			.from(platformCatalogReviewEntry)
			.where(
				eq(platformCatalogReviewEntry.entryKey, "retired:mapping:phase5-map"),
			);
		expect(retiredEntry).toMatchObject({
			status: "resolved",
			resolution: "superseded",
		});
	});

	// The sync rewrites every mirrored row on each run (updatedAt bumps and
	// all), so the review must key on values, not writes: a no-change sync at
	// full catalog scale opens nothing.
	it("stays quiet across a no-change sync at full catalog scale", async () => {
		await syncProvidersAndModels();
		const baselineRun = await reconcileCatalogReviewEntries();
		expect(baselineRun.baseline).toBe(true);
		expect(baselineRun.openEntries).toBe(0);
		expect(baselineRun.entitiesAdded).toBeGreaterThan(0);

		await syncProvidersAndModels();
		const secondRun = await reconcileCatalogReviewEntries();
		expect(secondRun).toMatchObject({
			baseline: false,
			driftOpened: 0,
			driftResolved: 0,
			entitiesAdded: 0,
			entitiesRetired: 0,
			retirementsSuperseded: 0,
			openEntries: 0,
		});
	});
});
