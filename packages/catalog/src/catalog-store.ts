import { redisClient } from "@betarouter/cache";
import { db } from "@betarouter/db/db";
import { and, desc, eq, inArray, lte, sql } from "@betarouter/db/orm";
import {
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformMappingPolicy,
	platformMappingPricePolicy,
	platformMappingTestRun,
	platformModelPolicy,
	platformProviderCredential,
	platformProviderPolicy,
	provider,
} from "@betarouter/db/schema";

import { validateCatalogActivation } from "./activation.js";
import { resolveEffectiveCatalog } from "./catalog.js";
import {
	applyCatalogOperations,
	catalogSourceLookupFromRows,
} from "./change-set.js";
import {
	catalogChangeSetInputSchema,
	mappingPolicyPatchSchema,
	mappingPricePolicySchema,
} from "./contracts.js";
import { buildCatalogResolverInput } from "./resolver-input.js";
import {
	catalogOperationTargets,
	catalogSourceInvariantBlockers,
	createdMappingSourceRow,
	createdModelSourceRow,
	createdProviderSourceRow,
	sourceUpdateValues,
} from "./source-operations.js";
import {
	operationsTouchSourceOverrides,
	reconcileCatalogReviewEntries,
} from "./upstream-review.js";

import type { CatalogLifecycle, EffectiveCatalog } from "./catalog.js";
import type {
	CatalogPolicyState,
	CatalogSourceCreate,
	CatalogSourceUpdate,
} from "./change-set.js";
import type { CatalogOperationV1 } from "./contracts.js";
import type { PlatformCatalogOperationV1 } from "@betarouter/db/schema";

const CATALOG_INVALIDATION_CHANNEL = "platform-catalog:invalidate";

export type CatalogTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

async function loadStoreView(tx: CatalogTransaction) {
	const [
		providers,
		models,
		mappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentials,
		tests,
	] = await Promise.all([
		tx.select().from(provider),
		tx.select().from(model),
		tx.select().from(modelProviderMapping),
		tx.select().from(platformProviderPolicy),
		tx.select().from(platformModelPolicy),
		tx.select().from(platformMappingPolicy),
		tx.select().from(platformMappingPricePolicy),
		tx
			.select({
				id: platformProviderCredential.id,
				provider: platformProviderCredential.provider,
				tokenFingerprint: platformProviderCredential.tokenFingerprint,
				baseUrl: platformProviderCredential.baseUrl,
				options: platformProviderCredential.options,
				priority: platformProviderCredential.priority,
			})
			.from(platformProviderCredential)
			.where(
				and(
					eq(platformProviderCredential.status, "active"),
					eq(platformProviderCredential.validationStatus, "valid"),
				),
			),
		tx
			.select({
				mappingId: platformMappingTestRun.mappingId,
				testProfile: platformMappingTestRun.testProfile,
			})
			.from(platformMappingTestRun)
			.where(eq(platformMappingTestRun.status, "passed")),
	]);
	return {
		providers,
		models,
		mappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentials,
		credentialProviderIds: new Set(credentials.map((item) => item.provider)),
		passedTests: new Set(
			tests.map((item) => `${item.mappingId}:${item.testProfile}`),
		),
	};
}

type StoreView = Awaited<ReturnType<typeof loadStoreView>>;

function validateOperationEntities(
	view: StoreView,
	operations: CatalogOperationV1[],
): void {
	const providerIds = new Set(view.providers.map((item) => item.id));
	const modelIds = new Set(view.models.map((item) => item.id));
	const mappingIds = new Set(view.mappings.map((item) => item.id));
	const missing = operations.flatMap((operation) => {
		// Create operations target entities that must NOT exist yet; their
		// existence conflicts and parent checks are contract invariants
		// (`catalogSourceInvariantBlockers`), not missing-entity errors.
		if (
			operation.type === "provider.create" ||
			operation.type === "model.create" ||
			operation.type === "mapping.create"
		) {
			return [];
		}
		if (
			operation.type === "provider.set_policy" ||
			operation.type === "provider.set_source_override" ||
			operation.type === "provider.clear_source_override" ||
			operation.type === "provider.update"
		) {
			return providerIds.has(operation.providerId)
				? []
				: [operation.providerId];
		}
		if (
			operation.type === "model.set_policy" ||
			operation.type === "model.set_source_override" ||
			operation.type === "model.clear_source_override" ||
			operation.type === "model.update"
		) {
			return modelIds.has(operation.modelId) ? [] : [operation.modelId];
		}
		if (operation.type === "entity.archive_policy") {
			const ids =
				operation.entityType === "provider"
					? providerIds
					: operation.entityType === "model"
						? modelIds
						: mappingIds;
			return ids.has(operation.entityId) ? [] : [operation.entityId];
		}
		return mappingIds.has(operation.mappingId) ? [] : [operation.mappingId];
	});
	if (missing.length > 0) {
		throw new Error(
			`Catalog source entities do not exist: ${[...new Set(missing)].join(", ")}`,
		);
	}
}

