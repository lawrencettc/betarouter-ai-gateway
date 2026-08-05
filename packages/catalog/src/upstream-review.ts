import { db } from "@betarouter/db/db";
import { eq, sql } from "@betarouter/db/orm";
import {
	model,
	modelProviderMapping,
	platformCatalogReviewEntry,
	platformMappingPolicy,
	platformModelPolicy,
	platformProviderPolicy,
	provider,
} from "@betarouter/db/schema";

import type { CatalogTransaction } from "./catalog-store.js";
import type { SourceOverridesRecord } from "./change-set.js";
import type { CatalogOperationV1 } from "./contracts.js";
import type { PlatformCatalogReviewResolution } from "@betarouter/db/schema";

export type CatalogReviewEntityType = "provider" | "model" | "mapping";

export type CatalogReviewKind =
	"override_drift" | "entity_added" | "entity_retired";

export interface CatalogSourceDriftField {
	entityType: CatalogReviewEntityType;
	entityId: string;
	field: string;
	overrideValue: unknown;
	baseValue: unknown;
	mirrorValue: unknown;
}

export interface CatalogReviewSourceRows {
	providers: ReadonlyArray<
		Record<string, unknown> & { id: string; source: string }
	>;
	models: ReadonlyArray<
		Record<string, unknown> & { id: string; source: string }
	>;
	mappings: ReadonlyArray<
		Record<string, unknown> & { id: string; source: string }
	>;
}

export interface CatalogReviewOverrideRows {
	providers: ReadonlyArray<{
		providerId: string;
		sourceOverrides: SourceOverridesRecord | null;
	}>;
	models: ReadonlyArray<{
		modelId: string;
		sourceOverrides: SourceOverridesRecord | null;
	}>;
	mappings: ReadonlyArray<{
		mappingId: string;
		sourceOverrides: SourceOverridesRecord | null;
	}>;
}

export interface CatalogReviewSummary {
	baseline: boolean;
	driftOpened: number;
	driftResolved: number;
	entitiesAdded: number;
	entitiesRetired: number;
	retirementsSuperseded: number;
	openEntries: number;
}

export function catalogReviewEntryKey(
	kind: CatalogReviewKind,
	entityType: CatalogReviewEntityType,
	entityId: string,
	field?: string | null,
): string {
	const prefix =
		kind === "override_drift"
			? "drift"
			: kind === "entity_added"
				? "added"
				: "retired";
	return field
		? `${prefix}:${entityType}:${entityId}:${field}`
		: `${prefix}:${entityType}:${entityId}`;
}

/**
 * Overrides record their base value through jsonb, so the stored image has
 * dates as ISO strings and no undefined. Current mirror values must pass
 * through the same projection before comparison.
 */
export function catalogReviewJsonImage(value: unknown): unknown {
	if (value === undefined || value === null) {
		return null;
	}
	return JSON.parse(JSON.stringify(value)) as unknown;
}

export function catalogJsonValuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return (
			a.length === b.length &&
			a.every((item, index) => catalogJsonValuesEqual(item, b[index]))
		);
	}
	if (
		a !== null &&
		b !== null &&
		typeof a === "object" &&
		typeof b === "object" &&
		!Array.isArray(a) &&
		!Array.isArray(b)
	) {
		const left = a as Record<string, unknown>;
		const right = b as Record<string, unknown>;
		const leftKeys = Object.keys(left);
		return (
			leftKeys.length === Object.keys(right).length &&
			leftKeys.every(
				(key) =>
					Object.prototype.hasOwnProperty.call(right, key) &&
					catalogJsonValuesEqual(left[key], right[key]),
			)
		);
	}
	return false;
}

function entityDrift(
	entityType: CatalogReviewEntityType,
	rows: ReadonlyArray<Record<string, unknown> & { id: string; source: string }>,
	overridesById: ReadonlyMap<string, SourceOverridesRecord | null>,
): CatalogSourceDriftField[] {
	const drift: CatalogSourceDriftField[] = [];
	for (const row of rows) {
		// Overrides only ever apply to static rows; a record left behind after a
		// source change has no mirror to drift from.
		if (row.source !== "static") {
			continue;
		}
		const overrides = overridesById.get(row.id);
		if (!overrides) {
			continue;
		}
		for (const [field, record] of Object.entries(overrides.fields)) {
			const mirrorValue = catalogReviewJsonImage(row[field]);
			const baseValue = catalogReviewJsonImage(record.baseValue);
			if (!catalogJsonValuesEqual(baseValue, mirrorValue)) {
				drift.push({
					entityType,
					entityId: row.id,
					field,
					overrideValue: catalogReviewJsonImage(record.value),
					baseValue,
					mirrorValue,
				});
			}
		}
	}
	return drift;
}

/**
 * Every field where a source override exists AND the mirrored value moved
 * since the override captured its base value. The overlay design makes this a
 * pure diff: the operator's value keeps serving either way, and the entry is
 * only a prompt to re-affirm (re-set, which re-captures base) or clear it.
 */
