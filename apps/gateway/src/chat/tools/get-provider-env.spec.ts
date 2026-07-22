import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportKeyError, resetKeyHealth } from "@/lib/api-key-health.js";
import { resetRoundRobinCounters } from "@/lib/round-robin-env.js";

import {
	getEnvKeyCount,
	getProviderEnv,
	getServiceTierIneligibleEnvIndices,
	hasServiceTierEligibleEnvCredential,
} from "./get-provider-env.js";

import type * as DbModule from "@llmgateway/db";

const platformMocks = vi.hoisted(() => ({
	findCredentials: vi.fn(),
	decryptToken: vi.fn(),
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findActivePlatformProviderCredentials: platformMocks.findCredentials,
}));

vi.mock("@llmgateway/db", async (importOriginal) => {
	const actual = await importOriginal<typeof DbModule>();
	return {
		...actual,
		decryptPlatformProviderToken: platformMocks.decryptToken,
	};
});

describe("getProviderEnv", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	const originalEncryptionKeys = process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS;
	const originalEncryptionVersion =
		process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION;
	const originalFingerprintKey = process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY;

	beforeEach(() => {
		resetRoundRobinCounters();
		resetKeyHealth();
		platformMocks.findCredentials.mockReset();
		platformMocks.findCredentials.mockResolvedValue([]);
		platformMocks.decryptToken.mockReset();
		process.env.LLM_OPENAI_API_KEY = "sk-openai-a,sk-openai-b,sk-openai-c";
		delete process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS;
		delete process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION;
		delete process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY;
	});

	afterEach(() => {
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
		}
		if (originalEncryptionKeys === undefined) {
			delete process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS;
		} else {
			process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS = originalEncryptionKeys;
		}
		if (originalEncryptionVersion === undefined) {
			delete process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION;
		} else {
			process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION =
				originalEncryptionVersion;
		}
		if (originalFingerprintKey === undefined) {
			delete process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY;
		} else {
			process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY = originalFingerprintKey;
		}
	});

	function enablePlatformStorage() {
		process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS = "v1:configured";
		process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION = "v1";
		process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY = "configured";
	}

	it("prefers active database credentials over environment keys", async () => {
		enablePlatformStorage();
		platformMocks.findCredentials.mockResolvedValue([
			{
				id: "platform-1",
				provider: "openai",
				baseUrl: "https://platform.example.com",
				options: { azure_resource: "resource-a" },
			},
		]);
		platformMocks.decryptToken.mockReturnValue("sk-platform");

		const result = await getProviderEnv("openai");

		expect(result).toMatchObject({
			token: "sk-platform",
			credentialId: "platform-1",
			baseUrl: "https://platform.example.com",
			source: "database",
		});
		expect(platformMocks.decryptToken).toHaveBeenCalledWith(
			expect.objectContaining({ id: "platform-1" }),
			"platform-1",
			"openai",
		);
	});

	it("falls back to the environment when there are no active database credentials", async () => {
		enablePlatformStorage();
		platformMocks.findCredentials.mockResolvedValue([]);

		const result = await getProviderEnv("openai");

		expect(result.token).toBe("sk-openai-a");
		expect(result.source).toBe("environment");
	});

	it("honors exclusions when selecting database credentials", async () => {
		enablePlatformStorage();
		platformMocks.findCredentials.mockResolvedValue([
			{ id: "platform-1", provider: "openai" },
			{ id: "platform-2", provider: "openai" },
		]);
		platformMocks.decryptToken.mockImplementation(
			(credential: { id: string }) =>
				credential.id === "platform-2" ? "sk-platform-2" : "sk-platform-1",
		);

		const result = await getProviderEnv("openai", {
			excludedIndices: new Set([0]),
		});

		expect(result.token).toBe("sk-platform-2");
		expect(result.configIndex).toBe(1);
	});

	it("keeps a healthy higher-priority database credential ahead of lower priorities", async () => {
		enablePlatformStorage();
		platformMocks.findCredentials.mockResolvedValue([
			{ id: "platform-primary", provider: "openai", priority: 10 },
			{ id: "platform-secondary", provider: "openai", priority: 100 },
		]);
		platformMocks.decryptToken.mockImplementation(
			(credential: { id: string }) =>
				credential.id === "platform-primary" ? "sk-primary" : "sk-secondary",
		);

		const result = await getProviderEnv("openai");

		expect(result.token).toBe("sk-primary");
		expect(result.configIndex).toBe(0);
	});

	it("skips database credentials whose proxy cannot carry a service tier", async () => {
		enablePlatformStorage();
		platformMocks.findCredentials.mockResolvedValue([
			{
				id: "platform-proxy",
				provider: "google-ai-studio",
				baseUrl: "https://proxy.example.com",
			},
			{
				id: "platform-upstream",
				provider: "google-ai-studio",
				baseUrl: null,
			},
		]);
		platformMocks.decryptToken.mockImplementation(
			(credential: { id: string }) =>
				credential.id === "platform-upstream" ? "sk-upstream" : "sk-proxy",
		);

		const result = await getProviderEnv("google-ai-studio", {
			requireServiceTierSupport: true,
		});

		expect(result.token).toBe("sk-upstream");
		expect(result.configIndex).toBe(1);
	});

	it("fails closed when an active database credential cannot be decrypted", async () => {
		enablePlatformStorage();
		platformMocks.findCredentials.mockResolvedValue([
			{ id: "platform-1", provider: "openai" },
		]);
		platformMocks.decryptToken.mockImplementation(() => {
			throw new Error("decrypt failed");
		});

		await expect(getProviderEnv("openai")).rejects.toMatchObject({
			status: 500,
		});
	});

	it("supports non-mutating lookups for auxiliary requests", async () => {
		const completionSelection = await getProviderEnv("openai");
		expect(completionSelection.token).toBe("sk-openai-a");
		expect(completionSelection.configIndex).toBe(0);

		const moderationSelection = await getProviderEnv("openai", {
			advanceRoundRobin: false,
		});
		expect(moderationSelection.token).toBe("sk-openai-a");
		expect(moderationSelection.configIndex).toBe(0);

		const nextCompletionSelection = await getProviderEnv("openai");
		expect(nextCompletionSelection.token).toBe("sk-openai-a");
		expect(nextCompletionSelection.configIndex).toBe(0);
	});

	it("defaults to the primary key while it is healthy", async () => {
		expect((await getProviderEnv("openai")).configIndex).toBe(0);
		expect((await getProviderEnv("openai")).configIndex).toBe(0);
	});

	it("can exclude failed keys when retrying the same provider", async () => {
		const secondKey = await getProviderEnv("openai", {
			excludedIndices: new Set([0]),
		});
		expect(secondKey.token).toBe("sk-openai-b");
		expect(secondKey.configIndex).toBe(1);

		const thirdKey = await getProviderEnv("openai", {
			excludedIndices: new Set([0, 1]),
		});
		expect(thirdKey.token).toBe("sk-openai-c");
		expect(thirdKey.configIndex).toBe(2);
	});

	it("passes selection scope through to env key health", async () => {
		reportKeyError("LLM_OPENAI_API_KEY", 0, 500, undefined, "gpt-4");
		reportKeyError("LLM_OPENAI_API_KEY", 0, 500, undefined, "gpt-4");
		reportKeyError("LLM_OPENAI_API_KEY", 0, 500, undefined, "gpt-4");

		const gpt4Selection = await getProviderEnv("openai", {
			selectionScope: "gpt-4",
		});
		const claudeSelection = await getProviderEnv("openai", {
			selectionScope: "claude-3-5-sonnet",
		});

		expect(gpt4Selection.configIndex).toBe(1);
		expect(claudeSelection.configIndex).toBe(0);
	});
});