function validateSourceInvariants(
	view: StoreView,
	operations: CatalogOperationV1[],
): void {
	const blockers = catalogSourceInvariantBlockers(
		{
			providers: view.providers,
			models: view.models,
			mappings: view.mappings,
		},
		operations,
	);
	if (blockers.length > 0) {
		throw new Error(
			`Catalog source invariants are violated: ${blockers
				.map((blocker) => `${blocker.entityId} (${blocker.reasons.join(", ")})`)
				.join("; ")}`,
		);
	}
}

function policyState(view: StoreView): CatalogPolicyState {
	return {
		providers: Object.fromEntries(
			view.providerPolicies.map((row) => [
				row.providerId,
				{
					...row,
					lifecycle: row.lifecycle as CatalogLifecycle,
					deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
					retireAt: row.retireAt?.toISOString() ?? null,
					updatedAt: row.updatedAt.toISOString(),
				},
			]),
		),
		models: Object.fromEntries(
			view.modelPolicies.map((row) => [
				row.modelId,
				{
					...row,
					lifecycle: row.lifecycle as CatalogLifecycle,
					deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
					retireAt: row.retireAt?.toISOString() ?? null,
					updatedAt: row.updatedAt.toISOString(),
				},
			]),
		),
		mappings: Object.fromEntries(
			view.mappingPolicies.map((row) => [
				row.mappingId,
				{
					...row,
					disabledCapabilities:
						mappingPolicyPatchSchema.shape.disabledCapabilities.parse(
							row.disabledCapabilities,
						),
					updatedAt: row.updatedAt.toISOString(),
				},
			]),
		),
		prices: Object.fromEntries(
			view.pricePolicies.map((row) => [
				row.mappingId,
				{
					mappingId: row.mappingId,
					policy: mappingPricePolicySchema.parse({
						mode: row.mode,
						currency: row.currency,
						...(row.markupBps === null ? {} : { markupBps: row.markupBps }),
						...(row.fixedPrices === null
							? {}
							: { fixedPrices: row.fixedPrices }),
						allowNegativeMargin: row.allowNegativeMargin,
						...(row.negativeMarginReason
							? { negativeMarginReason: row.negativeMarginReason }
							: {}),
					}),
					updatedAt: row.updatedAt.toISOString(),
					updatedBy: row.updatedBy,
				},
			]),
		),
	};
}

function resolveStoreSnapshot(
	view: StoreView,
	state: CatalogPolicyState,
	revision: number,
	sourceCreates?: readonly CatalogSourceCreate[],
	sourceUpdates?: readonly CatalogSourceUpdate[],
): EffectiveCatalog {
	return resolveEffectiveCatalog(
		buildCatalogResolverInput({
			revision,
			providers: view.providers,
			models: view.models,
			mappings: view.mappings,
			state,
			sourceCreates,
			sourceUpdates,
			credentials: view.credentials,
			passedTests: view.passedTests,
		}),
	);
}

/**
 * Insert the source rows for admin-created entities. Runs before the policy
 * rows are persisted (they reference the new ids) and uses the exact row
 * shapes the provisional snapshot was resolved with.
 */
export async function persistSourceCreates(
	tx: CatalogTransaction,
	sourceCreates: readonly CatalogSourceCreate[],
): Promise<void> {
	for (const created of sourceCreates) {
		if (created.entityType === "provider") {
			await tx
				.insert(provider)
				.values(createdProviderSourceRow(created.create));
		} else if (created.entityType === "model") {
			await tx.insert(model).values(createdModelSourceRow(created.create));
		} else {
			await tx
				.insert(modelProviderMapping)
				.values(createdMappingSourceRow(created.entityId, created.create));
		}
	}
}