export function detectSourceOverrideDrift(
	rows: CatalogReviewSourceRows,
	overrides: CatalogReviewOverrideRows,
): CatalogSourceDriftField[] {
	return [
		...entityDrift(
			"provider",
			rows.providers,
			new Map(
				overrides.providers.map((item) => [
					item.providerId,
					item.sourceOverrides,
				]),
			),
		),
		...entityDrift(
			"model",
			rows.models,
			new Map(
				overrides.models.map((item) => [item.modelId, item.sourceOverrides]),
			),
		),
		...entityDrift(
			"mapping",
			rows.mappings,
			new Map(
				overrides.mappings.map((item) => [
					item.mappingId,
					item.sourceOverrides,
				]),
			),
		),
	];
}

export function operationsTouchSourceOverrides(
	operations: ReadonlyArray<Pick<CatalogOperationV1, "type">>,
): boolean {
	return operations.some((operation) =>
		operation.type.endsWith("source_override"),
	);
}

function entityRetired(row: {
	source: string;
	status: string;
	deactivatedAt?: Date | null;
}): boolean {
	return (
		row.source === "static" &&
		(row.status === "inactive" ||
			(row.deactivatedAt !== null && row.deactivatedAt !== undefined))
	);
}

const INSERT_CHUNK_SIZE = 500;

/**
 * Reconcile the upstream-change review queue against the current mirror.
 *
 * Drift entries open while an override's recorded base value differs from the
 * mirrored row and auto-resolve once the operator keeps the override (any
 * re-set re-captures the base value) or clears it — the resolution label is
 * derived from whether the override still exists. Informational entries
 * surface entities and retirements not seen before; the first run ever seeds
 * the existing catalog as pre-resolved `baseline` rows so deploying this does
 * not flood the queue with history.
 *
 * Callers holding the catalog advisory lock pass their transaction; without
 * one, the function opens its own and takes the lock, so reviews never race
 * applies or the source sync.
 */
