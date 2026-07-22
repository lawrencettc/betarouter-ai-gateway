import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getAvailableProvidersForProjectMode,
	getRoutingCandidatesForProjectMode,
	preferProvidersWithKeys,
} from "./hybrid-provider-routing.js";

import type { ProviderModelMapping } from "@llmgateway/models";

const routingMocks = vi.hoisted(() => ({
	findPlatformProviderIds: vi.fn(),
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findActivePlatformProviderIds: routingMocks.findPlatformProviderIds,
}));

describe("hybrid-provider-routing", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	const originalGoogleVertexKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
	const originalEncryptionKeys = process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS;
	const originalEncryptionVersion =
		process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION;
	const originalFingerprintKey = process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY;

	afterEach(() => {
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
		}

		if (originalGoogleVertexKey === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
		} else {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = originalGoogleVertexKey;
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
		routingMocks.findPlatformProviderIds.mockReset();
	});

	it("includes database-only platform providers in credits mode", async () => {
		process.env.PLATFORM_PROVIDER_ENCRYPTION_KEYS = "v1:configured";
		process.env.PLATFORM_PROVIDER_ENCRYPTION_CURRENT_VERSION = "v1";
		process.env.PLATFORM_PROVIDER_FINGERPRINT_KEY = "configured";
		routingMocks.findPlatformProviderIds.mockResolvedValue([
			"openai",
			"anthropic",
		]);

		const result = await getAvailableProvidersForProjectMode(
			"credits",
			[],
			["openai"],
		);

		expect(result.availableProviders).toEqual(["openai"]);
	});

	it("returns only provider keys in api-keys mode", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai";

		const result = await getAvailableProvidersForProjectMode(
			"api-keys",
			[{ provider: "google-ai-studio" }, { provider: "alibaba" }],
			["google-ai-studio", "google-vertex", "alibaba"],
		);

		expect(result.availableProviders).toEqual(["google-ai-studio", "alibaba"]);
		expect([...result.providersWithKeys]).toEqual([
			"google-ai-studio",
			"alibaba",
		]);
	});

	it("prefers keyed providers over credits-backed providers in hybrid mode", async () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-env-key";

		const result = await getAvailableProvidersForProjectMode(
			"hybrid",
			[{ provider: "google-ai-studio" }],
			["google-ai-studio", "google-vertex"],
		);

		expect(result.availableProviders).toEqual([
			"google-ai-studio",
			"google-vertex",
		]);

		const candidates: ProviderModelMapping[] = [
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
		];

		expect(
			preferProvidersWithKeys("hybrid", candidates, result.providersWithKeys),
		).toMatchObject([
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
			},
		]);
	});

	it("falls back to non-rate-limited credits providers when every keyed candidate is rate limited", () => {
		const candidates: ProviderModelMapping[] = [
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
		];

		expect(
			getRoutingCandidatesForProjectMode(
				"hybrid",
				candidates,
				new Set(["google-ai-studio"]),
				new Set(["google-ai-studio"]),
			),
		).toMatchObject([
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
			},
		]);
	});

	it("keeps keyed candidates if every provider is rate limited", () => {
		const candidates: ProviderModelMapping[] = [
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
		];

		expect(
			getRoutingCandidatesForProjectMode(
				"hybrid",
				candidates,
				new Set(["google-ai-studio", "google-vertex"]),
				new Set(["google-ai-studio"]),
			),
		).toMatchObject([
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
			},
		]);
	});
});
