import type { EffectiveCatalog } from "./catalog.js";
import type { CatalogPolicyState } from "./change-set.js";

export function findCatalogRoutabilityLosses(
	before: EffectiveCatalog,
	after: EffectiveCatalog,
	state: CatalogPolicyState,
): string[] {
	const previouslyRoutable = new Set(
		before.mappings
			.filter((mapping) => mapping.routable)
			.map((mapping) => mapping.modelId),
	);
	const stillRoutable = new Set(
		after.mappings
			.filter((mapping) => mapping.routable)
			.map((mapping) => mapping.modelId),
	);
	return [...previouslyRoutable].filter(
		(modelId) => state.models[modelId]?.enabled && !stillRoutable.has(modelId),
	);
}

/**
 * Enforce launch invariants for the policies touched by one atomic change.
 * Mapping changes also impact their owning provider and model, so disabling the
 * last usable mapping cannot strand an otherwise-enabled catalog entry.
 */
export function validateCatalogActivation(
	snapshot: EffectiveCatalog,
	state: CatalogPolicyState,
	affectedIds: string[],
): void {
	const affected = new Set(affectedIds);
	const impactedProviderIds = new Set<string>();
	const impactedModelIds = new Set<string>();
	for (const mapping of snapshot.mappings) {
		if (
			affected.has(mapping.id) ||
			affected.has(mapping.providerId) ||
			affected.has(mapping.modelId)
		) {
			impactedProviderIds.add(mapping.providerId);
			impactedModelIds.add(mapping.modelId);
		}
	}
	for (const id of affected) {
		if (state.providers[id]) {
			impactedProviderIds.add(id);
		}
		if (state.models[id]) {
			impactedModelIds.add(id);
		}
	}

	const blockers: string[] = [];
	for (const mapping of snapshot.mappings) {
		if (
			affected.has(mapping.id) &&
			state.mappings[mapping.id]?.enabled &&
			!mapping.available
		) {
			const reasons = mapping.reasons.filter(
				(reason) => reason !== "circuit_open" && reason !== "circuit_half_open",
			);
			if (reasons.length > 0) {
				blockers.push(`${mapping.id} (${reasons.join(", ")})`);
			}
		}
	}
	for (const providerPolicy of Object.values(state.providers)) {
		if (
			impactedProviderIds.has(providerPolicy.providerId) &&
			providerPolicy.enabled &&
			!snapshot.mappings.some(
				(mapping) =>
					mapping.providerId === providerPolicy.providerId && mapping.available,
			)
		) {
			blockers.push(`${providerPolicy.providerId} (no available mapping)`);
		}
	}
	for (const modelPolicy of Object.values(state.models)) {
		if (
			impactedModelIds.has(modelPolicy.modelId) &&
			modelPolicy.enabled &&
			!snapshot.mappings.some(
				(mapping) =>
					mapping.modelId === modelPolicy.modelId && mapping.available,
			)
		) {
			blockers.push(`${modelPolicy.modelId} (no available mapping)`);
		}
		if (modelPolicy.replacementModelId) {
			const replacement = snapshot.models.find(
				(item) => item.id === modelPolicy.replacementModelId,
			);
			if (!replacement?.available || replacement.lifecycle !== "active") {
				blockers.push(
					`${modelPolicy.modelId} (replacement model is not active and available)`,
				);
			}
		}
	}
	if (blockers.length > 0) {
		throw new Error(`Catalog activation is blocked: ${blockers.join("; ")}`);
	}
}