/**
 * Apply direct-update patches to admin-created source rows, using the exact
 * column values the provisional snapshot was resolved with
 * (`sourceUpdateValues`). The operations layer already enforced that every
 * target row exists and is `source = 'admin'`.
 */
export async function persistSourceUpdates(
	tx: CatalogTransaction,
	sourceUpdates: readonly CatalogSourceUpdate[],
): Promise<void> {
	for (const updated of sourceUpdates) {
		const values = sourceUpdateValues(updated.patch);
		if (updated.entityType === "provider") {
			await tx
				.update(provider)
				.set(values)
				.where(eq(provider.id, updated.entityId));
		} else if (updated.entityType === "model") {
			await tx.update(model).set(values).where(eq(model.id, updated.entityId));
		} else {
			await tx
				.update(modelProviderMapping)
				.set(values)
				.where(eq(modelProviderMapping.id, updated.entityId));
		}
	}
}

async function persistState(
	tx: CatalogTransaction,
	state: CatalogPolicyState,
	operations: CatalogOperationV1[],
): Promise<void> {
	const providerIds = new Set<string>();
	const modelIds = new Set<string>();
	const mappingIds = new Set<string>();
	const priceIds = new Set<string>();
	for (const operation of operations) {
		const targets = catalogOperationTargets(operation);
		for (const id of targets.providerIds) {
			providerIds.add(id);
		}
		for (const id of targets.modelIds) {
			modelIds.add(id);
		}
		for (const id of targets.mappingIds) {
			mappingIds.add(id);
		}
		for (const id of targets.priceMappingIds) {
			priceIds.add(id);
		}
	}
	for (const id of providerIds) {
		const row = state.providers[id]!;
		const values = {
			...row,
			deprecatedAt: row.deprecatedAt ? new Date(row.deprecatedAt) : null,
			retireAt: row.retireAt ? new Date(row.retireAt) : null,
			updatedAt: new Date(row.updatedAt),
		};
		await tx.insert(platformProviderPolicy).values(values).onConflictDoUpdate({
			target: platformProviderPolicy.providerId,
			set: values,
		});
	}
	for (const id of modelIds) {
		const row = state.models[id]!;
		const values = {
			...row,
			deprecatedAt: row.deprecatedAt ? new Date(row.deprecatedAt) : null,
			retireAt: row.retireAt ? new Date(row.retireAt) : null,
			updatedAt: new Date(row.updatedAt),
		};
		await tx.insert(platformModelPolicy).values(values).onConflictDoUpdate({
			target: platformModelPolicy.modelId,
			set: values,
		});
	}
	for (const id of mappingIds) {
		const row = state.mappings[id]!;
		const values = { ...row, updatedAt: new Date(row.updatedAt) };
		await tx.insert(platformMappingPolicy).values(values).onConflictDoUpdate({
			target: platformMappingPolicy.mappingId,
			set: values,
		});
	}
	for (const id of priceIds) {
		const row = state.prices[id];
		if (!row) {
			await tx
				.delete(platformMappingPricePolicy)
				.where(eq(platformMappingPricePolicy.mappingId, id));
			continue;
		}
		const policy = row.policy;
		const values = {
			mappingId: id,
			currency: policy.currency,
			mode: policy.mode,
			markupBps: policy.mode === "markup" ? policy.markupBps : null,
			fixedPrices: policy.mode === "fixed" ? policy.fixedPrices : null,
			allowNegativeMargin: policy.allowNegativeMargin,
			negativeMarginReason: policy.negativeMarginReason ?? null,
			updatedAt: new Date(row.updatedAt),
			updatedBy: row.updatedBy,
		};
		await tx
			.insert(platformMappingPricePolicy)
			.values(values)
			.onConflictDoUpdate({
				target: platformMappingPricePolicy.mappingId,
				set: values,
			});
	}
}

export interface AppliedCatalogChangeSet {
	changeSetId: string;
	catalogRevision: number;
	affectedEntities: string[];
	cacheInvalidation: "published" | "failed";
	alreadyApplied?: boolean;
}

