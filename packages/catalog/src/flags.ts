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
	/**
	 * Per-modality enforcement flip for the speech (text-to-speech) surface,
	 * with the same deploy invariant as embeddings and videos: a deployment
	 * already enforcing chat must not start rejecting speech requests before
	 * the operator has activated speech mappings in the catalog.
	 */
	speechRoutingEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the transcriptions (speech-to-text)
	 * surface, with the same deploy invariant as the other modalities: a
	 * deployment already enforcing chat must not start rejecting transcription
	 * requests before the operator has activated transcription mappings in the
	 * catalog.
	 */
	transcriptionsRoutingEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the OCR surface, with the same deploy
	 * invariant as the other modalities: a deployment already enforcing chat
	 * must not start rejecting OCR requests before the operator has activated
	 * OCR mappings in the catalog.
	 */
	ocrRoutingEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the rerank surface, with the same
	 * deploy invariant as the other modalities: a deployment already enforcing
	 * chat must not start rejecting rerank requests before the operator has
	 * activated rerank mappings in the catalog.
	 */
	rerankRoutingEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the moderations surface, with the same
	 * deploy invariant as the other modalities: a deployment already enforcing
	 * chat must not start rejecting moderation requests before the operator
	 * has activated the moderation mapping in the catalog.
	 */
	moderationsRoutingEnabled: boolean;
	/**
	 * Per-modality enforcement flip for the realtime WebSocket surface, with
	 * the same deploy invariant as the other modalities: a deployment already
	 * enforcing chat must not start rejecting realtime sessions before the
	 * operator has activated realtime mappings in the catalog.
	 */
	realtimeRoutingEnabled: boolean;
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
		speechRoutingEnabled: enabled(env.PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED),
		transcriptionsRoutingEnabled: enabled(
			env.PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED,
		),
		ocrRoutingEnabled: enabled(env.PLATFORM_CATALOG_OCR_ROUTING_ENABLED),
		rerankRoutingEnabled: enabled(env.PLATFORM_CATALOG_RERANK_ROUTING_ENABLED),
		moderationsRoutingEnabled: enabled(
			env.PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED,
		),
		realtimeRoutingEnabled: enabled(
			env.PLATFORM_CATALOG_REALTIME_ROUTING_ENABLED,
		),
		breakerMode,
	};
}
