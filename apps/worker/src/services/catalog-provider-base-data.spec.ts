import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	applyStoredCatalogChangeSet,
	catalogSnapshotHasProviderBaseData,
	parseStoredCatalogSnapshot,
	refreshCatalogRevisionFromSource,
	resolveProviderFromCatalog,
} from "@betarouter/catalog";
import {
	db,
	desc,
	eq,
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformMappingPolicy,
	platformModelPolicy,
	platformProviderPolicy,
	provider,
} from "@betarouter/db";

import type { CatalogOperationV1 } from "@betarouter/catalog";
import type { PlatformCatalogOperationV1 } from "@betarouter/db";
import type { ProviderDefinition } from "@betarouter/models";

async function applyOperations(operations: CatalogOperationV1[]) {
	const [latest] = await db
		.select({ id: platformCatalogRevision.id })
		.from(platformCatalogRevision)
		.orderBy(desc(platformCatalogRevision.id))
		.limit(1);
	const [changeSet] = await db
		.insert(platformCatalogChangeSet)
		.values({
			createdBy: "provider-base-data-test",
			title: "Provider base-data snapshot test",
			reason: "Exercise provider base data end to end",
			state: "draft",
			baseRevision: latest?.id ?? null,
			operations: operations as unknown as PlatformCatalogOperationV1[],
			idempotencyKey: `provider-base-${crypto.randomUUID()}`,
		})
		.returning({ id: platformCatalogChangeSet.id });
	return await applyStoredCatalogChangeSet({
		changeSetId: changeSet!.id,
		actorId: "provider-base-data-test",
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
	await db.delete(platformMappingPolicy);
	await db.delete(platformModelPolicy);
	await db.delete(platformProviderPolicy);
	await db.delete(modelProviderMapping);
	await db.delete(model);
	await db.delete(provider);
}

describe("catalog provider base-data snapshot gap", () => {
	beforeEach(cleanTables);
	afterEach(cleanTables);

	// Exit gate: an admin-created provider has no static definition to graft
	// from, so the snapshot alone must supply its serving knobs — create
	// through change-set ops, publish, parse the stored revision, and
	// reconstruct a definition carrying protocol, priority, and temperature.
	it("serves an admin-created provider from the snapshot alone", async () => {
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		await applyOperations([
			{
				version: 1,
				type: "provider.create",
				expectedUpdatedAt: null,
				create: {
					providerId: "base-relay",
					name: "Base Relay",
					description: "Anthropic-compatible relay",
					protocol: "anthropic-messages",
					streaming: true,
					cancellation: true,
					priority: 0.8,
					contentFilter: true,
					maxTemperature: 1,
					website: "https://relay.example.com",
				},
			},
		]);

		const [providerRow] = await db
			.select()
			.from(provider)
			.where(eq(provider.id, "base-relay"));
		expect(providerRow).toMatchObject({
			source: "admin",
			protocol: "anthropic-messages",
			priority: 0.8,
			contentFilter: true,
			maxTemperature: 1,
		});

		// The provisional snapshot was resolved from in-memory synthesized rows;
		// a source-driven refresh finding the same checksum proves persistence
		// wrote exactly those values (provider base data included).
		expect(
			await refreshCatalogRevisionFromSource({ deferInvalidation: true }),
		).toBeNull();

		const snapshot = await loadLatestSnapshot();
		expect(catalogSnapshotHasProviderBaseData(snapshot)).toBe(true);
		expect(
			snapshot.providers.find((item) => item.id === "base-relay"),
		).toMatchObject({
			name: "Base Relay",
			protocol: "anthropic-messages",
			streaming: true,
			cancellation: true,
			priority: 0.8,
			contentFilter: true,
			maxTemperature: 1,
			website: "https://relay.example.com",
		});

		const resolved = resolveProviderFromCatalog("base-relay", snapshot, {
			staticProviders: [],
		});
		expect(resolved).toMatchObject({
			id: "base-relay",
			name: "Base Relay",
			protocol: "anthropic-messages",
			streaming: true,
			cancellation: true,
			priority: 0.8,
			contentFilter: true,
			maxTemperature: 1,
			website: "https://relay.example.com",
		});
		expect(resolved?.env).toEqual({ required: {} });
	});

	// Exit gate: overrides on a static provider's base fields compose into the
	// snapshot (mirror → override), and a NULL mirror column is authoritative
	// not-set — reconstruction must not resurrect the grafted static value.
	it("applies provider source overrides through the snapshot", async () => {
		await db.insert(provider).values({
			id: "static-base-prov",
			name: "Static Base Provider",
			description: "Mirrored code provider",
			protocol: "openai-chat",
			priority: 1,
			contentFilter: false,
			// Mirror deliberately NULL while the injected code definition below
			// carries 2: the snapshot's null must win over the graft.
			maxTemperature: null,
			source: "static",
			status: "active",
		});
		await refreshCatalogRevisionFromSource({ deferInvalidation: true });
		await applyOperations([
			{
				version: 1,
				type: "provider.set_source_override",
				providerId: "static-base-prov",
				expectedUpdatedAt: null,
				patch: {
					priority: 0.3,
					announcement: "Operator notice",
				},
			},
		]);

		const snapshot = await loadLatestSnapshot();
		const effective = snapshot.providers.find(
			(item) => item.id === "static-base-prov",
		);
		expect(effective).toMatchObject({
			priority: 0.3,
			maxTemperature: null,
			announcement: "Operator notice",
			// Un-overridden mirror fields keep their source values.
			protocol: "openai-chat",
			contentFilter: false,
		});

		const staticDef: ProviderDefinition = {
			id: "static-base-prov",
			name: "Static Base Provider",
			description: "Mirrored code provider",
			protocol: "openai-chat",
			env: { required: { apiKey: "LLM_STATIC_BASE_API_KEY" } },
			priority: 1,
			contentFilter: false,
			maxTemperature: 2,
		};
		const resolved = resolveProviderFromCatalog("static-base-prov", snapshot, {
			staticProviders: [staticDef],
		});
		expect(resolved?.priority).toBe(0.3);
		expect(resolved?.announcement).toBe("Operator notice");
		// The mirror's NULL is authoritative — the grafted 2 must not resurface.
		expect(resolved?.maxTemperature).toBeUndefined();
		// Env still grafts from code.
		expect(resolved?.env).toEqual(staticDef.env);

		// Clearing the override (null patch value) reverts to the mirror value.
		const [policyRow] = await db
			.select()
			.from(platformProviderPolicy)
			.where(eq(platformProviderPolicy.providerId, "static-base-prov"));
		await applyOperations([
			{
				version: 1,
				type: "provider.set_source_override",
				providerId: "static-base-prov",
				expectedUpdatedAt: policyRow!.updatedAt.toISOString(),
				patch: { priority: null },
			},
		]);
		const cleared = await loadLatestSnapshot();
		expect(
			cleared.providers.find((item) => item.id === "static-base-prov")
				?.priority,
		).toBe(1);
	});
});
