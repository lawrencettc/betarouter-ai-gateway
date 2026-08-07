import { describe, expect, it } from "vitest";

import {
	catalogMappingProfileForMapping,
	catalogMappingProfileForOutputs,
	isCatalogMappingTestExempt,
	catalogMappingTestProfile,
} from "./test-target.js";

const target = {
	mappingId: "mapping-1",
	providerId: "openai",
	externalId: "gpt-4.1",
	credentialId: "credential-1",
	credentialFingerprint: "token-hash",
	credentialOptions: { headers: { second: "b", first: "a" } },
};

describe("catalogMappingTestProfile", () => {
	it("uses the launch chat profile by default", () => {
		expect(catalogMappingTestProfile(target)).toMatch(
			/^minimal-chat@sha256:[a-f0-9]{64}$/,
		);
	});

	it("is stable across object key order", () => {
		expect(catalogMappingTestProfile(target)).toBe(
			catalogMappingTestProfile({
				...target,
				credentialOptions: { headers: { first: "a", second: "b" } },
			}),
		);
	});

	it("changes for connection and capability-critical inputs", () => {
		const current = catalogMappingTestProfile(target);
		for (const changed of [
			{ ...target, externalId: "gpt-4.2" },
			{ ...target, credentialFingerprint: "rotated-token" },
			{ ...target, baseUrl: "https://relay.example.com/v1" },
			{ ...target, contextSizeLimit: 4096 },
			{ ...target, disabledCapabilities: ["tools"] },
		]) {
			expect(catalogMappingTestProfile(changed)).not.toBe(current);
		}
	});

	it("separates probe profiles so a chat run cannot satisfy embeddings", () => {
		expect(
			catalogMappingTestProfile({ ...target, profile: "minimal-embeddings" }),
		).toMatch(/^minimal-embeddings@sha256:[a-f0-9]{64}$/);
		expect(
			catalogMappingTestProfile({ ...target, profile: "minimal-embeddings" }),
		).not.toBe(catalogMappingTestProfile(target));
		expect(
			catalogMappingTestProfile({ ...target, profile: "minimal-images" }),
		).toMatch(/^minimal-images@sha256:[a-f0-9]{64}$/);
		expect(
			catalogMappingTestProfile({ ...target, profile: "minimal-images" }),
		).not.toBe(catalogMappingTestProfile(target));
	});
});

describe("catalogMappingProfileForOutputs", () => {
	it("derives the probe profile from output modalities", () => {
		expect(catalogMappingProfileForOutputs(["text"])).toBe("minimal-chat");
		expect(catalogMappingProfileForOutputs(["embedding"])).toBe(
			"minimal-embeddings",
		);
		expect(catalogMappingProfileForOutputs(["image"])).toBe("minimal-images");
		expect(catalogMappingProfileForOutputs(["video"])).toBe("minimal-videos");
		expect(catalogMappingProfileForOutputs(["audio"])).toBe("minimal-speech");
		expect(catalogMappingProfileForOutputs(["transcription"])).toBe(
			"minimal-transcriptions",
		);
		expect(catalogMappingProfileForOutputs(["ocr"])).toBe("minimal-ocr");
		expect(catalogMappingProfileForOutputs(["rerank"])).toBe("minimal-rerank");
		expect(catalogMappingProfileForOutputs(["moderation"])).toBe(
			"minimal-moderations",
		);
		expect(catalogMappingProfileForOutputs([])).toBeNull();
	});

	it("keeps activated text+image chat models on the chat profile", () => {
		// Changing an activated mapping's expected profile would invalidate its
		// passed runs and de-route it, so text always wins the derivation.
		expect(catalogMappingProfileForOutputs(["text", "image"])).toBe(
			"minimal-chat",
		);
		// Same for native-audio chat deployments: text+audio is chat territory,
		// minimal-speech is only for audio-without-text TTS models.
		expect(catalogMappingProfileForOutputs(["text", "audio"])).toBe(
			"minimal-chat",
		);
	});
});

describe("catalogMappingProfileForMapping", () => {
	it("keys realtime mappings on their modality flag, not their outputs", () => {
		// Realtime models truthfully declare text+audio output but only answer
		// the realtime WebSocket protocol — the output-derived chat probe could
		// never pass, so the flag must win the derivation.
		expect(
			catalogMappingProfileForMapping(["text", "audio"], { realtime: true }),
		).toBe("minimal-realtime");
		// A hypothetical HTTP-servable text+audio chat model keeps minimal-chat.
		expect(catalogMappingProfileForMapping(["text", "audio"], {})).toBe(
			"minimal-chat",
		);
		expect(catalogMappingProfileForMapping(["text"], {})).toBe("minimal-chat");
	});

	it("exempts realtime-transcription mappings from the test gate", () => {
		expect(isCatalogMappingTestExempt({ realtimeTranscription: true })).toBe(
			true,
		);
		expect(
			catalogMappingProfileForMapping(["text"], {
				realtimeTranscription: true,
			}),
		).toBeNull();
		// A mapping serving both roles is probed as a realtime session.
		expect(
			isCatalogMappingTestExempt({
				realtime: true,
				realtimeTranscription: true,
			}),
		).toBe(false);
		expect(
			catalogMappingProfileForMapping(["text", "audio"], {
				realtime: true,
				realtimeTranscription: true,
			}),
		).toBe("minimal-realtime");
		expect(isCatalogMappingTestExempt({})).toBe(false);
	});
});
