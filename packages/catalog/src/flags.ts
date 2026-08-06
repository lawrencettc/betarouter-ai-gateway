export interface CatalogFeatureFlags {
	shadowRead: boolean;
	discoveryEnabled: boolean;
	routingEnabled: boolean;
	/**
	 * Chat read-path inversion: resolve model base data (capabilities, limits,
	 * source prices) from the catalog snapshot instead of the static arrays.
	 * Flip only after a clean shadow-read soak shows zero resolution divergence.
	 */
	baseReadEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the embeddings surface. Chat launched
	 * enforcing under `routingEnabled` alone; a deployment that already
	 * enforces chat must not start rejecting embeddings requests on deploy,
	 * before the operator has activated embeddings mappings in the catalog.
	 * Embeddings therefore enforces only when BOTH `routingEnabled` and this
	 * flag are set; shadow decisions still log under `shadowRead` regardless.
	 */
	embeddingsRoutingEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the videos surface, with the same
	 * deploy invariant as embeddings: a deployment already enforcing chat
	 * must not start rejecting video requests before the operator has
	 * activated video mappings in the catalog.
	 */
	videosRoutingEnabled: boolean;
	breakerMode: "off" | "observe" | "enforce";
}

function enabled(value: string | undefined): boolean {
	return value === "true" || value === "1";
}

export function readCatalogFeatureFlags(
	env: NodeJS.ProcessEnv = process.env,
): CatalogFeatureFlags {
	const rawBreakerMode = env.PLATFORM_CATALOG_BREAKER_MODE;
	const breakerMode = new Set(["observe", "enforce"]).has(rawBreakerMode ?? "")
		? (rawBreakerMode as "observe" | "enforce")
		: "off";
	return {
		shadowRead: enabled(env.PLATFORM_CATALOG_SHADOW_READ),
		discoveryEnabled: enabled(env.PLATFORM_CATALOG_DISCOVERY_ENABLED),
		routingEnabled: enabled(env.PLATFORM_CATALOG_ROUTING_ENABLED),
		baseReadEnabled: enabled(env.PLATFORM_CATALOG_BASE_READ_ENABLED),
		embeddingsRoutingEnabled: enabled(
			env.PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED,
		),
		videosRoutingEnabled: enabled(env.PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED),
		breakerMode,
	};
}
