import { z } from "zod";

import { redisClient } from "@betarouter/cache";
import { db } from "@betarouter/db/db";
import { desc, eq } from "@betarouter/db/orm";
import { platformCatalogRevision } from "@betarouter/db/schema";

import { getCatalogBreakerStates } from "./breaker-store.js";
import { calculateCatalogChecksum } from "./catalog.js";
import { readCatalogFeatureFlags } from "./flags.js";
import { CatalogSnapshotCache } from "./snapshot-cache.js";

import type { EffectiveCatalog, MappingEligibilityReason } from "./catalog.js";

const lifecycleSchema = z.enum(["draft", "active", "deprecated", "retired"]);
const storedPricingTierSchema = z
	.object({
		name: z.string(),
		// null mirrors an unbounded (Infinity) top tier
		upToTokens: z.number().nullable(),
		inputPrice: z.string(),
		outputPrice: z.string(),
		cachedInputPrice: z.string().optional(),
		cacheReadInputPrice: z.string().optional(),
		cacheWriteInputPrice: z.string().optional(),
		cacheWriteInputPrice1h: z.string().optional(),
	})
	.strict();
const storedCatalogSnapshotSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		checksum: z.string().startsWith("sha256:"),
		providers: z.array(
			z.object({
				id: z.string(),
				lifecycle: lifecycleSchema,
				deprecatedAt: z.string().nullable().optional(),
				retireAt: z.string().nullable().optional(),
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
				// Base data fields are optional: pre-Phase-2 snapshots lack them
				name: z.string().optional(),
				family: z.string().optional(),
				aliases: z.array(z.string()).optional(),
				output: z.array(z.string()).optional(),
				free: z.boolean().optional(),
			}),
		),
		mappings: z.array(
			z.object({
				id: z.string(),
				providerId: z.string(),
				modelId: z.string(),
				region: z.string().nullable(),
				deactivatedAt: z.string().nullable().optional(),
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
				// Base data fields are optional: pre-Phase-2 snapshots lack them
				contextSize: z.number().int().nullable().optional(),
				maxOutput: z.number().int().nullable().optional(),
				streaming: z.boolean().optional(),
				vision: z.boolean().nullable().optional(),
				reasoning: z.boolean().nullable().optional(),
				reasoningMaxTokens: z.boolean().optional(),
				tools: z.boolean().nullable().optional(),
				jsonOutput: z.boolean().optional(),
				jsonOutputSchema: z.boolean().optional(),
				webSearch: z.boolean().optional(),
				supportedParameters: z.array(z.string()).nullable().optional(),
				pricingTiers: z.array(storedPricingTierSchema).nullable().optional(),
				serviceTierMultipliers: z
					.record(z.string(), z.number())
					.nullable()
					.optional(),
			}),
		),
		visibleProviderIds: z.array(z.string()),
		visibleModelIds: z.array(z.string()),
		availableModelIds: z.array(z.string()),
		routableMappingIds: z.array(z.string()),
	})
	.strict();

export function parseStoredCatalogSnapshot(
	value: unknown,
	expectedChecksum?: string,
): EffectiveCatalog {
	const snapshot = storedCatalogSnapshotSchema.parse(value) as EffectiveCatalog;
	const { revision: _revision, checksum, ...content } = snapshot;
	const validCanonicalChecksum =
		checksum.startsWith("sha256:v2:") &&
		calculateCatalogChecksum(content) === checksum;
	const validLegacyChecksum =
		!checksum.startsWith("sha256:v2:") && expectedChecksum === checksum;
	if (!validCanonicalChecksum && !validLegacyChecksum) {
		throw new Error("Stored catalog snapshot checksum is invalid");
	}
	return snapshot;
}

export async function loadLatestCatalogSnapshot(): Promise<EffectiveCatalog | null> {
	const [row] = await db
		.select({
			checksum: platformCatalogRevision.checksum,
			snapshot: platformCatalogRevision.snapshot,
		})
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	return row ? parseStoredCatalogSnapshot(row.snapshot, row.checksum) : null;
}

// Revisions are immutable, so parsed snapshots can be cached by id forever;
// the cap only bounds memory when a long-lived worker replays many distinct
// revisions (e.g. billing old async video jobs after several publishes).
const revisionSnapshotCache = new Map<number, EffectiveCatalog | null>();
const REVISION_SNAPSHOT_CACHE_MAX = 8;

/**
 * Load the stored snapshot of one specific revision — the billing replay
 * primitive for async work: a job dispatched under revision N is billed at
 * revision N's customer prices, not at whatever revision is latest when the
 * job completes. Returns null when the revision does not exist.
 */
export async function loadCatalogRevisionSnapshot(
	revisionId: number,
): Promise<EffectiveCatalog | null> {
	if (revisionSnapshotCache.has(revisionId)) {
		return revisionSnapshotCache.get(revisionId) ?? null;
	}
	const [row] = await db
		.select({
			checksum: platformCatalogRevision.checksum,
			snapshot: platformCatalogRevision.snapshot,
		})
		.from(platformCatalogRevision)
		.where(eq(platformCatalogRevision.id, revisionId))
		.limit(1);
	const snapshot = row
		? parseStoredCatalogSnapshot(row.snapshot, row.checksum)
		: null;
	if (revisionSnapshotCache.size >= REVISION_SNAPSHOT_CACHE_MAX) {
		const oldest = revisionSnapshotCache.keys().next().value;
		if (oldest !== undefined) {
			revisionSnapshotCache.delete(oldest);
		}
	}
	revisionSnapshotCache.set(revisionId, snapshot);
	return snapshot;
}

