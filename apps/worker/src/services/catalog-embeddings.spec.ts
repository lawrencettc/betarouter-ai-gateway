import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	applyStoredCatalogChangeSet,
	catalogMappingTestProfile,
	evaluateCatalogRequest,
	parseStoredCatalogSnapshot,
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

import { syncProvidersAndModels } from "./sync-models.js";

import type { CatalogOperationV1 } from "@betarouter/catalog";
import type { PlatformCatalogOperationV1 } from "@betarouter/db";

// Phase 7 embeddings-slice exit gate: an operator activates a static
// embeddings mapping through the admission gates — credential, a passed
// minimal-embeddings probe (a chat probe must NOT satisfy it), a price
// policy, and enablement — and the catalog request policy then serves it.
const CANARY_MODEL_ID = "text-embedding-3-small";
const ACTOR = "phase7-embeddings";

async function applyOperations(operations: CatalogOperationV1[]) {
	const [latest] = await db
		.select({ id: platformCatalogRevision.id })
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	const [changeSet] = await db
		.insert(platformCatalogChangeSet)
		.values({
			createdBy: ACTOR,
			title: "Phase 7 embeddings activation test",
			reason: "Activate an embeddings mapping through the admission gates",
			state: "draft",
			baseRevision: latest?.id ?? null,
			operations: operations as unknown as PlatformCatalogOperationV1[],
			idempotencyKey: `${ACTOR}-${crypto.randomUUID()}`,
		})
		.returning({ id: platformCatalogChangeSet.id });
	return await applyStoredCatalogChangeSet({
		changeSetId: changeSet!.id,
		actorId: ACTOR,
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

async function cleanTables() {
	// Credentials and test runs have no FK to the source tables, so fixture
	// rows must be removed explicitly or they leak across suite runs.
	await db
		.delete(platformProviderCredential)
		.where(eq(platformProviderCredential.createdBy, ACTOR));
	await db
		.delete(platformMappingTestRun)
		.where(eq(platformMappingTestRun.createdBy, ACTOR));
	await db.delete(platformMappingPolicy);
	await db.delete(platformModelPolicy);
	await db.delete(platformProviderPolicy);
	await db.delete(modelProviderMapping);
	await db.delete(model);
	await db.delete(provider);
}

describe("catalog embeddings activation", () => {
	beforeEach(cleanTables);
	afterEach(cleanTables);

	it("activates an embeddings mapping only through the minimal-embeddings probe", async () => {
		await syncProvidersAndModels();

		const [mappingRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(
				and(
					eq(modelProviderMapping.modelId, CANARY_MODEL_ID),
					eq(modelProviderMapping.providerId, "openai"),
				),
			)
			.limit(1);
		expect(mappingRow).toBeDefined();
		const mappingId = mappingRow!.id;

		const draft = await loadLatestSnapshot();
		const draftMapping = draft.mappings.find((item) => item.id === mappingId);
		expect(draftMapping?.routable).toBe(false);
		expect(draftMapping?.reasons).toContain("mapping_test_required");

		const [credential] = await db
			.insert(platformProviderCredential)
			.values({
				createdBy: ACTOR,
				updatedBy: ACTOR,
				provider: "openai",
				name: "Embeddings probe key",
				priority: 100,
				status: "active",
				encryptedToken: "encrypted-token",
				encryptionIv: "iv",
				encryptionAuthTag: "auth-tag",
				encryptionKeyVersion: "v1",
				maskedToken: "sk-...feed",
				tokenFingerprint: `${ACTOR}-${crypto.randomUUID()}`,
				validationStatus: "valid",
			})
			.returning();

		const profileTarget = {
			mappingId,
			providerId: "openai",
			region: mappingRow!.region,
			externalId: mappingRow!.externalId,
			contextSizeLimit: null,
			maxOutputLimit: null,
			disabledCapabilities: [],
			credentialId: credential!.id,
			credentialFingerprint: credential!.tokenFingerprint,
			baseUrl: credential!.baseUrl,
			credentialOptions: credential!.options,
		};

		// A passed CHAT probe on the embeddings mapping must not satisfy the
		// test gate: the expected profile derives from the model's modality.
		await db.insert(platformMappingTestRun).values({
			createdBy: ACTOR,
			mappingId,
			credentialId: credential!.id,
			status: "passed",
			testProfile: catalogMappingTestProfile(profileTarget),
		});

		const [modelPolicyRow] = await db
			.select()
			.from(platformModelPolicy)
			.where(eq(platformModelPolicy.modelId, CANARY_MODEL_ID));
		const [providerPolicyRow] = await db
			.select()
			.from(platformProviderPolicy)
			.where(eq(platformProviderPolicy.providerId, "openai"));
		const activationOperations: CatalogOperationV1[] = [
			{
				version: 1,
				type: "mapping.set_price_policy",
				mappingId,
				expectedUpdatedAt: null,
				policy: {
					mode: "source_cost",
					currency: "USD",
					allowNegativeMargin: false,
				},
			},
			{
				version: 1,
				type: "mapping.set_policy",
				mappingId,
				expectedUpdatedAt: null,
				patch: { enabled: true },
			},
			{
				version: 1,
				type: "provider.set_policy",
				providerId: "openai",
				expectedUpdatedAt: providerPolicyRow?.updatedAt.toISOString() ?? null,
				patch: { enabled: true, visible: true, lifecycle: "active" },
			},
			{
				version: 1,
				type: "model.set_policy",
				modelId: CANARY_MODEL_ID,
				expectedUpdatedAt: modelPolicyRow?.updatedAt.toISOString() ?? null,
				patch: { enabled: true, visible: true, lifecycle: "active" },
			},
		];

		// Activation is blocked while only the chat probe has passed.
		await expect(applyOperations(activationOperations)).rejects.toThrow(
			/mapping_test_required/,
		);

		// The minimal-embeddings probe with the same fingerprint-bound target
		// is what unlocks activation and routing.
		await db.insert(platformMappingTestRun).values({
			createdBy: ACTOR,
			mappingId,
			credentialId: credential!.id,
			status: "passed",
			testProfile: catalogMappingTestProfile({
				...profileTarget,
				profile: "minimal-embeddings",
			}),
		});
		await applyOperations(activationOperations);

		const snapshot = await loadLatestSnapshot();
		expect(snapshot.routableMappingIds).toContain(mappingId);
		expect(snapshot.availableModelIds).toContain(CANARY_MODEL_ID);
		const effective = snapshot.mappings.find((item) => item.id === mappingId);
		expect(effective).toMatchObject({
			routable: true,
			platformCredentialId: credential!.id,
			pricingMode: "source_cost",
		});
		// Embeddings pricing units flow through the price policy: per-token
		// 0.02e-6 mirrors as USD 0.02 per million, and the flat request price
		// stays flat.
		expect(effective?.sourcePrices.input).toBe("0.02");
		expect(effective?.customerPrices.input).toBe("0.02");
		expect(effective?.customerPrices.request).toBe("0");

		const decision = evaluateCatalogRequest(snapshot, {
			modelId: CANARY_MODEL_ID,
		});
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.mappingIds).toContain(mappingId);
		}
	});
});
