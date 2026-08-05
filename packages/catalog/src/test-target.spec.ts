import { describe, expect, it } from "vitest";

import {
	catalogMappingProfileForOutputs,
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
	});
});

describe("catalogMappingProfileForOutputs", () => {
	it("derives the probe profile from output modalities", () => {
		expect(catalogMappingProfileForOutputs(["text"])).toBe("minimal-chat");
		expect(catalogMappingProfileForOutputs(["text", "image"])).toBe(
			"minimal-chat",
		);
		expect(catalogMappingProfileForOutputs(["embedding"])).toBe(
			"minimal-embeddings",
		);
		expect(catalogMappingProfileForOutputs(["image"])).toBeNull();
		expect(catalogMappingProfileForOutputs([])).toBeNull();
	});
});