export interface CatalogRevisionCounts {
	providers: number;
	models: number;
	mappings: number;
}

export interface CatalogRevisionStatus {
	revision: number;
	publishedAt: string | null;
	publishedChecksum: string | null;
	currentChecksum: string;
	drifted: boolean;
	sourceAhead: boolean;
	sourceUpdatedAt: string | null;
	publishedCounts: CatalogRevisionCounts;
	currentCounts: CatalogRevisionCounts;
}

function storedSnapshotCount(
	snapshot: Record<string, unknown> | undefined,
	key: "providers" | "models" | "mappings",
): number {
	const items = snapshot?.[key];
	return Array.isArray(items) ? items.length : 0;
}

function latestSourceUpdate(view: StoreView): Date | null {
	const timestamps = [
		...view.providers.map((item) => item.updatedAt.getTime()),
		...view.models.map((item) => item.updatedAt.getTime()),
		...view.mappings.map((item) => item.updatedAt.getTime()),
	];
	return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}

export function compareCatalogRevision(
	latest: {
		id: number;
		createdAt: Date;
		checksum: string;
		snapshot: Record<string, unknown>;
	} | null,
	current: EffectiveCatalog,
	sourceUpdatedAt: Date | null,
): CatalogRevisionStatus {
	const publishedAt = latest?.createdAt ?? null;
	const drifted = latest?.checksum !== current.checksum;
	return {
		revision: latest?.id ?? 0,
		publishedAt: publishedAt?.toISOString() ?? null,
		publishedChecksum: latest?.checksum ?? null,
		currentChecksum: current.checksum,
		drifted,
		sourceAhead:
			drifted &&
			sourceUpdatedAt !== null &&
			(publishedAt === null || sourceUpdatedAt > publishedAt),
		sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
		publishedCounts: {
			providers: storedSnapshotCount(latest?.snapshot, "providers"),
			models: storedSnapshotCount(latest?.snapshot, "models"),
			mappings: storedSnapshotCount(latest?.snapshot, "mappings"),
		},
		currentCounts: {
			providers: current.providers.length,
			models: current.models.length,
			mappings: current.mappings.length,
		},
	};
}

export async function getCatalogRevisionStatus(
	input: { transaction?: CatalogTransaction } = {},
): Promise<CatalogRevisionStatus> {
	const inspect = async (tx: CatalogTransaction) => {
		const view = await loadStoreView(tx);
		const current = resolveStoreSnapshot(view, policyState(view), 0);
		const [latest] = await tx
			.select({
				id: platformCatalogRevision.id,
				createdAt: platformCatalogRevision.createdAt,
				checksum: platformCatalogRevision.checksum,
				snapshot: platformCatalogRevision.snapshot,
			})
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		return compareCatalogRevision(
			latest ?? null,
			current,
			latestSourceUpdate(view),
		);
	};
	return input.transaction
		? await inspect(input.transaction)
		: await db.transaction(inspect);
}

/**
 * Publish a new immutable revision when synchronized source metadata changes.
 * Operator policy rows are read, never rewritten, so upstream refreshes cannot
 * undo curation while every consumer still observes one revision/checksum pair.
 */
