import { describe, expect, it } from "vitest";

import { readCatalogFeatureFlags } from "./flags.js";

describe("readCatalogFeatureFlags", () => {
	it("defaults every enforcement path off", () => {
		expect(readCatalogFeatureFlags({})).toEqual({
			shadowRead: false,
			discoveryEnabled: false,
			routingEnabled: false,
			baseReadEnabled: false,
			embeddingsRoutingEnabled: false,
			videosRoutingEnabled: false,
			speechRoutingEnabled: false,
			transcriptionsRoutingEnabled: false,
			ocrRoutingEnabled: false,
			rerankRoutingEnabled: false,
			moderationsRoutingEnabled: false,
			realtimeRoutingEnabled: false,
			breakerMode: "off",
		});
	});

	it("accepts explicit staged rollout values", () => {
		expect(
			readCatalogFeatureFlags({
				PLATFORM_CATALOG_SHADOW_READ: "true",
				PLATFORM_CATALOG_DISCOVERY_ENABLED: "true",
				PLATFORM_CATALOG_ROUTING_ENABLED: "1",
				PLATFORM_CATALOG_BASE_READ_ENABLED: "true",
				PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_OCR_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_RERANK_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_REALTIME_ROUTING_ENABLED: "true",
				PLATFORM_CATALOG_BREAKER_MODE: "observe",
			}),
		).toEqual({
			shadowRead: true,
			discoveryEnabled: true,
			routingEnabled: true,
			baseReadEnabled: true,
			embeddingsRoutingEnabled: true,
			videosRoutingEnabled: true,
			speechRoutingEnabled: true,
			transcriptionsRoutingEnabled: true,
			ocrRoutingEnabled: true,
			rerankRoutingEnabled: true,
			moderationsRoutingEnabled: true,
			realtimeRoutingEnabled: true,
			breakerMode: "observe",
		});
	});
});
