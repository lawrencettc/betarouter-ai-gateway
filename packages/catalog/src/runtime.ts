import { z } from "zod";

import { db } from "@llmgateway/db/db";
import { desc } from "@llmgateway/db/orm";
import { platformCatalogRevision } from "@llmgateway/db/schema";

import { calculateCatalogChecksum } from "./catalog.js";
import { CatalogSnapshotCache } from "./snapshot-cache.js";

import type { EffectiveCatalog } from "./catalog.js";

const lifecycleSchema = z.enum(["draft", "active", "deprecated", "retired"]);
const storedCatalogSnapshotSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		checksum: z.string().startsWith("sha256:"),
		providers: z.array(
			z.object({
				id: z.string(),
				lifecycle: lifecycleSchema,
				configuredVisible: z.boolean(),
				visible: z.boolean(),
				available: z.boolean(),
			}),
		),
		models: z.array(
			z.object({
				id: z.string(),
				lifecycle: lifecycleSchema,
				configuredVisible: z.boolean(),
				visible: z.boolean(),
				available: z.boolean(),
				allowDirect: z.boolean(),
				replacementModelId: z.string().nullable(),
				deprecatedAt: z.string().nullable(),
				retireAt: z.string().nullable(),
				retirementMessage: z.string().nullable(),
			}),
		),
		mappings: z.array(
			z.object({
				id: z.string(),
				providerId: z.string(),
				modelId: z.string(),
				region: z.string().nullable(),
				externalId: z.string(),
				displayable: z.boolean(),
				available: z.boolean(),
				routable: z.boolean(),
				probeOnly: z.boolean(),
				priority: z.number(),
				weight: z.number(),
				sourcePrices: z.record(z.string(), z.string()),
				customerPrices: z.record(z.string(), z.string()),
				margin: z.record(z.string(), z.string()),
				reasons: z.array(z.string()),
			}),
		),
		visibleProviderIds: z.array(z.string()),
		visibleModelIds: z.array(z.string()),
		availableModelIds: z.array(z.string()),
		routableMappingIds: z.array(z.string()),
	})
	.strict();

export function parseStoredCatalogSnapshot(value: unknown): EffectiveCatalog {
	const snapshot = storedCatalogSnapshotSchema.parse(value) as EffectiveCatalog;
	const { revision: _revision, checksum, ...content } = snapshot;
	if (calculateCatalogChecksum(content) !== checksum) {
		throw new Error("Stored catalog snapshot checksum is invalid");
	}
	return snapshot;
}

export async function loadLatestCatalogSnapshot(): Promise<EffectiveCatalog | null> {
	const [row] = await db
		.select({ snapshot: platformCatalogRevision.snapshot })
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	return row ? parseStoredCatalogSnapshot(row.snapshot) : null;
}

const maxStaleMs = Number(
	process.env.PLATFORM_CATALOG_MAX_STALE_MS ?? 5 * 60 * 1000,
);
const runtimeCache = new CatalogSnapshotCache({
	loadLatest: loadLatestCatalogSnapshot,
	maxStaleMs:
		Number.isFinite(maxStaleMs) && maxStaleMs >= 0 ? maxStaleMs : 300_000,
});

export async function getEffectiveCatalogSnapshot(): Promise<EffectiveCatalog> {
	return (await runtimeCache.get()).snapshot;
}

export async function pollEffectiveCatalogSnapshot(): Promise<EffectiveCatalog> {
	return (await runtimeCache.poll()).snapshot;
}

export async function invalidateEffectiveCatalogSnapshot(
	revision: number,
): Promise<EffectiveCatalog> {
	return (await runtimeCache.handleInvalidation(revision)).snapshot;
}
