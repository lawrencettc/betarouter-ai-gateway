import { describe, expect, it } from "vitest";

import { parseModelInput } from "./parse-model-input.js";
import { resolveModelInfo } from "./resolve-model-info.js";

describe("parseModelInput / resolveModelInfo catalog-id-only routing", () => {
	// Routing must carry the canonical catalog id, never the upstream externalId.
	// Two catalog entries can share an externalId (e.g. a free and a paid
	// sibling), so collapsing to the externalId would let resolution pick the
	// wrong entry. The upstream externalId is derived later from the selected
	// provider mapping.
	it("preserves the catalog id for the provider-prefixed form", () => {
		const result = parseModelInput("anthropic/claude-haiku-4-5");
		expect(result.requestedModel).toBe("claude-haiku-4-5");
		expect(result.requestedProvider).toBe("anthropic");
	});

	it("resolves the requested catalog entry strictly by id", () => {
		const { requestedModel, requestedProvider } = parseModelInput(
			"anthropic/claude-haiku-4-5",
		);
		const { modelInfo } = resolveModelInfo(requestedModel, requestedProvider);
		expect(modelInfo.id).toBe("claude-haiku-4-5");
	});

	it("still resolves a non-colliding model unchanged", () => {
		const { requestedModel, requestedProvider } =
			parseModelInput("openai/gpt-4o-mini");
		expect(requestedModel).toBe("gpt-4o-mini");
		const { modelInfo } = resolveModelInfo(requestedModel, requestedProvider);
		expect(modelInfo.id).toBe("gpt-4o-mini");
	});

	// Strict catalog-id-only routing: the provider/externalId form (upstream id)
	// is no longer accepted — callers must use the catalog id.
	it("rejects the provider/externalId form", () => {
		expect(() => parseModelInput("together-ai/zai-org/GLM-5.1")).toThrow();
	});

	it("accepts the canonical provider/catalog-id form", () => {
		const result = parseModelInput("together-ai/glm-5.1");
		expect(result.requestedModel).toBe("glm-5.1");
		expect(result.requestedProvider).toBe("together-ai");
	});
});

describe("parseModelInput platform provider resolution", () => {
	it("treats an unknown prefix as a tenant custom provider by default", () => {
		const result = parseModelInput("some-relay/gpt-4o");
		expect(result.requestedProvider).toBe("custom");
		expect(result.customProviderName).toBe("some-relay");
		expect(result.platformProviderId).toBeUndefined();
		expect(result.requestedModel).toBe("gpt-4o");
	});

	it("resolves a prefix on the platform provider list as a platform provider", () => {
		const result = parseModelInput("some-relay/gpt-4o", ["some-relay"]);
		expect(result.platformProviderId).toBe("some-relay");
		expect(result.requestedProvider).toBeUndefined();
		expect(result.customProviderName).toBeUndefined();
		// Model names of database-defined providers are not validated against
		// the static catalogue.
		expect(result.requestedModel).toBe("gpt-4o");
	});

	it("keeps a platform provider model name with slashes intact", () => {
		const result = parseModelInput("some-relay/org/model-name", ["some-relay"]);
		expect(result.platformProviderId).toBe("some-relay");
		expect(result.requestedModel).toBe("org/model-name");
	});

	it("parses the region suffix for platform providers", () => {
		const result = parseModelInput("some-relay/gpt-4o:eu", ["some-relay"]);
		expect(result.platformProviderId).toBe("some-relay");
		expect(result.requestedModel).toBe("gpt-4o");
		expect(result.requestedRegion).toBe("eu");
	});

	it("never shadows a static catalogue provider", () => {
		const result = parseModelInput("anthropic/claude-haiku-4-5", ["anthropic"]);
		expect(result.requestedProvider).toBe("anthropic");
		expect(result.platformProviderId).toBeUndefined();
	});
});

describe("parseModelInput catalog context (read-path inversion)", () => {
	const catalog = {
		modelIds: new Set(["snapshot-only-model"]),
		providerIdsByModel: new Map([
			["snapshot-only-model", new Set(["openai"])],
			["gpt-4o-mini", new Set(["anthropic"])],
		]),
	};

	it("accepts a bare model id known only to the catalog", () => {
		expect(() => parseModelInput("snapshot-only-model")).toThrow();
		const result = parseModelInput("snapshot-only-model", undefined, catalog);
		expect(result.requestedModel).toBe("snapshot-only-model");
		expect(result.requestedProvider).toBeUndefined();
	});

	it("accepts a provider/model pair known only to the catalog", () => {
		expect(() => parseModelInput("openai/snapshot-only-model")).toThrow();
		const result = parseModelInput(
			"openai/snapshot-only-model",
			undefined,
			catalog,
		);
		expect(result.requestedProvider).toBe("openai");
		expect(result.requestedModel).toBe("snapshot-only-model");
	});

	it("extends a static model with a catalog-only provider pair", () => {
		expect(() => parseModelInput("anthropic/gpt-4o-mini")).toThrow();
		const result = parseModelInput("anthropic/gpt-4o-mini", undefined, catalog);
		expect(result.requestedProvider).toBe("anthropic");
		expect(result.requestedModel).toBe("gpt-4o-mini");
	});

	it("still rejects pairs unknown to both sources", () => {
		expect(() =>
			parseModelInput("anthropic/snapshot-only-model", undefined, catalog),
		).toThrow();
		expect(() =>
			parseModelInput("definitely-not-a-model", undefined, catalog),
		).toThrow();
	});
});

describe("resolveModelInfo lookup hook (read-path inversion)", () => {
	it("resolves through the provided hook instead of the static array", () => {
		const hooked = {
			id: "snapshot-only-model",
			family: "openai",
			providers: [
				{
					providerId: "openai" as const,
					externalId: "snapshot-only-upstream",
					streaming: true,
				},
			],
		};
		const result = resolveModelInfo(
			"snapshot-only-model" as Parameters<typeof resolveModelInfo>[0],
			undefined,
			(modelId) => (modelId === "snapshot-only-model" ? hooked : undefined),
		);
		expect(result.modelInfo.id).toBe("snapshot-only-model");
		expect(result.activeProviders).toHaveLength(1);
		expect(result.activeProviders[0]?.externalId).toBe(
			"snapshot-only-upstream",
		);
	});
});
