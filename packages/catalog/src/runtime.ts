import { z } from "zod";

import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db/db";
import { desc } from "@llmgateway/db/orm";
import { platformCatalogRevision } from "@llmgateway/db/schema";

import { getCatalogBreakerStates } from "./breaker-store.js";
import { calculateCatalogChecksum } from "./catalog.js";
import { readCatalogFeatureFlags } from "./flags.js";
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
				platformCredentialId: z.string().nullable(),
				platformCredentialProfile: z.string().startsWith("sha256:").nullable(),
				displayable: z.boolean(),
				available: z.boolean(),
				routable: z.boolean(),
				probeOnly: z.boolean(),
				priority: z.number(),
				weight: z.number(),
				contextSizeLimit: z.number().int().positive().nullable(),
				maxOutputLimit: z.number().int().positive().nullable(),
				disabledCapabilities: z.array(z.string()),
				sourcePrices: z.record(z.string(), z.string()),
				customerPrices: z.record(z.string(), z.string()),
				margin: z.record(z.string(), z.string()),
				pricingMode: z.enum(["source_cost", "markup", "fixed"]).nullable(),
				markupBps: z.number().nullable(),
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
const refreshIntervalMs = Number(
	process.env.PLATFORM_CATALOG_REFRESH_INTERVAL_MS ?? 10_000,
);
const runtimeCache = new CatalogSnapshotCache({
	loadLatest: loadLatestCatalogSnapshot,
	maxStaleMs:
		Number.isFinite(maxStaleMs) && maxStaleMs >= 0 ? maxStaleMs : 300_000,
	refreshIntervalMs:
		Number.isFinite(refreshIntervalMs) && refreshIntervalMs >= 0
			? refreshIntervalMs
			: 10_000,
});

const CATALOG_INVALIDATION_CHANNEL = "platform-catalog:invalidate";
let invalidationListenerStarted = false;

function ensureInvalidationListener(): void {
	if (invalidationListenerStarted || process.env.NODE_ENV === "test") {
		return;
	}
	invalidationListenerStarted = true;
	const subscriber = redisClient.duplicate({ lazyConnect: true });
	subscriber.on("message", (channel, payload) => {
		if (channel !== CATALOG_INVALIDATION_CHANNEL) {
			return;
		}
		try {
			const revision = z
				.object({ revision: z.number().int().positive() })
				.parse(JSON.parse(payload)).revision;
			void runtimeCache.handleInvalidation(revision).catch(() => undefined);
		} catch {
			// Ignore malformed events; bounded polling still refreshes the revision.
		}
	});
	void subscriber
		.connect()
		.then(async () => await subscriber.subscribe(CATALOG_INVALIDATION_CHANNEL))
		.catch(() => undefined);
}

async function withRuntimeBreakers(
	snapshot: EffectiveCatalog,
	claimBreakerProbes: boolean,
): Promise<EffectiveCatalog> {
	if (readCatalogFeatureFlags().breakerMode !== "enforce") {
		return snapshot;
	}
	try {
		const states = await getCatalogBreakerStates({
			revision: snapshot.revision,
			mappingIds: snapshot.mappings.map((mapping) => mapping.id),
			claimProbes: claimBreakerProbes,
		});
		const mappings = snapshot.mappings.map((mapping) => {
			const breaker = states[mapping.id];
			if (!breaker || breaker.state === "closed") {
				return mapping;
			}
			const probeOnly =
				breaker.state === "half_open" && breaker.probeClaimed === true;
			return {
				...mapping,
				routable: probeOnly ? mapping.available : false,
				probeOnly,
				reasons: [
					...mapping.reasons.filter(
						(reason) =>
							reason !== "circuit_open" && reason !== "circuit_half_open",
					),
					breaker.state === "open" ? "circuit_open" : "circuit_half_open",
				] as typeof mapping.reasons,
			};
		});
		return {
			...snapshot,
			mappings,
			routableMappingIds: mappings
				.filter((mapping) => mapping.routable)
				.map((mapping) => mapping.id),
		};
	} catch {
		// Redis loss is fail-open for breaker state; static policy still applies.
		return snapshot;
	}
}

export async function getEffectiveCatalogSnapshot(
	options: { claimBreakerProbes?: boolean } = {},
): Promise<EffectiveCatalog> {
	ensureInvalidationListener();
	return await withRuntimeBreakers(
		(await runtimeCache.get()).snapshot,
		options.claimBreakerProbes ?? false,
	);
}

export async function pollEffectiveCatalogSnapshot(): Promise<EffectiveCatalog> {
	return (await runtimeCache.poll()).snapshot;
}

export async function invalidateEffectiveCatalogSnapshot(
	revision: number,
): Promise<EffectiveCatalog> {
	return (await runtimeCache.handleInvalidation(revision)).snapshot;
}
