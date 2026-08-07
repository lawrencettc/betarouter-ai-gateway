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

// Realtime-slice exit gate, in two halves. A realtime (speech-to-speech)
// mapping activates only through the minimal-realtime WebSocket probe — its
// text+audio output would otherwise derive minimal-chat, a probe that can
// never pass against a WebSocket-only deployment. A realtime-transcription
// (ASR) mapping is exempt from the test gate entirely: it has no standalone
// deployment or credential of its own (it runs inside a host realtime
// session), so pricing and enablement alone activate it.
const REALTIME_MODEL_ID = "gpt-realtime-2.1";
const ASR_MODEL_ID = "gpt-4o-mini-transcribe";
const CANARY_PROVIDER_ID = "openai";
const ACTOR = "realtime-slice";

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
			title: "Realtime slice activation test",
			reason: "Activate realtime mappings through the admission gates",
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

async function loadMapping(modelId: string) {
	const [mappingRow] = await db
		.select()
		.from(modelProviderMapping)
		.where(
			and(
				eq(modelProviderMapping.modelId, modelId),
				eq(modelProviderMapping.providerId, CANARY_PROVIDER_ID),
			),
		)
		.limit(1);
	expect(mappingRow).toBeDefined();
	return mappingRow!;
}

async function insertCredential() {
	const [credential] = await db
		.insert(platformProviderCredential)
		.values({
			createdBy: ACTOR,
			updatedBy: ACTOR,
			provider: CANARY_PROVIDER_ID,
			name: "Realtime probe key",
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
	return credential!;
}

function activationOperations(input: {
	mappingId: string;
	modelId: string;
	providerPolicyUpdatedAt: string | null;
	modelPolicyUpdatedAt: string | null;
}): CatalogOperationV1[] {
	return [
		{
			version: 1,
			type: "mapping.set_price_policy",
			mappingId: input.mappingId,
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
			mappingId: input.mappingId,
			expectedUpdatedAt: null,
			patch: { enabled: true },
		},
		{
			version: 1,
			type: "provider.set_policy",
			providerId: CANARY_PROVIDER_ID,
			expectedUpdatedAt: input.providerPolicyUpdatedAt,
			patch: { enabled: true, visible: true, lifecycle: "active" },
		},
		{
			version: 1,
			type: "model.set_policy",
			modelId: input.modelId,
			expectedUpdatedAt: input.modelPolicyUpdatedAt,
			patch: { enabled: true, visible: true, lifecycle: "active" },
		},
	];
}

async function policyTimestamps(modelId: string) {
	const [modelPolicyRow] = await db
		.select()
		.from(platformModelPolicy)
		.where(eq(platformModelPolicy.modelId, modelId));
	const [providerPolicyRow] = await db
		.select()
		.from(platformProviderPolicy)
		.where(eq(platformProviderPolicy.providerId, CANARY_PROVIDER_ID));
	return {
		providerPolicyUpdatedAt: providerPolicyRow?.updatedAt.toISOString() ?? null,
		modelPolicyUpdatedAt: modelPolicyRow?.updatedAt.toISOString() ?? null,
	};
}

describe("catalog realtime activation", () => {
	beforeEach(async () => {
		resetCatalogRevisionSnapshotCache();
		await cleanTables();
	});
	afterEach(cleanTables);

	it("activates a realtime mapping only through the minimal-realtime probe", async () => {
		await syncProvidersAndModels();

		const mappingRow = await loadMapping(REALTIME_MODEL_ID);
		expect(mappingRow.realtime).toBe(true);
		const mappingId = mappingRow.id;

		const draft = await loadLatestRevision();
		const draftMapping = draft.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		expect(draftMapping?.routable).toBe(false);
		expect(draftMapping?.reasons).toContain("mapping_test_required");

		const credential = await insertCredential();
		const profileTarget = {
			mappingId,
			providerId: CANARY_PROVIDER_ID,
			region: mappingRow.region,
			externalId: mappingRow.externalId,
			contextSizeLimit: null,
			maxOutputLimit: null,
			disabledCapabilities: [],
			credentialId: credential.id,
			credentialFingerprint: credential.tokenFingerprint,
			baseUrl: credential.baseUrl,
			credentialOptions: credential.options,
		};

		// A passed CHAT probe must not satisfy the test gate: realtime
		// deployments never answer HTTP chat completions, so the expected
		// profile derives from the mapping's realtime flag instead.
		await db.insert(platformMappingTestRun).values({
			createdBy: ACTOR,
			mappingId,
			credentialId: credential.id,
			status: "passed",
			testProfile: catalogMappingTestProfile(profileTarget),
		});

		const operations = activationOperations({
			mappingId,
			modelId: REALTIME_MODEL_ID,
			...(await policyTimestamps(REALTIME_MODEL_ID)),
		});
		await expect(applyOperations(operations)).rejects.toThrow(
			/mapping_test_required/,
		);

		// The minimal-realtime probe with the same fingerprint-bound target is
		// what unlocks activation and routing.
		await db.insert(platformMappingTestRun).values({
			createdBy: ACTOR,
			mappingId,
			credentialId: credential.id,
			status: "passed",
			testProfile: catalogMappingTestProfile({
				...profileTarget,
				profile: "minimal-realtime",
			}),
		});
		await applyOperations(operations);

		const applied = await loadLatestRevision();
		expect(applied.snapshot.routableMappingIds).toContain(mappingId);
		expect(applied.snapshot.availableModelIds).toContain(REALTIME_MODEL_ID);
		const effective = applied.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		expect(effective).toMatchObject({
			routable: true,
			platformCredentialId: credential.id,
			pricingMode: "source_cost",
		});
		// Realtime billing reads per-modality token prices off the resolved
		// catalog mapping, so the audio rates must survive mirroring and the
		// price policy alongside the text rates (per-million units).
		expect(effective?.sourcePrices.input).toBe("4");
		expect(effective?.customerPrices.input).toBe("4");
		expect(effective?.customerPrices.output).toBe("24");
		expect(effective?.customerPrices.audioInput).toBe("32");
		expect(effective?.customerPrices.audioOutput).toBe("64");

		const decision = evaluateCatalogRequest(applied.snapshot, {
			modelId: REALTIME_MODEL_ID,
		});
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.mappingIds).toContain(mappingId);
		}
	});

	it("activates a realtime-transcription mapping without any probe run", async () => {
		await syncProvidersAndModels();

		const mappingRow = await loadMapping(ASR_MODEL_ID);
		expect(mappingRow.realtimeTranscription).toBe(true);
		expect(mappingRow.realtime).toBe(false);
		const mappingId = mappingRow.id;

		// The test gate is waived from the first revision: no probe exists for
		// a deployment-less mapping, so mapping_test_required never appears.
		const draft = await loadLatestRevision();
		const draftMapping = draft.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		expect(draftMapping?.routable).toBe(false);
		expect(draftMapping?.reasons).not.toContain("mapping_test_required");

		// A credential still has to exist for the provider (host realtime
		// sessions authenticate with it), but no test run binds it here.
		await insertCredential();

		await applyOperations(
			activationOperations({
				mappingId,
				modelId: ASR_MODEL_ID,
				...(await policyTimestamps(ASR_MODEL_ID)),
			}),
		);

		const applied = await loadLatestRevision();
		expect(applied.snapshot.routableMappingIds).toContain(mappingId);
		const effective = applied.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		// Exempt mappings bind no credential of their own: the ASR model rides
		// the host session's connection.
		expect(effective).toMatchObject({
			routable: true,
			platformCredentialId: null,
			pricingMode: "source_cost",
		});
		expect(effective?.customerPrices.input).toBe("1.25");
		expect(effective?.customerPrices.audioInput).toBe("3");

		const decision = evaluateCatalogRequest(applied.snapshot, {
			modelId: ASR_MODEL_ID,
		});
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.mappingIds).toContain(mappingId);
		}
	});
});
