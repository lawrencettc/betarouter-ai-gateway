import type { EffectiveCatalog, EffectiveMapping } from "./catalog.js";

export interface CatalogRequestInput {
	modelId: string;
	providerId?: string;
	region?: string;
}

export type CatalogRequestDecision =
	| {
			allowed: true;
			revision: number;
			mappingIds: string[];
			mappings: EffectiveMapping[];
			deprecated: boolean;
			deprecatedAt: string | null;
			retireAt: string | null;
			replacementModelId: string | null;
	  }
	| {
			allowed: false;
			status: 404 | 410 | 503;
			code:
				| "model_not_available"
				| "model_retired"
				| "model_temporarily_unavailable";
			retryable: boolean;
			replacementModelId: string | null;
			retireAt: string | null;
	  };

function rejection(
	status: 404 | 410 | 503,
	code: Extract<CatalogRequestDecision, { allowed: false }>["code"],
	replacementModelId: string | null = null,
	retireAt: string | null = null,
): CatalogRequestDecision {
	return {
		allowed: false,
		status,
		code,
		retryable: status === 503,
		replacementModelId,
		retireAt,
	};
}

export function evaluateCatalogRequest(
	snapshot: EffectiveCatalog,
	input: CatalogRequestInput,
): CatalogRequestDecision {
	const model = snapshot.models.find((item) => item.id === input.modelId);
	if (!model) {
		return rejection(404, "model_not_available");
	}
	if (model.lifecycle === "retired") {
		return rejection(
			410,
			"model_retired",
			model.replacementModelId,
			model.retireAt,
		);
	}
	if (!model.visible && !model.allowDirect) {
		return rejection(404, "model_not_available");
	}
	const candidates = snapshot.mappings.filter(
		(mapping) =>
			mapping.modelId === input.modelId &&
			(!input.providerId || mapping.providerId === input.providerId) &&
			(!input.region || mapping.region === input.region),
	);
	const routable = candidates
		.filter((mapping) => mapping.routable)
		.sort(
			(left, right) =>
				left.priority - right.priority ||
				right.weight - left.weight ||
				left.id.localeCompare(right.id),
		);
	if (!model.available || routable.length === 0) {
		if (candidates.some((mapping) => mapping.available)) {
			return rejection(
				503,
				"model_temporarily_unavailable",
				model.replacementModelId,
				model.retireAt,
			);
		}
		return rejection(404, "model_not_available");
	}
	return {
		allowed: true,
		revision: snapshot.revision,
		mappingIds: routable.map((mapping) => mapping.id),
		mappings: routable,
		deprecated: model.lifecycle === "deprecated",
		deprecatedAt: model.deprecatedAt,
		retireAt: model.retireAt,
		replacementModelId: model.replacementModelId,
	};
}
