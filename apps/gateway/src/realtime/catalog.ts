import {
	enforceCatalogRequest,
	filterProviderMappingsByCatalog,
	findCatalogMappingForProvider,
} from "@/lib/catalog-policy.js";

import { models as modelDefinitions } from "@betarouter/models";

import type { EffectiveMapping } from "@betarouter/catalog";
import type { ModelDefinition, ProviderModelMapping } from "@betarouter/models";

export interface RealtimeMappingMatch {
	modelDef: ModelDefinition;
	mapping: ProviderModelMapping;
	/**
	 * Canonical betarouter model id (never the upstream provider id).
	 */
	modelId: string;
	/**
	 * Platform-catalog mapping this match was admitted against, when catalog
	 * routing is enforced. Present only on matches returned by
	 * `admitRealtimeMapping`, which is the only way a realtime mapping should
	 * ever reach billing: its `mapping` carries the catalog's customer prices
	 * and capability restrictions rather than the static packages/models entry.
	 */
	catalogMapping?: EffectiveMapping | null;
}

type RealtimeCapability = "realtime" | "realtimeTranscription";

/**
 * Run platform-catalog admission for a realtime mapping and return the
 * catalog-adjusted match.
 *
 * Realtime sessions bill exactly like the HTTP surfaces do, so they must obey
 * the same catalogue: an operator-deactivated mapping is not servable, and the
 * mapping used to build the realtime price snapshot must be the one
 * `applyCatalogCustomerPrices` produced (customer prices, disabled
 * capabilities, platform-credential binding) — never the static catalogue
 * entry. Returns null when the catalogue admits no eligible mapping.
 *
 * Throws the HTTPException raised by `enforceCatalogRequest` for retired /
 * unavailable models; realtime callers convert that to a
 * `RealtimeConnectError`.
 */
export async function admitRealtimeMapping(
	match: RealtimeMappingMatch,
	capability: RealtimeCapability,
): Promise<RealtimeMappingMatch | null> {
	const decision = await enforceCatalogRequest(
		{
			modelId: match.modelId,
			providerId: match.mapping.providerId,
			region: match.mapping.region,
		},
		{ operation: "deferred_non_chat" },
	);
	const [mapping] = filterProviderMappingsByCatalog(
		match.modelDef.providers.filter(
			(provider): provider is ProviderModelMapping =>
				(provider as ProviderModelMapping)[capability] === true &&
				provider.providerId === match.mapping.providerId &&
				(provider as ProviderModelMapping).externalId ===
					match.mapping.externalId,
		),
		decision,
	);
	if (!mapping) {
		return null;
	}
	return {
		...match,
		mapping,
		catalogMapping: findCatalogMappingForProvider(
			decision,
			mapping.providerId,
			mapping.region ?? null,
		),
	};
}

/**
 * Resolve a requested realtime model ("gpt-realtime", an alias, or a
 * "provider/model" pinned form) to its catalogue definition and provider
 * mapping. Only mappings with `realtime: true` that are not deactivated are
 * eligible; the first eligible mapping in definition order wins.
 */
export function findRealtimeMapping(
	requestedModel: string,
	now: Date = new Date(),
): RealtimeMappingMatch | null {
	let requestedProvider: string | undefined;
	let modelKey = requestedModel;
	const slashIdx = requestedModel.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = requestedModel.slice(0, slashIdx);
		modelKey = requestedModel.slice(slashIdx + 1);
	}

	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		if (model.id !== modelKey && !model.aliases?.includes(modelKey)) {
			continue;
		}
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtime !== true) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			if (candidate.deactivatedAt && now > candidate.deactivatedAt) {
				continue;
			}
			return {
				modelDef: model,
				mapping: candidate,
				modelId: model.id,
			};
		}
	}
	return null;
}

/**
 * Resolve a requested input-audio transcription model to a catalogue mapping
 * with `realtimeTranscription: true` on the given provider. The provider must
 * match the realtime connection's upstream provider: transcription runs
 * inside that provider's realtime session, so a mapping on another provider
 * cannot serve it (and could not be billed correctly).
 */
export function findRealtimeTranscriptionMapping(
	requestedModel: string,
	providerId: string,
	now: Date = new Date(),
): RealtimeMappingMatch | null {
	let modelKey = requestedModel;
	const slashIdx = requestedModel.indexOf("/");
	if (slashIdx > 0) {
		const requestedProvider = requestedModel.slice(0, slashIdx);
		if (requestedProvider !== providerId) {
			return null;
		}
		modelKey = requestedModel.slice(slashIdx + 1);
	}

	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		const matchesKey =
			model.id === modelKey || model.aliases?.includes(modelKey);
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtimeTranscription !== true) {
				continue;
			}
			if (candidate.providerId !== providerId) {
				continue;
			}
			// Accept either the canonical gateway id/alias or the provider's own
			// upstream id, since clients typically send the upstream model name in
			// session.update.
			if (!matchesKey && candidate.externalId !== modelKey) {
				continue;
			}
			if (candidate.deactivatedAt && now > candidate.deactivatedAt) {
				continue;
			}
			return {
				modelDef: model,
				mapping: candidate,
				modelId: model.id,
			};
		}
	}
	return null;
}

/**
 * Every active `realtimeTranscription` mapping for a provider. Used to resolve
 * which ASR models an API key's IAM rules actually permit, once per session,
 * instead of per session.update.
 */
export function listRealtimeTranscriptionMappings(
	providerId: string,
	now: Date = new Date(),
): RealtimeMappingMatch[] {
	const matches: RealtimeMappingMatch[] = [];
	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtimeTranscription !== true) {
				continue;
			}
			if (candidate.providerId !== providerId) {
				continue;
			}
			if (candidate.deactivatedAt && now > candidate.deactivatedAt) {
				continue;
			}
			matches.push({
				modelDef: model,
				mapping: candidate,
				modelId: model.id,
			});
		}
	}
	return matches;
}

/**
 * Default transcription mapping for a provider: the first active
 * `realtimeTranscription` mapping in catalogue definition order.
 */
export function findDefaultRealtimeTranscriptionMapping(
	providerId: string,
	now: Date = new Date(),
): RealtimeMappingMatch | null {
	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (candidate.realtimeTranscription !== true) {
				continue;
			}
			if (candidate.providerId !== providerId) {
				continue;
			}
			if (candidate.deactivatedAt && now > candidate.deactivatedAt) {
				continue;
			}
			return {
				modelDef: model,
				mapping: candidate,
				modelId: model.id,
			};
		}
	}
	return null;
}
