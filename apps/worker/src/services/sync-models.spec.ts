import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	db,
	desc,
	eq,
	model,
	modelProviderMapping,
	platformCatalogRevision,
	platformMappingPolicy,
	platformModelPolicy,
	platformProviderPolicy,
	provider,
} from "@betarouter/db";
import {
	expandAllProviderRegions,
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@betarouter/models";

import { syncProvidersAndModels } from "./sync-models.js";

describe("sync-models", () => {
	beforeEach(async () => {
		// Clean up test data before each test
		await db.delete(platformMappingPolicy);
		await db.delete(platformModelPolicy);
		await db.delete(platformProviderPolicy);
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
	});

	afterEach(async () => {
		// Clean up test data after each test
		await db.delete(platformMappingPolicy);
		await db.delete(platformModelPolicy);
		await db.delete(platformProviderPolicy);
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
	});

	it("should sync providers from @betarouter/models package", async () => {
		await syncProvidersAndModels();

		const providers = await db.select().from(provider);

		// Should have synced providers from the models package
		expect(providers.length).toBeGreaterThan(0);

		// Check for specific known providers
		const providerIds = providers.map((p) => p.id);
		expect(providerIds).toContain("openai");
		expect(providerIds).toContain("anthropic");
		expect(providerIds).toContain("google-ai-studio");
		expect(providerIds).toContain("glacier");

		// Verify provider properties
		const openaiProvider = providers.find((p) => p.id === "openai");
		expect(openaiProvider).toBeTruthy();
		expect(openaiProvider?.name).toBe("OpenAI");
		expect(openaiProvider?.streaming).toBe(true);
		expect(openaiProvider?.status).toBe("active");
	});

	it("should sync models from @betarouter/models package", async () => {
		await syncProvidersAndModels();

		const models = await db.select().from(model);

		// Should have synced models from the models package
		expect(models.length).toBeGreaterThan(0);

		// Check for specific known models
		const modelIds = models.map((m) => m.id);
		expect(modelIds).toContain("gpt-4o");
		expect(modelIds).toContain("claude-3-5-sonnet");

		// Verify model properties
		const gptModel = models.find((m) => m.id === "gpt-4o");
		expect(gptModel).toBeTruthy();
		expect(gptModel?.family).toBe("openai");
		expect(gptModel?.status).toBe("active");
	});

	it("should sync model-provider mappings", async () => {
		await syncProvidersAndModels();

		const mappings = await db.select().from(modelProviderMapping);

		// Should have synced model-provider mappings
		expect(mappings.length).toBeGreaterThan(0);

		// Check for specific known mappings
		const gptOpenaiMapping = mappings.find(
			(m) => m.modelId === "gpt-4o" && m.providerId === "openai",
		);
		expect(gptOpenaiMapping).toBeTruthy();
		expect(gptOpenaiMapping?.externalId).toBe("gpt-4o");
		expect(gptOpenaiMapping?.status).toBe("active");
	});

	it("should update existing providers on conflict", async () => {
		// Insert initial provider data
		await db.insert(provider).values({
			id: "openai",
			name: "Old OpenAI Name",
			description: "Old description",
			streaming: false,
			cancellation: false,
			color: "#000000",
			website: "https://old-website.com",
			status: "active",
		});

		await syncProvidersAndModels();

		const providers = await db
			.select()
			.from(provider)
			.where(eq(provider.id, "openai"));

		expect(providers).toHaveLength(1);
		const openaiProvider = providers[0]!;
		expect(openaiProvider.name).toBe("OpenAI"); // Should be updated
		expect(openaiProvider.streaming).toBe(true); // Should be updated
		expect(openaiProvider.updatedAt).not.toBeNull();
	});

	it("should update existing models on conflict", async () => {
		// Insert initial model data
		await db.insert(model).values({
			id: "gpt-4o",
			name: "Old GPT-4o Name",
			family: "old-family",
			status: "active",
		});

		await syncProvidersAndModels();

		const models = await db.select().from(model).where(eq(model.id, "gpt-4o"));

		expect(models).toHaveLength(1);
		const gptModel = models[0]!;
		expect(gptModel.family).toBe("openai"); // Should be updated
		expect(gptModel.updatedAt).not.toBeNull();
	});

	it("should update existing model-provider mappings", async () => {
		// First sync to create providers and models
		await syncProvidersAndModels();

		// Modify an existing mapping
		const existingMapping = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.modelId, "gpt-4o"))
			.limit(1);

		if (existingMapping[0]) {
			await db
				.update(modelProviderMapping)
				.set({
					externalId: "old-model-name",
					streaming: false,
				})
				.where(eq(modelProviderMapping.id, existingMapping[0].id));
		}

		// Sync again
		await syncProvidersAndModels();

		// Check that the mapping was updated
		const updatedMapping = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, existingMapping[0]!.id));

		expect(updatedMapping).toHaveLength(1);
		expect(updatedMapping[0]?.externalId).toBe("gpt-4o"); // Should be restored
		expect(updatedMapping[0]?.streaming).toBe(true); // Should be restored
		expect(updatedMapping[0]?.updatedAt).not.toBeNull();
	});

	it("should create new model-provider mappings for new models", async () => {
		// First, create just providers
		await syncProvidersAndModels();

		const initialMappingCount = await db.select().from(modelProviderMapping);

		// Run sync again (simulating a new model being added to the models package)
		await syncProvidersAndModels();

		const finalMappingCount = await db.select().from(modelProviderMapping);

		// Should have the same or more mappings (depending on if new models were added)
		expect(finalMappingCount.length).toBeGreaterThanOrEqual(
			initialMappingCount.length,
		);
	});

	it("publishes new source rows without overwriting operator policy", async () => {
		await syncProvidersAndModels();
		const [openaiMapping] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, "openai:gpt-4o"))
			.limit(1);
		const mapping =
			openaiMapping ??
			(
				await db
					.select()
					.from(modelProviderMapping)
					.where(eq(modelProviderMapping.modelId, "gpt-4o"))
					.limit(1)
			)[0];
		expect(mapping).toBeDefined();

		await db.insert(platformProviderPolicy).values({
			providerId: "openai",
			visible: false,
			enabled: false,
			sortOrder: 321,
			lifecycle: "draft",
			updatedBy: "test-operator",
		});
		await db.insert(platformModelPolicy).values({
			modelId: "gpt-4o",
			visible: false,
			enabled: false,
			allowDirect: false,
			sortOrder: 654,
			lifecycle: "draft",
			updatedBy: "test-operator",
		});
		await db.insert(platformMappingPolicy).values({
			mappingId: mapping!.id,
			enabled: false,
			priority: 77,
			weight: 33,
			updatedBy: "test-operator",
		});

		await db.insert(provider).values({
			id: "source-refresh-test",
			name: "Source refresh test",
			description: "Synthetic source row for reconciliation coverage",
			streaming: true,
			cancellation: false,
			color: "#000000",
			website: "https://example.com",
			status: "active",
		});
		await db.insert(model).values({
			id: "source-refresh-model",
			name: "Source refresh model",
			family: "test",
			status: "active",
		});
		await db.insert(modelProviderMapping).values({
			id: "source-refresh-mapping",
			providerId: "source-refresh-test",
			modelId: "source-refresh-model",
			externalId: "source-refresh-upstream",
			status: "active",
		});

		const [before] = await db
			.select({ id: platformCatalogRevision.id })
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		await syncProvidersAndModels();
		const [after] = await db
			.select()
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);

		expect(after?.id).toBeGreaterThan(before?.id ?? 0);
		const snapshot = after?.snapshot as {
			providers?: Array<{ id: string }>;
			models?: Array<{ id: string }>;
			mappings?: Array<{ id: string }>;
		};
		expect(snapshot.providers?.map((item) => item.id)).toContain(
			"source-refresh-test",
		);
		expect(snapshot.models?.map((item) => item.id)).toContain(
			"source-refresh-model",
		);
		expect(snapshot.mappings?.map((item) => item.id)).toContain(
			"source-refresh-mapping",
		);

		const [providerPolicy] = await db
			.select()
			.from(platformProviderPolicy)
			.where(eq(platformProviderPolicy.providerId, "openai"));
		const [modelPolicy] = await db
			.select()
			.from(platformModelPolicy)
			.where(eq(platformModelPolicy.modelId, "gpt-4o"));
		const [mappingPolicy] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, mapping!.id));
		expect(providerPolicy?.sortOrder).toBe(321);
		expect(modelPolicy?.sortOrder).toBe(654);
		expect(mappingPolicy).toMatchObject({ priority: 77, weight: 33 });

		await syncProvidersAndModels();
		const [idempotent] = await db
			.select({ id: platformCatalogRevision.id })
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		expect(idempotent?.id).toBe(after?.id);
	});

	it("should handle models with pricing information", async () => {
		await syncProvidersAndModels();

		// Find a mapping that should have pricing
		const mappingWithPricing = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.modelId, "gpt-4o"))
			.limit(1);

		if (mappingWithPricing[0]) {
			// Should have pricing information
			expect(mappingWithPricing[0].inputPrice).not.toBeNull();
			expect(mappingWithPricing[0].outputPrice).not.toBeNull();
		}
	});

	it("should handle errors gracefully", async () => {
		// This test ensures the function doesn't throw on edge cases
		await expect(syncProvidersAndModels()).resolves.not.toThrow();
	});

	// Phase 3 reads the catalog from the database instead of the static
	// arrays, so every code-defined field must survive one sync verbatim.
	it("mirrors every code-defined field to the database", async () => {
		await syncProvidersAndModels();

		const numeric = (value: string | null | undefined) =>
			value === null || value === undefined ? null : Number(value);

		const providerRows = await db.select().from(provider);
		expect(providerRows).toHaveLength(providerDefinitions.length);
		const providerById = new Map(providerRows.map((row) => [row.id, row]));
		for (const def of providerDefinitions) {
			const row = providerById.get(def.id);
			expect(row, `provider ${def.id}`).toBeDefined();
			expect(
				{
					name: row!.name,
					description: row!.description,
					streaming: row!.streaming,
					cancellation: row!.cancellation,
					color: row!.color,
					website: row!.website,
					announcement: row!.announcement,
					protocol: row!.protocol,
					priority: row!.priority,
					contentFilter: row!.contentFilter,
					maxTemperature: row!.maxTemperature,
					headquarters: row!.headquarters,
					dataPolicy: row!.dataPolicy,
					serviceTiers: row!.serviceTiers,
					regionConfig: row!.regionConfig,
					termsUrl: row!.termsUrl,
					privacyPolicyUrl: row!.privacyPolicyUrl,
					statusPageUrl: row!.statusPageUrl,
					apiKeyInstructions: row!.apiKeyInstructions,
					modelCardBadge: row!.modelCardBadge,
					additionalLinks: row!.additionalLinks,
					source: row!.source,
					status: row!.status,
				},
				`provider ${def.id}`,
			).toEqual({
				name: def.name,
				description: def.description,
				streaming: def.streaming ?? null,
				cancellation: def.cancellation ?? null,
				color: def.color ?? null,
				website: def.website ?? null,
				announcement: def.announcement ?? null,
				protocol: def.protocol,
				priority: def.priority ?? null,
				contentFilter: def.contentFilter ?? null,
				maxTemperature: def.maxTemperature ?? null,
				headquarters: def.headquarters ?? null,
				dataPolicy: def.dataPolicy ?? null,
				serviceTiers: def.serviceTiers ?? null,
				regionConfig: def.regionConfig ?? null,
				termsUrl: def.termsUrl ?? null,
				privacyPolicyUrl: def.privacyPolicyUrl ?? null,
				statusPageUrl: def.statusPageUrl ?? null,
				apiKeyInstructions: def.apiKeyInstructions ?? null,
				modelCardBadge: def.modelCardBadge ?? null,
				additionalLinks: def.additionalLinks ?? null,
				source: "static",
				status: "active",
			});
		}

		const modelRows = await db.select().from(model);
		expect(modelRows).toHaveLength(modelDefinitions.length);
		const modelById = new Map(modelRows.map((row) => [row.id, row]));
		for (const def of modelDefinitions) {
			const row = modelById.get(def.id);
			expect(row, `model ${def.id}`).toBeDefined();
			expect(
				{
					name: row!.name,
					family: row!.family,
					aliases: row!.aliases,
					description: row!.description,
					free: row!.free,
					output: row!.output,
					imageInputRequired: row!.imageInputRequired,
					stability: row!.stability,
					source: row!.source,
					status: row!.status,
				},
				`model ${def.id}`,
			).toEqual({
				name: def.name,
				family: def.family,
				aliases: "aliases" in def ? def.aliases : [],
				description: "description" in def ? def.description : "(empty)",
				free: "free" in def ? def.free : false,
				output: "output" in def ? def.output : ["text"],
				imageInputRequired:
					"imageInputRequired" in def ? def.imageInputRequired : false,
				stability: "stability" in def ? def.stability : "stable",
				source: "static",
				status: "active",
			});
			if ("releasedAt" in def && def.releasedAt) {
				expect(row!.releasedAt.getTime(), `model ${def.id} releasedAt`).toBe(
					def.releasedAt.getTime(),
				);
			}
		}

		const mappingRows = await db.select().from(modelProviderMapping);
		const mappingByKey = new Map(
			mappingRows.map((row) => [
				`${row.modelId}|${row.providerId}|${row.region ?? ""}`,
				row,
			]),
		);
		const priceFields = [
			"inputPrice",
			"outputPrice",
			"cachedInputPrice",
			"cacheReadInputPrice",
			"cacheWriteInputPrice",
			"cacheWriteInputPrice1h",
			"imageInputPrice",
			"imageOutputPrice",
			"inputAudioPrice",
			"cachedImageInputPrice",
			"cachedInputAudioPrice",
			"outputAudioPrice",
			"inputCharacterPrice",
			"ocrPagePrice",
			"inputAudioHourPrice",
			"requestPrice",
			"webSearchPrice",
		] as const;
		let expandedCount = 0;
		for (const def of modelDefinitions) {
			if (!(def.providers && def.providers.length > 0)) {
				continue;
			}
			for (const mapping of expandAllProviderRegions(def.providers)) {
				expandedCount += 1;
				const key = `${def.id}|${mapping.providerId}|${mapping.region ?? ""}`;
				const row = mappingByKey.get(key);
				expect(row, `mapping ${key}`).toBeDefined();
				for (const field of priceFields) {
					expect(numeric(row![field]), `mapping ${key} ${field}`).toBe(
						mapping[field] !== undefined ? Number(mapping[field]) : null,
					);
				}
				expect(
					{
						externalId: row!.externalId,
						perSecondPrice: row!.perSecondPrice,
						pricingTiers: row!.pricingTiers,
						serviceTierMultipliers: row!.serviceTierMultipliers,
						contextSize: row!.contextSize,
						maxOutput: row!.maxOutput,
						streaming: row!.streaming,
						vision: row!.vision,
						reasoning: row!.reasoning,
						reasoningMaxTokens: row!.reasoningMaxTokens,
						reasoningOutput: row!.reasoningOutput,
						tools: row!.tools,
						jsonOutput: row!.jsonOutput,
						jsonOutputSchema: row!.jsonOutputSchema,
						webSearch: row!.webSearch,
						stability: row!.stability,
						supportedParameters: row!.supportedParameters,
						supportedToolChoices: row!.supportedToolChoices,
						reasoningEfforts: row!.reasoningEfforts,
						test: row!.test,
						source: row!.source,
						status: row!.status,
					},
					`mapping ${key}`,
				).toEqual({
					externalId: mapping.externalId,
					perSecondPrice: mapping.perSecondPrice ?? null,
					pricingTiers: mapping.pricingTiers
						? mapping.pricingTiers.map((tier) => ({
								...tier,
								upToTokens: Number.isFinite(tier.upToTokens)
									? tier.upToTokens
									: null,
							}))
						: null,
					serviceTierMultipliers: mapping.serviceTierMultipliers ?? null,
					contextSize: mapping.contextSize ?? null,
					maxOutput: mapping.maxOutput ?? null,
					streaming: mapping.streaming === false ? false : true,
					vision: mapping.vision ?? null,
					reasoning: mapping.reasoning ?? null,
					reasoningMaxTokens: mapping.reasoningMaxTokens ?? false,
					reasoningOutput: mapping.reasoningOutput ?? null,
					tools: mapping.tools ?? null,
					jsonOutput: mapping.jsonOutput ?? false,
					jsonOutputSchema: mapping.jsonOutputSchema ?? false,
					webSearch: mapping.webSearch ?? false,
					stability: mapping.stability ?? "stable",
					supportedParameters: mapping.supportedParameters ?? null,
					supportedToolChoices: mapping.supportedToolChoices ?? null,
					reasoningEfforts: mapping.reasoningEfforts ?? null,
					test: mapping.test ?? null,
					source: "static",
					status: "active",
				});
				expect(
					row!.deprecatedAt?.getTime() ?? null,
					`mapping ${key} deprecatedAt`,
				).toBe(mapping.deprecatedAt?.getTime() ?? null);
				expect(
					row!.deactivatedAt?.getTime() ?? null,
					`mapping ${key} deactivatedAt`,
				).toBe(mapping.deactivatedAt?.getTime() ?? null);
			}
		}
		expect(mappingRows).toHaveLength(expandedCount);
	});
});