describe("getEnvKeyCount", () => {
	const envVar = "LLM_TEST_ENV_KEY_COUNT";

	afterEach(() => {
		delete process.env.LLM_TEST_ENV_KEY_COUNT;
	});

	it("returns 0 when the env var name is undefined", () => {
		expect(getEnvKeyCount(undefined)).toBe(0);
	});

	it("returns 0 when the env var is unset or empty", () => {
		delete process.env.LLM_TEST_ENV_KEY_COUNT;
		expect(getEnvKeyCount(envVar)).toBe(0);
		process.env.LLM_TEST_ENV_KEY_COUNT = "";
		expect(getEnvKeyCount(envVar)).toBe(0);
	});

	it("counts a single key", () => {
		process.env.LLM_TEST_ENV_KEY_COUNT = "sk-only";
		expect(getEnvKeyCount(envVar)).toBe(1);
	});

	it("counts comma-separated keys", () => {
		process.env.LLM_TEST_ENV_KEY_COUNT = "sk-a,sk-b,sk-c";
		expect(getEnvKeyCount(envVar)).toBe(3);
	});

	it("ignores whitespace and empty segments from trailing commas", () => {
		process.env.LLM_TEST_ENV_KEY_COUNT = " sk-a , sk-b ,";
		expect(getEnvKeyCount(envVar)).toBe(2);
		process.env.LLM_TEST_ENV_KEY_COUNT = ",,";
		expect(getEnvKeyCount(envVar)).toBe(0);
	});
});

describe("service-tier env credential eligibility", () => {
	const originalKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
	const originalBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
	const originalRegion = process.env.LLM_GOOGLE_VERTEX_REGION;

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
		} else {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = originalKey;
		}
		if (originalBaseUrl === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		} else {
			process.env.LLM_GOOGLE_VERTEX_BASE_URL = originalBaseUrl;
		}
		if (originalRegion === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_REGION;
		} else {
			process.env.LLM_GOOGLE_VERTEX_REGION = originalRegion;
		}
	});

	it("flags only the env indices whose base URL is a custom proxy", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://vertex-proxy.invalid,https://aiplatform.googleapis.com";

		const ineligible = getServiceTierIneligibleEnvIndices("google-vertex");
		expect([...ineligible]).toEqual([0]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(true);
	});

	it("treats an unset base URL as the eligible managed default", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a";
		delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual(
			[],
		);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(true);
	});

	it("reports no eligible credential when every index is a custom proxy", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://proxy-one.invalid,https://proxy-two.invalid";

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual([
			0, 1,
		]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(false);
	});

	it("flags a non-global Vertex region index as ineligible", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		process.env.LLM_GOOGLE_VERTEX_REGION = "global,us-central1";

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual([
			1,
		]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(true);
	});

	it("rejects when the only base-URL-compliant index is a non-global region", () => {
		// index 0: proxy base URL (global region); index 1: canonical upstream but
		// us-central1 — neither can carry the tier, so the provider is ineligible.
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://vertex-proxy.invalid,https://aiplatform.googleapis.com";
		process.env.LLM_GOOGLE_VERTEX_REGION = "global,us-central1";

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual([
			0, 1,
		]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(false);
	});
});