export async function refreshCatalogRevisionFromSource(
	input: {
		actorId?: string;
		now?: Date;
		transaction?: CatalogTransaction;
		deferInvalidation?: boolean;
	} = {},
): Promise<AppliedCatalogChangeSet | null> {
	const actorId = input.actorId ?? "system:source-sync";
	const now = input.now ?? new Date();
	const publishRevision = async (tx: CatalogTransaction, takeLock: boolean) => {
		if (takeLock) {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
		}
		const view = await loadStoreView(tx);
		const provisional = resolveStoreSnapshot(view, policyState(view), 0);
		const [latest] = await tx
			.select({
				id: platformCatalogRevision.id,
				checksum: platformCatalogRevision.checksum,
			})
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		if (latest?.checksum === provisional.checksum) {
			return null;
		}
		const [changeSet] = await tx
			.insert(platformCatalogChangeSet)
			.values({
				createdBy: actorId,
				title: "Refresh synchronized source catalog",
				reason:
					"Source provider, model, mapping, capability, or price data changed",
				state: "applying",
				baseRevision: latest?.id ?? null,
				operations: [],
				idempotencyKey: `source-sync:${latest?.id ?? "initial"}:${provisional.checksum}`,
			})
			.returning({ id: platformCatalogChangeSet.id });
		if (!changeSet) {
			throw new Error("Source catalog change set was not created");
		}
		const [revision] = await tx
			.insert(platformCatalogRevision)
			.values({
				changeSetId: changeSet.id,
				appliedBy: actorId,
				checksum: provisional.checksum,
				snapshot: provisional as unknown as Record<string, unknown>,
			})
			.returning({ id: platformCatalogRevision.id });
		if (!revision) {
			throw new Error("Source catalog revision was not created");
		}
		const snapshot = { ...provisional, revision: revision.id };
		await tx
			.update(platformCatalogRevision)
			.set({ snapshot: snapshot as unknown as Record<string, unknown> })
			.where(eq(platformCatalogRevision.id, revision.id));
		await tx
			.update(platformCatalogChangeSet)
			.set({
				state: "applied",
				appliedAt: now,
				appliedRevision: revision.id,
				inverseOperations: [],
			})
			.where(eq(platformCatalogChangeSet.id, changeSet.id));
		return {
			changeSetId: changeSet.id,
			catalogRevision: revision.id,
			affectedEntities: [
				...snapshot.providers.map((item) => item.id),
				...snapshot.models.map((item) => item.id),
				...snapshot.mappings.map((item) => item.id),
			],
			cacheInvalidation: "published" as const,
		};
	};
	const result = input.transaction
		? await publishRevision(input.transaction, false)
		: await db.transaction(async (tx) => await publishRevision(tx, true));
	if (!result) {
		return null;
	}
	if (input.deferInvalidation) {
		return result;
	}
	return await publishCatalogRevisionInvalidation(result);
}

export async function publishCatalogRevisionInvalidation(
	result: AppliedCatalogChangeSet,
): Promise<AppliedCatalogChangeSet> {
	try {
		await redisClient.publish(
			CATALOG_INVALIDATION_CHANNEL,
			JSON.stringify({ revision: result.catalogRevision }),
		);
		return result;
	} catch {
		return { ...result, cacheInvalidation: "failed" };
	}
}

