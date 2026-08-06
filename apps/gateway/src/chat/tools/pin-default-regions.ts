import {
	type ProviderDefinition,
	type ProviderModelMapping,
	providers,
} from "@betarouter/models";

/**
 * For providers with `regionConfig.pinDefaultRegion: true`, drop all regional
 * candidates except the defaultRegion (and the synthetic root) when no
 * explicit choice was made. This makes AWS Bedrock default to `:global`
 * unless the caller opts in via the `:region` URL suffix or via the
 * provider-key region option. Providers without `pinDefaultRegion`
 * (e.g. Alibaba) pass through unchanged so the gateway can route to the
 * cheapest region.
 *
 * When a model has regional variants but none for the provider's default
 * region (e.g. Claude Opus 4.1 and several Llama models on AWS Bedrock offer
 * only a `us` cross-region inference profile, not `global`), the synthetic
 * root cannot be used: it resolves to the default-region prefix (`global.`)
 * which Bedrock rejects with "The provided model identifier is invalid."
 * In that case we pin to the model's concrete regional variants instead.
 */
export function applyPinnedDefaultRegions(
	mappings: ProviderModelMapping[],
	options: {
		explicitLocks?: Map<string, string>;
		requestedRegion?: string;
		/** Catalog-resolved provider lookup; falls back to the static array. */
		resolveProvider?: (id: string) => ProviderDefinition | undefined;
	} = {},
): ProviderModelMapping[] {
	if (options.requestedRegion) {
		return mappings;
	}
	const resolveProvider =
		options.resolveProvider ??
		((id: string) =>
			providers.find((p) => p.id === id) as ProviderDefinition | undefined);
	const providerHasAnyRegion = new Set<string>();
	const providerHasDefaultRegion = new Set<string>();
	for (const m of mappings) {
		if (!m.region) {
			continue;
		}
		providerHasAnyRegion.add(m.providerId);
		const def = resolveProvider(m.providerId);
		if (m.region === def?.regionConfig?.defaultRegion) {
			providerHasDefaultRegion.add(m.providerId);
		}
	}
	return mappings.filter((m) => {
		const def = resolveProvider(m.providerId);
		if (!def?.regionConfig?.pinDefaultRegion) {
			return true;
		}
		if (options.explicitLocks?.has(m.providerId)) {
			return true;
		}
		if (
			providerHasAnyRegion.has(m.providerId) &&
			!providerHasDefaultRegion.has(m.providerId)
		) {
			// No default-region profile exists for this model — the synthetic root
			// would resolve to the invalid default-region prefix, so keep only the
			// concrete regional variants.
			return Boolean(m.region);
		}
		return !m.region || m.region === def.regionConfig.defaultRegion;
	});
}
