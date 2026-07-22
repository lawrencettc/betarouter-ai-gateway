import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	decryptPlatformProviderToken,
	encryptPlatformProviderToken,
	fingerprintPlatformProviderToken,
	isPlatformProviderCryptoConfigured,
	loadPlatformProviderCryptoConfig,
	maskPlatformProviderToken,
} from "./platform-provider-crypto.js";

function makeEnv(currentVersion = "v2"): NodeJS.ProcessEnv {
	return {
		PLATFORM_PROVIDER_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString("base64")},v2:${randomBytes(32).toString("base64")}`,
		PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION: currentVersion,
		PLATFORM_PROVIDER_FINGERPRINT_KEY: randomBytes(32).toString("base64"),
	};
}

describe("platform provider credential crypto", () => {
	it("requires the full encryption configuration", () => {
		expect(isPlatformProviderCryptoConfigured({})).toBe(false);
		expect(
			isPlatformProviderCryptoConfigured({
				PLATFORM_PROVIDER_ENCRYPTION_KEYS: "v1:key",
				PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION: "v1",
				PLATFORM_PROVIDER_FINGERPRINT_KEY: "fingerprint",
			}),
		).toBe(true);
	});
	it("round-trips a token without storing plaintext", () => {
		const config = loadPlatformProviderCryptoConfig(makeEnv());
		const envelope = encryptPlatformProviderToken(
			"sk-platform-secret",
			"credential-1",
			"openai",
			config,
		);

		expect(envelope.encryptedToken).not.toContain("sk-platform-secret");
		expect(envelope.encryptionKeyVersion).toBe("v2");
		expect(
			decryptPlatformProviderToken(envelope, "credential-1", "openai", config),
		).toBe("sk-platform-secret");
	});

	it("rejects ciphertext moved to a different credential or provider", () => {
		const config = loadPlatformProviderCryptoConfig(makeEnv());
		const envelope = encryptPlatformProviderToken(
			"sk-platform-secret",
			"credential-1",
			"openai",
			config,
		);

		expect(() =>
			decryptPlatformProviderToken(envelope, "credential-2", "openai", config),
		).toThrow();
		expect(() =>
			decryptPlatformProviderToken(
				envelope,
				"credential-1",
				"anthropic",
				config,
			),
		).toThrow();
	});

	it("reads an older key version after write-key rotation", () => {
		const env = makeEnv("v1");
		const oldConfig = loadPlatformProviderCryptoConfig(env);
		const envelope = encryptPlatformProviderToken(
			"rotatable-secret",
			"credential-1",
			"openai",
			oldConfig,
		);
		const rotatedConfig = loadPlatformProviderCryptoConfig({
			...env,
			PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION: "v2",
		});

		expect(
			decryptPlatformProviderToken(
				envelope,
				"credential-1",
				"openai",
				rotatedConfig,
			),
		).toBe("rotatable-secret");
	});

	it("produces stable domain-separated fingerprints and masked display", () => {
		const config = loadPlatformProviderCryptoConfig(makeEnv());
		const first = fingerprintPlatformProviderToken("same-token", config);
		const second = fingerprintPlatformProviderToken("same-token", config);

		expect(first).toBe(second);
		expect(first).toHaveLength(64);
		expect(first).not.toContain("same-token");
		expect(maskPlatformProviderToken("sk-platform-secret")).toBe(
			"sk-p••••••cret",
		);
		expect(maskPlatformProviderToken("tiny")).toBe("••••••••");
	});

	it("fails closed when configuration is incomplete", () => {
		expect(() => loadPlatformProviderCryptoConfig({})).toThrow(
			"Platform provider encryption is not configured",
		);
		expect(() =>
			loadPlatformProviderCryptoConfig({
				PLATFORM_PROVIDER_ENCRYPTION_KEYS: `v1:${randomBytes(31).toString("base64")}`,
				PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION: "v1",
				PLATFORM_PROVIDER_FINGERPRINT_KEY: randomBytes(32).toString("base64"),
			}),
		).toThrow("must decode to exactly 32 bytes");
	});
});