export async function reconcileCatalogReviewEntries(
	input: {
		actorId?: string;
		now?: Date;
		transaction?: CatalogTransaction;
	} = {},
): Promise<CatalogReviewSummary> {
	const run = async (tx: CatalogTransaction): Promise<CatalogReviewSummary> => {
		const now = input.now ?? new Date();
		const actorId = input.actorId ?? "system:catalog-review";
		const [
			providers,
			models,
			mappings,
			providerPolicies,
			modelPolicies,
			mappingPolicies,
			entries,
		] = await Promise.all([
			tx.select().from(provider),
			tx.select().from(model),
			tx.select().from(modelProviderMapping),
			tx
				.select({
					providerId: platformProviderPolicy.providerId,
					sourceOverrides: platformProviderPolicy.sourceOverrides,
				})
				.from(platformProviderPolicy),
			tx
				.select({
					modelId: platformModelPolicy.modelId,
					sourceOverrides: platformModelPolicy.sourceOverrides,
				})
				.from(platformModelPolicy),
			tx
				.select({
					mappingId: platformMappingPolicy.mappingId,
					sourceOverrides: platformMappingPolicy.sourceOverrides,
				})
				.from(platformMappingPolicy),
			tx
				.select({
					id: platformCatalogReviewEntry.id,
					entryKey: platformCatalogReviewEntry.entryKey,
					status: platformCatalogReviewEntry.status,
					kind: platformCatalogReviewEntry.kind,
					entityType: platformCatalogReviewEntry.entityType,
					entityId: platformCatalogReviewEntry.entityId,
					field: platformCatalogReviewEntry.field,
				})
				.from(platformCatalogReviewEntry),
		]);

		const baseline = entries.length === 0;
		const overrideRows: CatalogReviewOverrideRows = {
			providers: providerPolicies,
			models: modelPolicies,
			mappings: mappingPolicies,
		};
		const drift = detectSourceOverrideDrift(
			{ providers, models, mappings },
			overrideRows,
		);
		const driftByKey = new Map(
			drift.map((item) => [
				catalogReviewEntryKey(
					"override_drift",
					item.entityType,
					item.entityId,
					item.field,
				),
				item,
			]),
		);

		const overridesLookup: Record<
			CatalogReviewEntityType,
			ReadonlyMap<string, SourceOverridesRecord | null>
		> = {
			provider: new Map(
				providerPolicies.map((item) => [item.providerId, item.sourceOverrides]),
			),
			model: new Map(
				modelPolicies.map((item) => [item.modelId, item.sourceOverrides]),
			),
			mapping: new Map(
				mappingPolicies.map((item) => [item.mappingId, item.sourceOverrides]),
			),
		};

		const allKeys = new Set(entries.map((entry) => entry.entryKey));
		const openByKey = new Map(
			entries
				.filter((entry) => entry.status === "open")
				.map((entry) => [entry.entryKey, entry]),
		);

		type NewEntry = typeof platformCatalogReviewEntry.$inferInsert;
		const inserts: NewEntry[] = [];
		const resolveById = new Map<
			string,
			{ resolution: PlatformCatalogReviewResolution }
		>();
		const refresh: Array<{ id: string; item: CatalogSourceDriftField }> = [];

		let driftOpened = 0;
		for (const [entryKey, item] of driftByKey) {
			const open = openByKey.get(entryKey);
			if (open) {
				// Still drifting: keep the entry fresh — the mirror may have moved
				// again since detection.
				refresh.push({ id: open.id, item });
				continue;
			}
			driftOpened++;
			inserts.push({
				entryKey,
				kind: "override_drift",
				entityType: item.entityType,
				entityId: item.entityId,
				field: item.field,
				driftValues: {
					version: 1,
					override: item.overrideValue,
					base: item.baseValue,
					mirror: item.mirrorValue,
				},
				status: "open",
				detectedAt: now,
				lastSeenAt: now,
			});
		}

		let driftResolved = 0;
		for (const [entryKey, entry] of openByKey) {
			if (entry.kind !== "override_drift" || driftByKey.has(entryKey)) {
				continue;
			}
			driftResolved++;
			const overrides = overridesLookup[entry.entityType].get(entry.entityId);
			const kept =
				entry.field !== null && overrides?.fields[entry.field] !== undefined;
			resolveById.set(entry.id, {
				resolution: kept ? "override_kept" : "override_cleared",
			});
		}

		const informational = (
			kind: Extract<CatalogReviewKind, "entity_added" | "entity_retired">,
			entityType: CatalogReviewEntityType,
			entityId: string,
		): NewEntry => ({
			entryKey: catalogReviewEntryKey(kind, entityType, entityId),
			kind,
			entityType,
			entityId,
			status: baseline ? "resolved" : "open",
			detectedAt: now,
			lastSeenAt: now,
			...(baseline
				? {
						resolvedAt: now,
						resolvedBy: actorId,
						resolution: "baseline" as const,
					}
				: {}),
		});

		let entitiesAdded = 0;
		let entitiesRetired = 0;
		const retiredKeys = new Set<string>();
		const scanEntities = (
			entityType: CatalogReviewEntityType,
			rows: ReadonlyArray<{
				id: string;
				source: string;
				status: string;
				deactivatedAt?: Date | null;
			}>,
		) => {
			for (const row of rows) {
				if (row.source !== "static") {
					continue;
				}
				const addedKey = catalogReviewEntryKey(
					"entity_added",
					entityType,
					row.id,
				);
				if (!allKeys.has(addedKey)) {
					entitiesAdded++;
					inserts.push(informational("entity_added", entityType, row.id));
				}
				if (entityRetired(row)) {
					const retiredKey = catalogReviewEntryKey(
						"entity_retired",
						entityType,
						row.id,
					);
					retiredKeys.add(retiredKey);
					if (!allKeys.has(retiredKey)) {
						entitiesRetired++;
						inserts.push(informational("entity_retired", entityType, row.id));
					}
				}
			}
		};
		scanEntities("provider", providers);
		scanEntities("model", models);
		scanEntities("mapping", mappings);

		let retirementsSuperseded = 0;
		for (const [entryKey, entry] of openByKey) {
			if (entry.kind !== "entity_retired" || retiredKeys.has(entryKey)) {
				continue;
			}
			// The retirement was reverted upstream before the operator looked at
			// it; the entry no longer describes reality.
			retirementsSuperseded++;
			resolveById.set(entry.id, { resolution: "superseded" });
		}

		for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
			await tx
				.insert(platformCatalogReviewEntry)
				.values(inserts.slice(index, index + INSERT_CHUNK_SIZE));
		}
		for (const [id, resolve] of resolveById) {
			await tx
				.update(platformCatalogReviewEntry)
				.set({
					status: "resolved",
					resolvedAt: now,
					resolvedBy: actorId,
					resolution: resolve.resolution,
					lastSeenAt: now,
				})
				.where(eq(platformCatalogReviewEntry.id, id));
		}
		for (const { id, item } of refresh) {
			await tx
				.update(platformCatalogReviewEntry)
				.set({
					lastSeenAt: now,
					driftValues: {
						version: 1,
						override: item.overrideValue,
						base: item.baseValue,
						mirror: item.mirrorValue,
					},
				})
				.where(eq(platformCatalogReviewEntry.id, id));
		}

		const openBefore = openByKey.size;
		const openEntries =
			openBefore -
			resolveById.size +
			driftOpened +
			(baseline ? 0 : entitiesAdded + entitiesRetired);
		return {
			baseline,
			driftOpened,
			driftResolved,
			entitiesAdded,
			entitiesRetired,
			retirementsSuperseded,
			openEntries,
		};
	};

	if (input.transaction) {
		return await run(input.transaction);
	}
	return await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
		return await run(tx);
	});
}
