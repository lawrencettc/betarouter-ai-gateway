import { describe, expect, it } from "vitest";

import { resolveEffectiveCatalog } from "./catalog.js";
import {
	catalogSnapshotHasBaseData,
	compareCatalogModelResolution,
	hasPricingDivergence,
	resolveModelFromCatalog,
} from "./model-resolution.js";
import { parseStoredCatalogSnapshot } from "./runtime.js";

import type { CatalogResolverInput } from "./catalog.js";
import type { ModelDefinition } from "@betarouter/models";

const staticDef: ModelDefinition = {
	id: "gpt",
	name: "GPT",
	family: "openai",
	aliases: ["gpt-latest"],
	providers: [
		{
			providerId: "openai",
			externalId: "gpt-upstream",
			inputPrice: "1.4e-6",
			outputPrice: "5.6e-6",
			cachedInputPrice: "1.4e-7",
			requestPrice: "0.002",
			webSearchPrice: "0.01",
			perSecondPrice: { default: "0.05" },
			contextSize: 128_000,
			maxOutput: 16_384,
			streaming: "only",
			vision: true,
			reasoning: true,
			audio: true,
			supportsResponsesApi: true,
			jsonOutput: true,
			supportedParameters: ["temperature", "max_tokens"],
			pricingTiers: [
				{
					name: "128K",
					upToTokens: 128_000,
					inputPrice: "1.4e-6",
					outputPrice: "5.6e-6",
				},
				{
					name: "unbounded",
					upToTokens: Infinity,
					inputPrice: "2.8e-6",
					outputPrice: "1.12e-5",
				},
			],
			serviceTierMultipliers: { flex: 0.5 },
		},
	],
};

// The resolver input mirrors what the worker sync writes for staticDef:
// per-million source prices, streaming "only" collapsed to true, an
// unbounded pricing tier stored as null, and column defaults filled in.
function resolverInput(): CatalogResolverInput {
	return {
		revision: 12,
		now: new Date("2026-08-05T00:00:00.000Z"),
		providers: [{ id: "openai", status: "active" }],
		models: [
			{
				id: "gpt",
				status: "active",
				name: "GPT",
				family: "openai",
				aliases: ["gpt-latest"],
				output: ["text"],
				free: false,
			},
		],
		mappings: [
			{
				id: "openai-gpt",
				providerId: "openai",
				modelId: "gpt",
				status: "active",
				externalId: "gpt-upstream",
				contextSize: 128_000,
				maxOutput: 16_384,
				streaming: true,
				vision: true,
				reasoning: true,
				reasoningMaxTokens: false,
				tools: null,
				jsonOutput: true,
				jsonOutputSchema: false,
				webSearch: false,
				supportedParameters: ["temperature", "max_tokens"],
				pricingTiers: [
					{
						name: "128K",
						upToTokens: 128_000,
						inputPrice: "1.4e-6",
						outputPrice: "5.6e-6",
					},
					{
						name: "unbounded",
						upToTokens: null,
						inputPrice: "2.8e-6",
						outputPrice: "1.12e-5",
					},
				],
				serviceTierMultipliers: { flex: 0.5 },
			},
		],
		providerPolicies: [],
		modelPolicies: [],
		mappingPolicies: [],
		providerCredentialAvailability: {},
		mappingReadiness: {
			"openai-gpt": {
				priceReady: true,
				testPassed: true,
				sourcePrices: {
					input: "1.4",
					output: "5.6",
					cachedInput: "0.14",
					request: "0.002",
					webSearch: "0.01",
					"second:default": "0.05",
				},
			},
		},
		breakerStates: {},
	};
}