export async function applyStoredCatalogChangeSet(input: {
	changeSetId: string;
	actorId: string;
	now?: Date;
	markFailed?: boolean;
}): Promise<AppliedCatalogChangeSet> {
	const now = input.now ?? new Date();
	try {
		const result = await db.transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
			const [changeSet] = await tx
				.select()
				.from(platformCatalogChangeSet)
				.where(eq(platformCatalogChangeSet.id, input.changeSetId))
				.limit(1);
			if (!changeSet) {
				throw new Error("Catalog change set was not found");
			}
			if (changeSet.state === "applied" && changeSet.appliedRevision) {
				return {
					changeSetId: changeSet.id,
					catalogRevision: changeSet.appliedRevision,
					affectedEntities: [],
					cacheInvalidation: "published" as const,
					alreadyApplied: true,
				};
			}
			if (!new Set(["draft", "scheduled"]).has(changeSet.state)) {
				throw new Error("Catalog change set is not applyable");
			}
			if (changeSet.effectiveAt && changeSet.effectiveAt > now) {
				throw new Error("Scheduled catalog change set is not due");
			}
			const [latest] = await tx
				.select({ id: platformCatalogRevision.id })
				.from(platformCatalogRevision)
				.orderBy(desc(platformCatalogRevision.id))
				.limit(1);
			const currentRevision = latest?.id ?? null;
			if (changeSet.baseRevision !== currentRevision) {
				throw new Error("Catalog change set base revision is stale");
			}
			const operations = catalogChangeSetInputSchema.shape.operations.parse(
				changeSet.operations,
			);
			const view = await loadStoreView(tx);
			validateOperationEntities(view, operations);
			validateSourceInvariants(view, operations);
			const applied = applyCatalogOperations({
				state: policyState(view),
				operations,
				actor: input.actorId,
				updatedAt: now.toISOString(),
				sources: catalogSourceLookupFromRows(view),
			});
			const provisional = resolveStoreSnapshot(
				view,
				applied.state,
				0,
				applied.sourceCreates,
				applied.sourceUpdates,
			);
			const previousSnapshot = resolveStoreSnapshot(
				view,
				policyState(view),
				currentRevision ?? 0,
			);
			validateCatalogActivation(
				provisional,
				applied.state,
				applied.affectedEntityIds,
				previousSnapshot,
			);
			await tx
				.update(platformCatalogChangeSet)
				.set({ state: "applying", errorCode: null })
				.where(eq(platformCatalogChangeSet.id, changeSet.id));
			await persistSourceCreates(tx, applied.sourceCreates);
			await persistSourceUpdates(tx, applied.sourceUpdates);
			await persistState(tx, applied.state, operations);
			const [revision] = await tx
				.insert(platformCatalogRevision)
				.values({
					changeSetId: changeSet.id,
					appliedBy: input.actorId,
					checksum: provisional.checksum,
					snapshot: provisional as unknown as Record<string, unknown>,
				})
				.returning({ id: platformCatalogRevision.id });
			if (!revision) {
				throw new Error("Catalog revision was not created");
			}
			const snapshot = { ...provisional, revision: revision.id };
			await tx
				.update(platformCatalogRevision)
				.set({ snapshot: snapshot as unknown as Record<string, unknown> })
				.where(eq(platformCatalogRevision.id, revision.id));
			await tx
				.update(platformCatalogChangeSet)
				.set({
					state: "applied",
					appliedAt: now,
					appliedRevision: revision.id,
					inverseOperations:
						applied.inverseOperations as PlatformCatalogOperationV1[],
				})
				.where(eq(platformCatalogChangeSet.id, changeSet.id));
			if (operationsTouchSourceOverrides(operations)) {
				// Keeping or clearing an override is exactly how drift entries
				// resolve, so reconcile the review queue in the same transaction
				// instead of leaving the entry open until the next worker pass.
				await reconcileCatalogReviewEntries({
					transaction: tx,
					actorId: input.actorId,
					now,
				});
			}
			return {
				changeSetId: changeSet.id,
				catalogRevision: revision.id,
				affectedEntities: applied.affectedEntityIds,
				cacheInvalidation: "published" as const,
			};
		});
		if (result.alreadyApplied) {
			return result;
		}
		try {
			await redisClient.publish(
				CATALOG_INVALIDATION_CHANNEL,
				JSON.stringify({ revision: result.catalogRevision }),
			);
			return result;
		} catch {
			return { ...result, cacheInvalidation: "failed" };
		}
	} catch (error) {
		if (input.markFailed) {
			await db
				.update(platformCatalogChangeSet)
				.set({
					state: "failed",
					errorCode:
						error instanceof Error
							? error.message.slice(0, 255)
							: "apply_failed",
				})
				.where(
					and(
						eq(platformCatalogChangeSet.id, input.changeSetId),
						inArray(platformCatalogChangeSet.state, ["scheduled", "applying"]),
					),
				);
		}
		throw error;
	}
}

export async function applyDueCatalogChangeSets(
	input: {
		actorId?: string;
		now?: Date;
		limit?: number;
	} = {},
): Promise<Array<AppliedCatalogChangeSet & { error?: string }>> {
	const now = input.now ?? new Date();
	const due = await db
		.select({ id: platformCatalogChangeSet.id })
		.from(platformCatalogChangeSet)
		.where(
			and(
				eq(platformCatalogChangeSet.state, "scheduled"),
				lte(platformCatalogChangeSet.effectiveAt, now),
			),
		)
		.orderBy(platformCatalogChangeSet.effectiveAt)
		.limit(Math.min(Math.max(input.limit ?? 20, 1), 100));
	const results: Array<AppliedCatalogChangeSet & { error?: string }> = [];
	for (const item of due) {
		try {
			results.push(
				await applyStoredCatalogChangeSet({
					changeSetId: item.id,
					actorId: input.actorId ?? "system:scheduler",
					now,
					markFailed: true,
				}),
			);
		} catch (error) {
			results.push({
				changeSetId: item.id,
				catalogRevision: 0,
				affectedEntities: [],
				cacheInvalidation: "failed",
				error: error instanceof Error ? error.message : "apply_failed",
			});
		}
	}
	return results;
}
