import { describe, expect, it } from "vitest";

import { catalogMappingTestProfile } from "./test-target.js";

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
});
