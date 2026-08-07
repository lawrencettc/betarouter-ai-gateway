import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	applyStoredCatalogChangeSet,
	catalogMappingTestProfile,
	evaluateCatalogRequest,
	parseStoredCatalogSnapshot,
	resetCatalogRevisionSnapshotCache,
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

// OCR-slice exit gate: an operator activates a static OCR mapping through
// the admission gates — credential, a passed minimal-ocr probe (a chat
// probe must NOT satisfy it), a price policy, and enablement — and the
// catalog request policy then serves it with the per-page customer prices
// the OCR surface replays synchronously at request time.
const CANARY_MODEL_ID = "mistral-ocr-latest";
const CANARY_PROVIDER_ID = "mistral";
const ACTOR = "ocr-slice";

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
			title: "OCR slice activation test",
			reason: "Activate an OCR mapping through the admission gates",
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

async function loadLatestRevision() {
	const [revision] = await db
		.select({
			id: platformCatalogRevision.id,
			checksum: platformCatalogRevision.checksum,
			snapshot: platformCatalogRevision.snapshot,
		})
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	expect(revision).toBeDefined();
	return {
		id: revision!.id,
		snapshot: parseStoredCatalogSnapshot(
			revision!.snapshot,
			revision!.checksum,
		),
	};
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

describe("catalog ocr activation", () => {
	beforeEach(async () => {
		resetCatalogRevisionSnapshotCache();
		await cleanTables();
	});
	afterEach(cleanTables);

	it("activates an OCR mapping only through the minimal-ocr probe and serves its prices", async () => {
		await syncProvidersAndModels();

		const [modelRow] = await db
			.select({ output: model.output })
			.from(model)
			.where(eq(model.id, CANARY_MODEL_ID))
			.limit(1);
		expect(modelRow?.output).toEqual(["ocr"]);

		const [mappingRow] = await db
			.select()
			.from(modelProviderMapping)
			.where(
				and(
					eq(modelProviderMapping.modelId, CANARY_MODEL_ID),
					eq(modelProviderMapping.providerId, CANARY_PROVIDER_ID),
				),
			)
			.limit(1);
		expect(mappingRow).toBeDefined();
		const mappingId = mappingRow!.id;
		// The page price rides the mirror so admission pricing works for
		// admin-edited and admin-created mappings alike.
		expect(Number(mappingRow!.ocrPagePrice)).toBeCloseTo(0.004);

		const draft = await loadLatestRevision();
		const draftMapping = draft.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		expect(draftMapping?.routable).toBe(false);
		expect(draftMapping?.reasons).toContain("mapping_test_required");

		const [credential] = await db
			.insert(platformProviderCredential)
			.values({
				createdBy: ACTOR,
				updatedBy: ACTOR,
				provider: CANARY_PROVIDER_ID,
				name: "OCR probe key",
				priority: 100,
				status: "active",
				encryptedToken: "encrypted-token",
				encryptionIv: "iv",
				encryptionAuthTag: "auth-tag",
				encryptionKeyVersion: "v1",
				maskedToken: "mi-...feed",
				tokenFingerprint: `${ACTOR}-${crypto.randomUUID()}`,
				validationStatus: "valid",
			})
			.returning();

		const profileTarget = {
			mappingId,
			providerId: CANARY_PROVIDER_ID,
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

		// A passed CHAT probe on the OCR mapping must not satisfy the test
		// gate: the expected profile derives from the model's modality.
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
			.where(eq(platformProviderPolicy.providerId, CANARY_PROVIDER_ID));
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
				providerId: CANARY_PROVIDER_ID,
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

		// The minimal-ocr probe with the same fingerprint-bound target is what
		// unlocks activation and routing.
		await db.insert(platformMappingTestRun).values({
			createdBy: ACTOR,
			mappingId,
			credentialId: credential!.id,
			status: "passed",
			testProfile: catalogMappingTestProfile({
				...profileTarget,
				profile: "minimal-ocr",
			}),
		});
		await applyOperations(activationOperations);

		const applied = await loadLatestRevision();
		expect(applied.snapshot.routableMappingIds).toContain(mappingId);
		expect(applied.snapshot.availableModelIds).toContain(CANARY_MODEL_ID);
		const effective = applied.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		expect(effective).toMatchObject({
			routable: true,
			platformCredentialId: credential!.id,
			pricingMode: "source_cost",
		});
		// Page billing flows through the price policy as the flat USD-per-page
		// ocrPage unit (never a per-million unit): the static $0.004/page
		// mapping surfaces unchanged, and the OCR surface multiplies it by the
		// upstream's reported pages_processed at request time.
		expect(Number(effective?.sourcePrices.ocrPage)).toBeCloseTo(0.004);
		expect(Number(effective?.customerPrices.ocrPage)).toBeCloseTo(0.004);
		expect(effective?.customerPrices.request).toBe("0");

		const decision = evaluateCatalogRequest(applied.snapshot, {
			modelId: CANARY_MODEL_ID,
		});
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.mappingIds).toContain(mappingId);
		}
	});
});
