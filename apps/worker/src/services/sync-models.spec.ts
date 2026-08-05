import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	adminMappingId,
	applyStoredCatalogChangeSet,
	catalogMappingTestProfile,
	catalogSnapshotHasBaseData,
	compareCatalogModelResolution,
	parseStoredCatalogSnapshot,
	resolveModelFromCatalog,
} from "@betarouter/catalog";
import {
	and,
	db,
	desc,
	eq,
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformMappingPolicy,
	platformMappingTestRun,
	platformModelPolicy,
	platformProviderCredential,
	platformProviderPolicy,
	provider,
} from "@betarouter/db";
import {
	expandAllProviderRegions,
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@betarouter/models";

import { syncProvidersAndModels } from "./sync-models.js";

import type { CatalogOperationV1 } from "@betarouter/catalog";
import type { PlatformCatalogOperationV1 } from "@betarouter/db";

async function applyOperations(operations: CatalogOperationV1[]) {
	const [latest] = await db
		.select({ id: platformCatalogRevision.id })
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	const [changeSet] = await db
		.insert(platformCatalogChangeSet)
		.values({
			createdBy: "phase4-test",
			title: "Phase 4 source authority test",
			reason: "Exercise create and override operations end to end",
			state: "draft",
			baseRevision: latest?.id ?? null,
			operations: operations as unknown as PlatformCatalogOperationV1[],
			idempotencyKey: `phase4-${crypto.randomUUID()}`,
		})
		.returning({ id: platformCatalogChangeSet.id });
	return await applyStoredCatalogChangeSet({
		changeSetId: changeSet!.id,
		actorId: "phase4-test",
	});
}

async function loadLatestSnapshot() {
	const [revision] = await db
		.select({
			checksum: platformCatalogRevision.checksum,
			snapshot: platformCatalogRevision.snapshot,
		})
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	expect(revision).toBeDefined();
	return parseStoredCatalogSnapshot(revision!.snapshot, revision!.checksum);
}

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

	// Phase 3 exit gate: after one sync, the published snapshot must
	// reconstruct every static model definition (via resolveModelFromCatalog)
	// with zero divergence — including numerically exact prices, which is the
	// billing-equivalence guarantee the read-path inversion relies on.
	it("reconstructs every static model from the stored snapshot", async () => {
		await syncProvidersAndModels();

		const [revision] = await db
			.select({
				checksum: platformCatalogRevision.checksum,
				snapshot: platformCatalogRevision.snapshot,
			})
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		expect(revision).toBeDefined();
		const snapshot = parseStoredCatalogSnapshot(
			revision!.snapshot,
			revision!.checksum,
		);
		expect(catalogSnapshotHasBaseData(snapshot)).toBe(true);

		const allDivergences: unknown[] = [];
		for (const def of modelDefinitions) {
			if (!(def.providers && def.providers.length > 0)) {
				continue;
			}
			const resolved = resolveModelFromCatalog(def.id, snapshot);
			expect(resolved, `model ${def.id} reconstructs`).not.toBeNull();
			for (const divergence of compareCatalogModelResolution(def, resolved!)) {
				allDivergences.push(divergence);
			}
		}
		expect(allDivergences).toEqual([]);
	});

	it("never overwrites admin-owned source rows during sync", async () => {
		await syncProvidersAndModels();

		await db
			.update(provider)
			.set({ source: "admin", name: "Operator OpenAI" })
			.where(eq(provider.id, "openai"));
		await db
			.update(model)
			.set({ source: "admin", family: "operator" })
			.where(eq(model.id, "gpt-4o"));
		const [mappingRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(
				and(
					eq(modelProviderMapping.modelId, "gpt-4o"),
					eq(modelProviderMapping.providerId, "openai"),
				),
			)
			.limit(1);
		expect(mappingRow).toBeDefined();
		await db
			.update(modelProviderMapping)
			.set({ source: "admin", externalId: "operator-owned" })
			.where(eq(modelProviderMapping.id, mappingRow!.id));

		await syncProvidersAndModels();

		const [providerRow] = await db
			.select()
			.from(provider)
			.where(eq(provider.id, "openai"));
		expect(providerRow).toMatchObject({
			name: "Operator OpenAI",
			source: "admin",
		});
		const [modelRow] = await db
			.select()
			.from(model)
			.where(eq(model.id, "gpt-4o"));
		expect(modelRow).toMatchObject({ family: "operator", source: "admin" });
		const [afterMapping] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, mappingRow!.id));
		expect(afterMapping).toMatchObject({
			externalId: "operator-owned",
			source: "admin",
		});
	});

	// Phase 4 exit gate: create an OpenAI-compatible relay provider, attach a
	// credential, create a mapping on an existing model, pass the mapping
	// test, set a fixed price policy, enable — and the chat read path serves
	// the mapping at the configured prices, with no code change and no deploy.
	it("serves the relay scenario end to end through change sets", async () => {
		await syncProvidersAndModels();
		// Credentials have no FK to the provider table, so a relay credential
		// from a previous suite run survives the table cleanup above and would
		// make the draft-stage admission assertions pass vacuously.
		await db
			.delete(platformProviderCredential)
			.where(eq(platformProviderCredential.provider, "acme-relay"));
		const relayMappingId = adminMappingId({
			modelId: "gpt-5.5",
			providerId: "acme-relay",
		});

		await applyOperations([
			{
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "acme-relay",
					name: "Acme Relay",
					description: "OpenAI-compatible relay",
					protocol: "openai-chat",
					website: "https://relay.example.com",
				},
			},
			{
				version: 1,
				type: "mapping.create",
				expectedUpdatedAt: null,
				create: {
					modelId: "gpt-5.5",
					providerId: "acme-relay",
					externalId: "gpt-5.5-relay",
					contextSize: 200000,
					maxOutput: 32768,
					vision: true,
					tools: true,
					inputPrice: "1.5e-6",
					outputPrice: "6e-6",
					cacheReadInputPrice: "2e-7",
				},
			},
		]);

		const [relayProvider] = await db
			.select()
			.from(provider)
			.where(eq(provider.id, "acme-relay"));
		expect(relayProvider).toMatchObject({
			source: "admin",
			protocol: "openai-chat",
			status: "active",
		});
		const [relayMapping] = await db
			.select()
			.from(modelProviderMapping)
			.where(eq(modelProviderMapping.id, relayMappingId));
		expect(relayMapping).toMatchObject({
			source: "admin",
			externalId: "gpt-5.5-relay",
		});

		// Admission gates hold: the new mapping stays unroutable until the
		// credential, fingerprint-bound test, price policy, and enablement all
		// exist.
		const draftSnapshot = await loadLatestSnapshot();
		const draftMapping = draftSnapshot.mappings.find(
			(item) => item.id === relayMappingId,
		);
		expect(draftMapping?.routable).toBe(false);
		expect(draftMapping?.reasons).toEqual(
			expect.arrayContaining([
				"provider_credential_unavailable",
				"mapping_test_required",
				"mapping_price_incomplete",
			]),
		);

		// Credential and passed mapping test, as the platform credential API
		// and the test console would record them.
		const [credential] = await db
			.insert(platformProviderCredential)
			.values({
				createdBy: "phase4-test",
				updatedBy: "phase4-test",
				provider: "acme-relay",
				name: "Relay production key",
				baseUrl: "https://relay.example.com/v1",
				priority: 100,
				status: "active",
				encryptedToken: "encrypted-token",
				encryptionIv: "iv",
				encryptionAuthTag: "auth-tag",
				encryptionKeyVersion: "v1",
				maskedToken: "sk-...cafe",
				tokenFingerprint: `phase4-${crypto.randomUUID()}`,
				validationStatus: "valid",
			})
			.returning();
		await db.insert(platformMappingTestRun).values({
			createdBy: "phase4-test",
			mappingId: relayMappingId,
			credentialId: credential!.id,
			status: "passed",
			testProfile: catalogMappingTestProfile({
				mappingId: relayMappingId,
				providerId: "acme-relay",
				region: null,
				externalId: "gpt-5.5-relay",
				contextSizeLimit: null,
				maxOutputLimit: null,
				disabledCapabilities: [],
				credentialId: credential!.id,
				credentialFingerprint: credential!.tokenFingerprint,
				baseUrl: credential!.baseUrl,
				credentialOptions: credential!.options,
			}),
		});

		const [providerPolicyRow] = await db
			.select()
			.from(platformProviderPolicy)
			.where(eq(platformProviderPolicy.providerId, "acme-relay"));
		const [mappingPolicyRow] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, relayMappingId));
		await applyOperations([
			{
				version: 1,
				type: "mapping.set_price_policy",
				mappingId: relayMappingId,
				expectedUpdatedAt: null,
				policy: {
					mode: "fixed",
					currency: "USD",
					allowNegativeMargin: false,
					fixedPrices: {
						version: 2,
						inputPerMillionTokens: "2",
						outputPerMillionTokens: "8",
						cacheReadPerMillionTokens: "0.25",
					},
				},
			},
			{
				version: 1,
				type: "mapping.set_policy",
				mappingId: relayMappingId,
				expectedUpdatedAt: mappingPolicyRow!.updatedAt.toISOString(),
				patch: { enabled: true },
			},
			{
				version: 1,
				type: "provider.set_policy",
				providerId: "acme-relay",
				expectedUpdatedAt: providerPolicyRow!.updatedAt.toISOString(),
				patch: { enabled: true, visible: true, lifecycle: "active" },
			},
			{
				version: 1,
				type: "model.set_policy",
				modelId: "gpt-5.5",
				expectedUpdatedAt: null,
				patch: { enabled: true, visible: true, lifecycle: "active" },
			},
		]);

		const snapshot = await loadLatestSnapshot();
		expect(snapshot.routableMappingIds).toContain(relayMappingId);
		expect(snapshot.availableModelIds).toContain("gpt-5.5");
		const effective = snapshot.mappings.find(
			(item) => item.id === relayMappingId,
		);
		expect(effective).toMatchObject({
			routable: true,
			platformCredentialId: credential!.id,
			pricingMode: "fixed",
		});
		expect(effective?.sourcePrices).toEqual({
			input: "1.5",
			output: "6",
			cacheRead: "0.2",
		});
		// The V2 fixed price policy bills cacheRead independently.
		expect(effective?.customerPrices).toEqual({
			input: "2",
			output: "8",
			cacheRead: "0.25",
		});

		// The chat read path resolves the relay mapping from the snapshot.
		const resolved = resolveModelFromCatalog("gpt-5.5", snapshot);
		const relayServing = resolved?.providers.find(
			(item) => (item.providerId as string) === "acme-relay",
		);
		expect(relayServing).toBeDefined();
		expect(relayServing).toMatchObject({
			externalId: "gpt-5.5-relay",
			contextSize: 200000,
			maxOutput: 32768,
			vision: true,
			tools: true,
		});
		expect(Number(relayServing!.inputPrice)).toBe(1.5e-6);
		expect(Number(relayServing!.outputPrice)).toBe(6e-6);
	});

	it("rejects duplicate (provider, region) mapping creation at the store", async () => {
		await syncProvidersAndModels();
		const [existing] = await db
			.select()
			.from(modelProviderMapping)
			.where(
				and(
					eq(modelProviderMapping.modelId, "gpt-4o"),
					eq(modelProviderMapping.providerId, "openai"),
				),
			)
			.limit(1);
		expect(existing).toBeDefined();

		await expect(
			applyOperations([
				{
					version: 1,
					type: "mapping.create",
					expectedUpdatedAt: null,
					create: {
						modelId: "gpt-4o",
						providerId: "openai",
						externalId: "gpt-4o-duplicate",
						region: existing!.region,
						inputPrice: "1e-6",
						outputPrice: "2e-6",
					},
				},
			]),
		).rejects.toThrow(/duplicate_provider_region_mapping/);
	});

	it("applies and clears a source override on a static mapping", async () => {
		await syncProvidersAndModels();
		const [staticMapping] = await db
			.select()
			.from(modelProviderMapping)
			.where(
				and(
					eq(modelProviderMapping.modelId, "gpt-4o"),
					eq(modelProviderMapping.providerId, "openai"),
				),
			)
			.limit(1);
		expect(staticMapping).toBeDefined();
		const basePrice = staticMapping!.inputPrice;
		expect(basePrice).not.toBeNull();

		await applyOperations([
			{
				version: 1,
				type: "mapping.set_source_override",
				mappingId: staticMapping!.id,
				expectedUpdatedAt: null,
				patch: { inputPrice: "2e-6" },
			},
		]);

		const overridden = await loadLatestSnapshot();
		expect(
			overridden.mappings.find((item) => item.id === staticMapping!.id)
				?.sourcePrices.input,
		).toBe("2");

		// The override records the mirrored base value at set-time, feeding the
		// Phase 5 upstream-change review.
		const [policyRow] = await db
			.select()
			.from(platformMappingPolicy)
			.where(eq(platformMappingPolicy.mappingId, staticMapping!.id));
		expect(policyRow?.sourceOverrides?.fields.inputPrice).toMatchObject({
			value: "2e-6",
			baseValue: basePrice,
			setBy: "phase4-test",
		});

		// Clearing instantly reverts to the mirrored upstream value.
		await applyOperations([
			{
				version: 1,
				type: "mapping.clear_source_override",
				mappingId: staticMapping!.id,
				expectedUpdatedAt: policyRow!.updatedAt.toISOString(),
			},
		]);
		const reverted = await loadLatestSnapshot();
		const revertedInput = reverted.mappings.find(
			(item) => item.id === staticMapping!.id,
		)?.sourcePrices.input;
		expect(Number(revertedInput)).toBe(Number(basePrice) * 1_000_000);
	});
});
