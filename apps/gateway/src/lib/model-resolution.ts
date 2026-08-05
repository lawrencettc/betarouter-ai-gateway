import {
	catalogSnapshotHasBaseData,
	compareCatalogModelResolution,
	getEffectiveCatalogSnapshot,
	readCatalogFeatureFlags,
	resolveModelFromCatalog,
} from "@betarouter/catalog";
import { logger } from "@betarouter/logger";
import { models } from "@betarouter/models";

import type { CatalogParseContext } from "@/chat/tools/parse-model-input.js";
import type { EffectiveCatalog } from "@betarouter/catalog";
import type { ModelDefinition } from "@betarouter/models";

/**
 * Per-request context for chat-path model resolution (the read-path
 * inversion). With `baseReadEnabled` the catalog snapshot is the primary
 * source for model base data and the static array is the fallback; with
 * shadow read only, static keeps serving while both paths are compared and
 * divergence is logged for the rollout soak.
 */
export interface CatalogModelResolutionContext {
	snapshot: EffectiveCatalog | null;
	baseReadEnabled: boolean;
	shadowRead: boolean;
}

export async function getCatalogModelResolutionContext(): Promise<CatalogModelResolutionContext> {
	const flags = readCatalogFeatureFlags();
	if (!flags.baseReadEnabled && !flags.shadowRead) {
		return { snapshot: null, baseReadEnabled: false, shadowRead: false };
	}
	let snapshot: EffectiveCatalog | null = null;
	try {
		snapshot = await getEffectiveCatalogSnapshot();
	} catch (error) {
		// Base reads fall back to static resolution when the snapshot cannot be
		// loaded; catalog policy enforcement keeps its own fail-closed behavior
		// in enforceCatalogRequest, independent of this context.
		logger.warn("Catalog model resolution snapshot unavailable", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	if (snapshot && !catalogSnapshotHasBaseData(snapshot)) {
		// The stored revision predates the base-data mirror (pre-Phase-2).
		// Static resolution stays authoritative until the next worker sync
		// publishes an enriched revision.
		snapshot = null;
	}
	return {
		snapshot,
		baseReadEnabled: flags.baseReadEnabled,
		shadowRead: flags.shadowRead,
	};
}

/**
 * Static-array model lookup preserving the historical provider preference:
 * when a provider is requested, a definition carrying that provider wins
 * over a bare id match.
 */
export function findStaticModelDefinition(
	modelId: string,
	requestedProvider?: string,
): ModelDefinition | undefined {
	const withProvider = requestedProvider
		? models.find(
				(model) =>
					model.id === modelId &&
					model.providers.some(
						(provider) => provider.providerId === requestedProvider,
					),
			)
		: undefined;
	return (
		(withProvider as ModelDefinition | undefined) ??
		(models.find((model) => model.id === modelId) as
			ModelDefinition | undefined)
	);
}

// Divergences are logged once per model per catalog revision so the soak
// signal stays readable: existence of a log line is the abort trigger, and
// repeating it per request adds noise, not information.
let loggedDivergenceRevision = -1;
const loggedDivergenceModelIds = new Set<string>();

/** Test hook: clear the once-per-revision divergence log dedupe. */
export function resetCatalogModelResolutionLogState(): void {
	loggedDivergenceRevision = -1;
	loggedDivergenceModelIds.clear();
}

function logResolutionDivergence(
	revision: number,
	modelId: string,
	staticDefinition: ModelDefinition | undefined,
	catalogDefinition: ModelDefinition | null,
): void {
	if (revision !== loggedDivergenceRevision) {
		loggedDivergenceRevision = revision;
		loggedDivergenceModelIds.clear();
	}
	if (loggedDivergenceModelIds.has(modelId)) {
		return;
	}
	loggedDivergenceModelIds.add(modelId);
	if (!staticDefinition) {
		// Catalog-only model (no static counterpart) — expected once admin
		// creation lands, not a resolution divergence.
		return;
	}
	if (!catalogDefinition) {
		logger.warn("Catalog model resolution divergence", {
			revision,
			modelId,
			providerId: null,
			region: null,
			field: "model",
			staticValue: "present",
			catalogValue: "missing",
			pricing: false,
		});
		return;
	}
	for (const divergence of compareCatalogModelResolution(
		staticDefinition,
		catalogDefinition,
	)) {
		const payload = { revision, ...divergence };
		if (divergence.pricing) {
			// Rollout rule: any pricing divergence, by any amount, aborts the
			// read-path inversion — surfaced at error level so it cannot be missed.
			logger.error("Catalog model resolution pricing divergence", payload);
		} else {
			logger.warn("Catalog model resolution divergence", payload);
		}
	}
}

/**
 * Resolve a model definition for the chat hot path. Catalog-first when base
 * reads are enabled (static fallback for models the snapshot cannot
 * reconstruct); static otherwise. Under shadow read, both paths resolve and
 * any divergence is logged by model, provider, and field.
 */
export function resolveGatewayModelDefinition(
	modelId: string,
	context: CatalogModelResolutionContext,
	requestedProvider?: string,
): ModelDefinition | undefined {
	const staticDefinition = findStaticModelDefinition(
		modelId,
		requestedProvider,
	);
	if (!context.snapshot) {
		return staticDefinition;
	}
	const catalogDefinition = resolveModelFromCatalog(modelId, context.snapshot);
	if (context.shadowRead && (staticDefinition || catalogDefinition)) {
		logResolutionDivergence(
			context.snapshot.revision,
			modelId,
			staticDefinition,
			catalogDefinition,
		);
	}
	if (context.baseReadEnabled) {
		return catalogDefinition ?? staticDefinition;
	}
	return staticDefinition;
}

let parseContextCache: {
	revision: number;
	context: CatalogParseContext;
} | null = null;

/**
 * Model/provider existence index for `parseModelInput`, derived from the
 * snapshot and cached per revision (source rows cannot change within one).
 */
export function buildCatalogParseContext(
	snapshot: EffectiveCatalog,
): CatalogParseContext {
	if (parseContextCache?.revision === snapshot.revision) {
		return parseContextCache.context;
	}
	const providerIdsByModel = new Map<string, Set<string>>();
	for (const mapping of snapshot.mappings) {
		let providerIds = providerIdsByModel.get(mapping.modelId);
		if (!providerIds) {
			providerIds = new Set();
			providerIdsByModel.set(mapping.modelId, providerIds);
		}
		providerIds.add(mapping.providerId);
	}
	const context: CatalogParseContext = {
		modelIds: new Set(snapshot.models.map((model) => model.id)),
		providerIdsByModel,
	};
	parseContextCache = { revision: snapshot.revision, context };
	return context;
}