/** Test hook: clear the immutable-revision snapshot cache. */
export function resetCatalogRevisionSnapshotCache(): void {
	revisionSnapshotCache.clear();
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
	mappingIds: string[] | undefined,
	claimBreakerProbes: boolean,
): Promise<EffectiveCatalog> {
	if (readCatalogFeatureFlags().breakerMode !== "enforce") {
		return snapshot;
	}
	try {
		const selectedMappingIds = selectCatalogBreakerMappingIds(
			snapshot,
			mappingIds,
		);
		if (selectedMappingIds.length === 0) {
			return snapshot;
		}
		const states = await getCatalogBreakerStates({
			revision: snapshot.revision,
			mappingIds: selectedMappingIds,
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

export function selectCatalogBreakerMappingIds(
	snapshot: EffectiveCatalog,
	mappingIds: string[] | undefined,
): string[] {
	return mappingIds ?? snapshot.mappings.map((mapping) => mapping.id);
}

function dateReached(value: string | null | undefined, now: Date): boolean {
	return (
		value !== null && value !== undefined && Date.parse(value) <= now.getTime()
	);
}

function lifecycleAt(
	lifecycle: EffectiveCatalog["models"][number]["lifecycle"],
	deprecatedAt: string | null | undefined,
	retireAt: string | null | undefined,
	now: Date,
): EffectiveCatalog["models"][number]["lifecycle"] {
	if (lifecycle === "retired" || dateReached(retireAt, now)) {
		return "retired";
	}
	if (lifecycle === "deprecated" || dateReached(deprecatedAt, now)) {
		return "deprecated";
	}
	return lifecycle;
}

/** Re-evaluate scheduled lifecycle boundaries without mutating the stored revision. */
export function applyCatalogLifecycleAt(
	snapshot: EffectiveCatalog,
	now: Date,
): EffectiveCatalog {
	const providers = snapshot.providers.map((provider) => ({
		...provider,
		lifecycle: lifecycleAt(
			provider.lifecycle,
			provider.deprecatedAt,
			provider.retireAt,
			now,
		),
	}));
	const models = snapshot.models.map((model) => ({
		...model,
		lifecycle: lifecycleAt(
			model.lifecycle,
			model.deprecatedAt,
			model.retireAt,
			now,
		),
	}));
	const providerLifecycle = new Map(
		providers.map((provider) => [provider.id, provider.lifecycle]),
	);
	const modelLifecycle = new Map(
		models.map((model) => [model.id, model.lifecycle]),
	);
	const mappings = snapshot.mappings.map((mapping) => {
		const reasons: MappingEligibilityReason[] = mapping.reasons.filter(
			(reason) =>
				reason !== "provider_retired" &&
				reason !== "model_retired" &&
				reason !== "source_mapping_deactivated",
		);
		if (providerLifecycle.get(mapping.providerId) === "retired") {
			reasons.push("provider_retired");
		}
		if (modelLifecycle.get(mapping.modelId) === "retired") {
			reasons.push("model_retired");
		}
		if (dateReached(mapping.deactivatedAt, now)) {
			reasons.push("source_mapping_deactivated");
		}
		const available = reasons.every(
			(reason) => reason === "circuit_open" || reason === "circuit_half_open",
		);
		const hasCircuitReason = reasons.some(
			(reason) => reason === "circuit_open" || reason === "circuit_half_open",
		);
		return {
			...mapping,
			displayable:
				mapping.displayable &&
				providerLifecycle.get(mapping.providerId) !== "retired" &&
				modelLifecycle.get(mapping.modelId) !== "retired" &&
				!dateReached(mapping.deactivatedAt, now),
			available,
			routable: available && !hasCircuitReason,
			probeOnly: false,
			reasons: reasons.sort(),
		};
	});
	const runtimeProviders = providers.map((provider) => ({
		...provider,
		visible:
			provider.configuredVisible &&
			provider.lifecycle !== "retired" &&
			mappings.some(
				(mapping) => mapping.providerId === provider.id && mapping.displayable,
			),
		available:
			provider.available &&
			provider.lifecycle !== "retired" &&
			mappings.some(
				(mapping) => mapping.providerId === provider.id && mapping.available,
			),
	}));
	const runtimeModels = models.map((model) => ({
		...model,
		visible:
			model.configuredVisible &&
			model.lifecycle !== "retired" &&
			mappings.some(
				(mapping) => mapping.modelId === model.id && mapping.displayable,
			),
		available:
			model.available &&
			model.lifecycle !== "retired" &&
			mappings.some(
				(mapping) => mapping.modelId === model.id && mapping.available,
			),
	}));
	const runtimeContent = {
		providers: runtimeProviders,
		models: runtimeModels,
		mappings,
		visibleProviderIds: runtimeProviders
			.filter((provider) => provider.visible)
			.map((provider) => provider.id),
		visibleModelIds: runtimeModels
			.filter((model) => model.visible)
			.map((model) => model.id),
		availableModelIds: runtimeModels
			.filter((model) => model.available)
			.map((model) => model.id),
		routableMappingIds: mappings
			.filter((mapping) => mapping.routable)
			.map((mapping) => mapping.id),
	};
	return {
		revision: snapshot.revision,
		...runtimeContent,
		checksum: calculateCatalogChecksum(runtimeContent),
	};
}

export async function getEffectiveCatalogSnapshot(
	options: {
		breakerMappingIds?: string[];
		claimBreakerProbes?: boolean;
		now?: Date;
	} = {},
): Promise<EffectiveCatalog> {
	ensureInvalidationListener();
	return await withRuntimeBreakers(
		applyCatalogLifecycleAt(
			(await runtimeCache.get()).snapshot,
			options.now ?? new Date(),
		),
		options.breakerMappingIds,
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