describe("resolveModelFromCatalog", () => {
	it("reconstructs the static shape with zero divergence", () => {
		const snapshot = resolveEffectiveCatalog(resolverInput());
		expect(catalogSnapshotHasBaseData(snapshot)).toBe(true);

		const resolved = resolveModelFromCatalog("gpt", snapshot, {
			staticModels: [staticDef],
		});
		expect(resolved).not.toBeNull();
		expect(resolved?.name).toBe("GPT");
		expect(resolved?.family).toBe("openai");

		const mapping = resolved!.providers[0]!;
		expect(mapping.externalId).toBe("gpt-upstream");
		expect(Number(mapping.inputPrice)).toBe(1.4e-6);
		expect(Number(mapping.outputPrice)).toBe(5.6e-6);
		expect(Number(mapping.cachedInputPrice)).toBe(1.4e-7);
		expect(mapping.requestPrice).toBe("0.002");
		expect(mapping.webSearchPrice).toBe("0.01");
		expect(mapping.perSecondPrice).toEqual({ default: "0.05" });
		expect(mapping.streaming).toBe("only");
		expect(mapping.pricingTiers?.[1]?.upToTokens).toBe(Infinity);
		expect(mapping.serviceTierMultipliers).toEqual({ flex: 0.5 });
		expect(mapping.audio).toBe(true);
		expect(mapping.supportsResponsesApi).toBe(true);
		expect(mapping.region).toBeUndefined();
		expect(mapping.deactivatedAt).toBeUndefined();

		expect(compareCatalogModelResolution(staticDef, resolved!)).toEqual([]);
	});

	it("survives a stored-snapshot JSON round trip", () => {
		const snapshot = parseStoredCatalogSnapshot(
			JSON.parse(JSON.stringify(resolveEffectiveCatalog(resolverInput()))),
		);
		const resolved = resolveModelFromCatalog("gpt", snapshot, {
			staticModels: [staticDef],
		});
		expect(resolved).not.toBeNull();
		expect(compareCatalogModelResolution(staticDef, resolved!)).toEqual([]);
	});

	it("maps sync sentinels back to the static conventions", () => {
		const input = resolverInput();
		input.models = [
			{
				id: "gpt",
				status: "active",
				name: "(empty)",
				family: "openai",
				aliases: [],
				output: ["text"],
				free: false,
			},
		];
		const resolved = resolveModelFromCatalog(
			"gpt",
			resolveEffectiveCatalog(input),
			{ staticModels: [] },
		);
		expect(resolved?.name).toBeUndefined();
		expect(resolved?.aliases).toBeUndefined();
	});

	it("appends catalog-only mappings without a static graft", () => {
		const input = resolverInput();
		input.providers.push({ id: "some-relay", status: "active" });
		input.mappings.push({
			id: "relay-gpt",
			providerId: "some-relay",
			modelId: "gpt",
			status: "active",
			externalId: "gpt-relay",
			contextSize: 64_000,
			maxOutput: null,
			streaming: true,
			vision: null,
			reasoning: null,
			reasoningMaxTokens: false,
			tools: null,
			jsonOutput: false,
			jsonOutputSchema: false,
			webSearch: false,
			supportedParameters: null,
			pricingTiers: null,
			serviceTierMultipliers: null,
		});
		input.mappingReadiness["relay-gpt"] = {
			priceReady: true,
			testPassed: true,
			sourcePrices: { input: "1", output: "2" },
		};
		const resolved = resolveModelFromCatalog(
			"gpt",
			resolveEffectiveCatalog(input),
			{ staticModels: [staticDef] },
		);
		expect(resolved?.providers.map((p) => p.providerId)).toEqual([
			"openai",
			"some-relay",
		]);
		const relay = resolved!.providers[1]!;
		expect(relay.externalId).toBe("gpt-relay");
		expect(relay.streaming).toBe(true);
		expect(relay.supportsResponsesApi).toBeUndefined();
		expect(Number(relay.inputPrice)).toBe(1e-6);
	});

	it("serves modality flags from the snapshot without a static graft", () => {
		const input = resolverInput();
		input.models[0]!.output = ["video"];
		input.models[0]!.imageInputRequired = true;
		input.models[0]!.maxVideoDurationSeconds = 8;
		input.mappings[0]!.videoGenerations = true;
		input.mappings[0]!.embeddings = false;
		input.mappings[0]!.supportedVideoSizes = ["1280x720"];
		input.mappings[0]!.supportedVideoDurationsSeconds = [4, 8];
		input.mappings[0]!.supportsVideoAudio = true;
		input.mappings[0]!.supportedVoices = null;
		input.mappings[0]!.contentFilterPrice = "0.05";
		// JSON round trip proves the stored-snapshot schema accepts the fields.
		const snapshot = parseStoredCatalogSnapshot(
			JSON.parse(JSON.stringify(resolveEffectiveCatalog(input))),
		);
		// No static definitions: an admin-created model must get its modality
		// routing and serving-config from the snapshot alone.
		const resolved = resolveModelFromCatalog("gpt", snapshot, {
			staticModels: [],
		});
		expect(resolved?.imageInputRequired).toBe(true);
		expect(resolved?.maxVideoDurationSeconds).toBe(8);
		const mapping = resolved!.providers[0]!;
		expect(mapping.videoGenerations).toBe(true);
		expect(mapping.embeddings).toBe(false);
		expect(mapping.speechGenerations).toBeUndefined();
		expect(mapping.supportedVideoSizes).toEqual(["1280x720"]);
		expect(mapping.supportedVideoDurationsSeconds).toEqual([4, 8]);
		expect(mapping.supportsVideoAudio).toBe(true);
		// null in the mirror is authoritative "not set", never re-grafted.
		expect(mapping.supportedVoices).toBeUndefined();
		expect(mapping.contentFilterPrice).toBe(0.05);
	});

	it("grafts modality flags for pre-modality-flag snapshots", () => {
		// resolverInput leaves the flags and serving-config unset, modeling a
		// revision published before those mirrors existed.
		const embeddingsStatic: ModelDefinition = {
			...staticDef,
			imageInputRequired: true,
			maxVideoDurationSeconds: 10,
			providers: [
				{
					...staticDef.providers[0]!,
					embeddings: true,
					supportedVoices: ["alloy"],
					contentFilterPrice: 0.03,
				},
			],
		};
		const resolved = resolveModelFromCatalog(
			"gpt",
			resolveEffectiveCatalog(resolverInput()),
			{ staticModels: [embeddingsStatic] },
		);
		expect(resolved?.imageInputRequired).toBe(true);
		expect(resolved?.maxVideoDurationSeconds).toBe(10);
		expect(resolved!.providers[0]!.embeddings).toBe(true);
		expect(resolved!.providers[0]!.supportedVoices).toEqual(["alloy"]);
		expect(resolved!.providers[0]!.contentFilterPrice).toBe(0.03);
	});

	it("returns null for unknown models and pre-base-data snapshots", () => {
		const snapshot = resolveEffectiveCatalog(resolverInput());
		expect(
			resolveModelFromCatalog("missing", snapshot, { staticModels: [] }),
		).toBeNull();

		const preBaseData = resolveEffectiveCatalog({
			...resolverInput(),
			models: [{ id: "gpt", status: "active" }],
			mappings: [
				{
					id: "openai-gpt",
					providerId: "openai",
					modelId: "gpt",
					status: "active",
					externalId: "gpt-upstream",
				},
			],
		});
		expect(catalogSnapshotHasBaseData(preBaseData)).toBe(false);
		expect(
			resolveModelFromCatalog("gpt", preBaseData, {
				staticModels: [staticDef],
			}),
		).toBeNull();
	});

	it("returns null when the snapshot has no mappings for the model", () => {
		const input = resolverInput();
		input.mappings = [];
		expect(
			resolveModelFromCatalog("gpt", resolveEffectiveCatalog(input), {
				staticModels: [staticDef],
			}),
		).toBeNull();
	});
});

describe("compareCatalogModelResolution", () => {
	it("flags price drift as a pricing divergence", () => {
		const input = resolverInput();
		input.mappingReadiness["openai-gpt"]!.sourcePrices!.input = "1.5";
		const resolved = resolveModelFromCatalog(
			"gpt",
			resolveEffectiveCatalog(input),
			{ staticModels: [staticDef] },
		);
		const divergences = compareCatalogModelResolution(staticDef, resolved!);
		expect(divergences).toHaveLength(1);
		expect(divergences[0]).toMatchObject({
			modelId: "gpt",
			providerId: "openai",
			field: "inputPrice",
			pricing: true,
		});
		expect(hasPricingDivergence(divergences)).toBe(true);
	});

	it("flags modality-flag drift without a pricing marker", () => {
		const input = resolverInput();
		input.mappings[0]!.embeddings = true;
		const resolved = resolveModelFromCatalog(
			"gpt",
			resolveEffectiveCatalog(input),
			{ staticModels: [staticDef] },
		);
		const divergences = compareCatalogModelResolution(staticDef, resolved!);
		expect(divergences).toHaveLength(1);
		expect(divergences[0]).toMatchObject({
			field: "embeddings",
			pricing: false,
		});
	});

	it("flags capability drift and missing mappings without a pricing marker", () => {
		const input = resolverInput();
		input.mappings[0]!.vision = false;
		const resolved = resolveModelFromCatalog(
			"gpt",
			resolveEffectiveCatalog(input),
			{ staticModels: [staticDef] },
		);
		const capability = compareCatalogModelResolution(staticDef, resolved!);
		expect(capability).toHaveLength(1);
		expect(capability[0]).toMatchObject({ field: "vision", pricing: false });
		expect(hasPricingDivergence(capability)).toBe(false);

		const twoMappings: ModelDefinition = {
			...staticDef,
			providers: [
				...staticDef.providers,
				{
					providerId: "anthropic",
					externalId: "gpt-elsewhere",
					streaming: true,
				},
			],
		};
		const missing = compareCatalogModelResolution(twoMappings, resolved!);
		expect(
			missing.some(
				(divergence) =>
					divergence.field === "mapping" &&
					divergence.providerId === "anthropic" &&
					divergence.catalogValue === "missing",
			),
		).toBe(true);
	});
});
