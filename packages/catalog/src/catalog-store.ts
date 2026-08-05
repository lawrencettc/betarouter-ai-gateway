import { redisClient } from "@betarouter/cache";
import { db } from "@betarouter/db/db";
import { and, desc, eq, inArray, lte, sql } from "@betarouter/db/orm";
import {
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformMappingPolicy,
	platformMappingPricePolicy,
	platformMappingTestRun,
	platformModelPolicy,
	platformProviderCredential,
	platformProviderPolicy,
	provider,
} from "@betarouter/db/schema";
import { getProviderEnvConfig, getProviderEnvVar } from "@betarouter/models";

import { validateCatalogActivation } from "./activation.js";
import { resolveEffectiveCatalog } from "./catalog.js";
import { applyCatalogOperations } from "./change-set.js";
import {
	catalogChangeSetInputSchema,
	mappingPolicyPatchSchema,
	mappingPricePolicySchema,
} from "./contracts.js";
import {
	fixedPricesV1ToPriceMap,
	resolveMappingPrice,
	sourceMappingPricesToPriceMap,
} from "./pricing.js";
import {
	catalogCredentialConfigurationProfile,
	catalogMappingTestProfile,
} from "./test-target.js";

import type {
	CatalogLifecycle,
	CatalogResolverInput,
	EffectiveCatalog,
} from "./catalog.js";
import type { CatalogPolicyState } from "./change-set.js";
import type { CatalogOperationV1 } from "./contracts.js";
import type { PlatformCatalogOperationV1 } from "@betarouter/db/schema";
import type { Provider } from "@betarouter/models";

const CATALOG_INVALIDATION_CHANNEL = "platform-catalog:invalidate";

export type CatalogTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

function environmentCredentialAvailable(providerId: string): boolean {
	const envVar = getProviderEnvVar(providerId as Provider);
	if (!envVar || !process.env[envVar]?.trim()) {
		return false;
	}
	const required = getProviderEnvConfig(providerId as Provider)?.required;
	return Object.entries(required ?? {}).every(
		([key, variable]) =>
			key === "apiKey" || !variable || Boolean(process.env[variable]?.trim()),
	);
}

async function loadStoreView(tx: CatalogTransaction) {
	const [
		providers,
		models,
		mappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentials,
		tests,
	] = await Promise.all([
		tx.select().from(provider),
		tx.select().from(model),
		tx.select().from(modelProviderMapping),
		tx.select().from(platformProviderPolicy),
		tx.select().from(platformModelPolicy),
		tx.select().from(platformMappingPolicy),
		tx.select().from(platformMappingPricePolicy),
		tx
			.select({
				id: platformProviderCredential.id,
				provider: platformProviderCredential.provider,
				tokenFingerprint: platformProviderCredential.tokenFingerprint,
				baseUrl: platformProviderCredential.baseUrl,
				options: platformProviderCredential.options,
				priority: platformProviderCredential.priority,
			})
			.from(platformProviderCredential)
			.where(
				and(
					eq(platformProviderCredential.status, "active"),
					eq(platformProviderCredential.validationStatus, "valid"),
				),
			),
		tx
			.select({
				mappingId: platformMappingTestRun.mappingId,
				testProfile: platformMappingTestRun.testProfile,
			})
			.from(platformMappingTestRun)
			.where(eq(platformMappingTestRun.status, "passed")),
	]);
	return {
		providers,
		models,
		mappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentials,
		credentialProviderIds: new Set(credentials.map((item) => item.provider)),
		passedTests: new Set(
			tests.map((item) => `${item.mappingId}:${item.testProfile}`),
		),
	};
}

type StoreView = Awaited<ReturnType<typeof loadStoreView>>;

function validateOperationEntities(
	view: StoreView,
	operations: CatalogOperationV1[],
): void {
	const providerIds = new Set(view.providers.map((item) => item.id));
	const modelIds = new Set(view.models.map((item) => item.id));
	const mappingIds = new Set(view.mappings.map((item) => item.id));
	const missing = operations.flatMap((operation) => {
		if (operation.type === "provider.set_policy") {
			return providerIds.has(operation.providerId)
				? []
				: [operation.providerId];
		}
		if (operation.type === "model.set_policy") {
			return modelIds.has(operation.modelId) ? [] : [operation.modelId];
		}
		if (operation.type === "entity.archive_policy") {
			const ids =
				operation.entityType === "provider"
					? providerIds
					: operation.entityType === "model"
						? modelIds
						: mappingIds;
			return ids.has(operation.entityId) ? [] : [operation.entityId];
		}
		return mappingIds.has(operation.mappingId) ? [] : [operation.mappingId];
	});
	if (missing.length > 0) {
		throw new Error(
			`Catalog source entities do not exist: ${[...new Set(missing)].join(", ")}`,
		);
	}
}

function policyState(view: StoreView): CatalogPolicyState {
	return {
		providers: Object.fromEntries(
			view.providerPolicies.map((row) => [
				row.providerId,
				{
					...row,
					lifecycle: row.lifecycle as CatalogLifecycle,
					deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
					retireAt: row.retireAt?.toISOString() ?? null,
					updatedAt: row.updatedAt.toISOString(),
				},
			]),
		),
		models: Object.fromEntries(
			view.modelPolicies.map((row) => [
				row.modelId,
				{
					...row,
					lifecycle: row.lifecycle as CatalogLifecycle,
					deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
					retireAt: row.retireAt?.toISOString() ?? null,
					updatedAt: row.updatedAt.toISOString(),
				},
			]),
		),
		mappings: Object.fromEntries(
			view.mappingPolicies.map((row) => [
				row.mappingId,
				{
					...row,
					disabledCapabilities:
						mappingPolicyPatchSchema.shape.disabledCapabilities.parse(
							row.disabledCapabilities,
						),
					updatedAt: row.updatedAt.toISOString(),
				},
			]),
		),
		prices: Object.fromEntries(
			view.pricePolicies.map((row) => [
				row.mappingId,
				{
					mappingId: row.mappingId,
					policy: mappingPricePolicySchema.parse({
						mode: row.mode,
						currency: row.currency,
						...(row.markupBps === null ? {} : { markupBps: row.markupBps }),
						...(row.fixedPrices === null
							? {}
							: { fixedPrices: row.fixedPrices }),
						allowNegativeMargin: row.allowNegativeMargin,
						...(row.negativeMarginReason
							? { negativeMarginReason: row.negativeMarginReason }
							: {}),
					}),
					updatedAt: row.updatedAt.toISOString(),
					updatedBy: row.updatedBy,
				},
			]),
		),
	};
}

function resolveStoreSnapshot(
	view: StoreView,
	state: CatalogPolicyState,
	revision: number,
): EffectiveCatalog {
	const credentialAvailability = Object.fromEntries(
		view.providers.map((item) => [
			item.id,
			view.credentialProviderIds.has(item.id) ||
				environmentCredentialAvailable(item.id),
		]),
	);
	const mappingReadiness: CatalogResolverInput["mappingReadiness"] = {};
	for (const mapping of view.mappings) {
		const pricePolicy = state.prices[mapping.id]?.policy;
		const sourcePrices = sourceMappingPricesToPriceMap(mapping);
		const prices = pricePolicy
			? resolveMappingPrice({
					sourcePrices,
					policy:
						pricePolicy.mode === "fixed"
							? {
									mode: "fixed",
									fixedPrices: fixedPricesV1ToPriceMap(pricePolicy.fixedPrices),
									allowNegativeMargin: pricePolicy.allowNegativeMargin,
									negativeMarginReason: pricePolicy.negativeMarginReason,
								}
							: pricePolicy.mode === "markup"
								? {
										mode: "markup",
										markupBps: pricePolicy.markupBps,
										allowNegativeMargin: pricePolicy.allowNegativeMargin,
										negativeMarginReason: pricePolicy.negativeMarginReason,
									}
								: { mode: "source_cost" },
				})
			: null;
		const mappingPolicy = state.mappings[mapping.id];
		const testedCredential = view.credentials
			.filter((credential) => credential.provider === mapping.providerId)
			.sort(
				(left, right) =>
					left.priority - right.priority || left.id.localeCompare(right.id),
			)
			.find((credential) => {
				const profile = catalogMappingTestProfile({
					mappingId: mapping.id,
					providerId: mapping.providerId,
					region: mapping.region,
					externalId: mappingPolicy?.externalIdOverride ?? mapping.externalId,
					contextSizeLimit: mappingPolicy?.contextSizeLimit,
					maxOutputLimit: mappingPolicy?.maxOutputLimit,
					disabledCapabilities: mappingPolicy?.disabledCapabilities,
					credentialId: credential.id,
					credentialFingerprint: credential.tokenFingerprint,
					baseUrl: credential.baseUrl,
					credentialOptions: credential.options,
				});
				return view.passedTests.has(`${mapping.id}:${profile}`);
			});
		mappingReadiness[mapping.id] = {
			priceReady: prices?.ready ?? false,
			testPassed: testedCredential !== undefined,
			platformCredentialId: testedCredential?.id ?? null,
			platformCredentialProfile: testedCredential
				? catalogCredentialConfigurationProfile({
						credentialId: testedCredential.id,
						credentialFingerprint: testedCredential.tokenFingerprint,
						baseUrl: testedCredential.baseUrl,
						credentialOptions: testedCredential.options,
					})
				: null,
			sourcePrices,
			customerPrices: prices?.customerPrices ?? {},
			margin: prices?.margin ?? {},
			pricingMode: pricePolicy?.mode ?? null,
			markupBps: pricePolicy?.mode === "markup" ? pricePolicy.markupBps : null,
		};
	}
	return resolveEffectiveCatalog({
		revision,
		now: new Date(),
		providers: view.providers.map((item) => ({
			id: item.id,
			status: item.status,
		})),
		models: view.models.map((item) => ({
			id: item.id,
			status: item.status,
			name: item.name,
			family: item.family,
			aliases: item.aliases,
			output: item.output,
			free: item.free,
		})),
		mappings: view.mappings.map((item) => ({
			id: item.id,
			providerId: item.providerId,
			modelId: item.modelId,
			status: item.status,
			externalId: item.externalId,
			region: item.region,
			deprecatedAt: item.deprecatedAt,
			deactivatedAt: item.deactivatedAt,
			contextSize: item.contextSize,
			maxOutput: item.maxOutput,
			streaming: item.streaming,
			vision: item.vision,
			reasoning: item.reasoning,
			reasoningMaxTokens: item.reasoningMaxTokens,
			tools: item.tools,
			jsonOutput: item.jsonOutput,
			jsonOutputSchema: item.jsonOutputSchema,
			webSearch: item.webSearch,
			supportedParameters: item.supportedParameters,
			pricingTiers: item.pricingTiers,
			serviceTierMultipliers: item.serviceTierMultipliers,
		})),
		providerPolicies: Object.values(state.providers).map((item) => ({
			providerId: item.providerId,
			visible: item.visible,
			enabled: item.enabled,
			lifecycle: item.lifecycle,
			deprecatedAt: item.deprecatedAt ? new Date(item.deprecatedAt) : null,
			retireAt: item.retireAt ? new Date(item.retireAt) : null,
		})),
		modelPolicies: Object.values(state.models).map((item) => ({
			modelId: item.modelId,
			visible: item.visible,
			enabled: item.enabled,
			allowDirect: item.allowDirect,
			lifecycle: item.lifecycle,
			deprecatedAt: item.deprecatedAt ? new Date(item.deprecatedAt) : null,
			retireAt: item.retireAt ? new Date(item.retireAt) : null,
			replacementModelId: item.replacementModelId,
			retirementMessage: item.retirementMessage,
		})),
		mappingPolicies: Object.values(state.mappings).map((item) => ({
			mappingId: item.mappingId,
			enabled: item.enabled,
			priority: item.priority ?? 100,
			weight: item.weight ?? 100,
			breakerEnabled: item.breakerEnabled ?? true,
			externalIdOverride: item.externalIdOverride,
			contextSizeLimit: item.contextSizeLimit,
			maxOutputLimit: item.maxOutputLimit,
			disabledCapabilities: item.disabledCapabilities,
		})),
		providerCredentialAvailability: credentialAvailability,
		mappingReadiness,
		breakerStates: {},
	});
}

async function persistState(
	tx: CatalogTransaction,
	state: CatalogPolicyState,
	operations: CatalogOperationV1[],
): Promise<void> {
	const providerIds = new Set<string>();
	const modelIds = new Set<string>();
	const mappingIds = new Set<string>();
	const priceIds = new Set<string>();
	for (const operation of operations) {
		if (operation.type === "provider.set_policy") {
			providerIds.add(operation.providerId);
		} else if (operation.type === "model.set_policy") {
			modelIds.add(operation.modelId);
		} else if (operation.type === "entity.archive_policy") {
			(operation.entityType === "provider"
				? providerIds
				: operation.entityType === "model"
					? modelIds
					: mappingIds
			).add(operation.entityId);
		} else if (
			operation.type === "mapping.set_price_policy" ||
			operation.type === "mapping.clear_price_policy"
		) {
			priceIds.add(operation.mappingId);
		} else {
			mappingIds.add(operation.mappingId);
		}
	}
	for (const id of providerIds) {
		const row = state.providers[id]!;
		const values = {
			...row,
			deprecatedAt: row.deprecatedAt ? new Date(row.deprecatedAt) : null,
			retireAt: row.retireAt ? new Date(row.retireAt) : null,
			updatedAt: new Date(row.updatedAt),
		};
		await tx.insert(platformProviderPolicy).values(values).onConflictDoUpdate({
			target: platformProviderPolicy.providerId,
			set: values,
		});
	}
	for (const id of modelIds) {
		const row = state.models[id]!;
		const values = {
			...row,
			deprecatedAt: row.deprecatedAt ? new Date(row.deprecatedAt) : null,
			retireAt: row.retireAt ? new Date(row.retireAt) : null,
			updatedAt: new Date(row.updatedAt),
		};
		await tx.insert(platformModelPolicy).values(values).onConflictDoUpdate({
			target: platformModelPolicy.modelId,
			set: values,
		});
	}
	for (const id of mappingIds) {
		const row = state.mappings[id]!;
		const values = { ...row, updatedAt: new Date(row.updatedAt) };
		await tx.insert(platformMappingPolicy).values(values).onConflictDoUpdate({
			target: platformMappingPolicy.mappingId,
			set: values,
		});
	}
	for (const id of priceIds) {
		const row = state.prices[id];
		if (!row) {
			await tx
				.delete(platformMappingPricePolicy)
				.where(eq(platformMappingPricePolicy.mappingId, id));
			continue;
		}
		const policy = row.policy;
		const values = {
			mappingId: id,
			currency: policy.currency,
			mode: policy.mode,
			markupBps: policy.mode === "markup" ? policy.markupBps : null,
			fixedPrices: policy.mode === "fixed" ? policy.fixedPrices : null,
			allowNegativeMargin: policy.allowNegativeMargin,
			negativeMarginReason: policy.negativeMarginReason ?? null,
			updatedAt: new Date(row.updatedAt),
			updatedBy: row.updatedBy,
		};
		await tx
			.insert(platformMappingPricePolicy)
			.values(values)
			.onConflictDoUpdate({
				target: platformMappingPricePolicy.mappingId,
				set: values,
			});
	}
}

export interface AppliedCatalogChangeSet {
	changeSetId: string;
	catalogRevision: number;
	affectedEntities: string[];
	cacheInvalidation: "published" | "failed";
	alreadyApplied?: boolean;
}

export interface CatalogRevisionCounts {
	providers: number;
	models: number;
	mappings: number;
}

export interface CatalogRevisionStatus {
	revision: number;
	publishedAt: string | null;
	publishedChecksum: string | null;
	currentChecksum: string;
	drifted: boolean;
	sourceAhead: boolean;
	sourceUpdatedAt: string | null;
	publishedCounts: CatalogRevisionCounts;
	currentCounts: CatalogRevisionCounts;
}

function storedSnapshotCount(
	snapshot: Record<string, unknown> | undefined,
	key: "providers" | "models" | "mappings",
): number {
	const items = snapshot?.[key];
	return Array.isArray(items) ? items.length : 0;
}

function latestSourceUpdate(view: StoreView): Date | null {
	const timestamps = [
		...view.providers.map((item) => item.updatedAt.getTime()),
		...view.models.map((item) => item.updatedAt.getTime()),
		...view.mappings.map((item) => item.updatedAt.getTime()),
	];
	return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}

export function compareCatalogRevision(
	latest: {
		id: number;
		createdAt: Date;
		checksum: string;
		snapshot: Record<string, unknown>;
	} | null,
	current: EffectiveCatalog,
	sourceUpdatedAt: Date | null,
): CatalogRevisionStatus {
	const publishedAt = latest?.createdAt ?? null;
	const drifted = latest?.checksum !== current.checksum;
	return {
		revision: latest?.id ?? 0,
		publishedAt: publishedAt?.toISOString() ?? null,
		publishedChecksum: latest?.checksum ?? null,
		currentChecksum: current.checksum,
		drifted,
		sourceAhead:
			drifted &&
			sourceUpdatedAt !== null &&
			(publishedAt === null || sourceUpdatedAt > publishedAt),
		sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
		publishedCounts: {
			providers: storedSnapshotCount(latest?.snapshot, "providers"),
			models: storedSnapshotCount(latest?.snapshot, "models"),
			mappings: storedSnapshotCount(latest?.snapshot, "mappings"),
		},
		currentCounts: {
			providers: current.providers.length,
			models: current.models.length,
			mappings: current.mappings.length,
		},
	};
}

export async function getCatalogRevisionStatus(
	input: { transaction?: CatalogTransaction } = {},
): Promise<CatalogRevisionStatus> {
	const inspect = async (tx: CatalogTransaction) => {
		const view = await loadStoreView(tx);
		const current = resolveStoreSnapshot(view, policyState(view), 0);
		const [latest] = await tx
			.select({
				id: platformCatalogRevision.id,
				createdAt: platformCatalogRevision.createdAt,
				checksum: platformCatalogRevision.checksum,
				snapshot: platformCatalogRevision.snapshot,
			})
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		return compareCatalogRevision(
			latest ?? null,
			current,
			latestSourceUpdate(view),
		);
	};
	return input.transaction
		? await inspect(input.transaction)
		: await db.transaction(inspect);
}

/**
 * Publish a new immutable revision when synchronized source metadata changes.
 * Operator policy rows are read, never rewritten, so upstream refreshes cannot
 * undo curation while every consumer still observes one revision/checksum pair.
 */
export async function refreshCatalogRevisionFromSource(
	input: {
		actorId?: string;
		now?: Date;
		transaction?: CatalogTransaction;
		deferInvalidation?: boolean;
	} = {},
): Promise<AppliedCatalogChangeSet | null> {
	const actorId = input.actorId ?? "system:source-sync";
	const now = input.now ?? new Date();
	const publishRevision = async (tx: CatalogTransaction, takeLock: boolean) => {
		if (takeLock) {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
		}
		const view = await loadStoreView(tx);
		const provisional = resolveStoreSnapshot(view, policyState(view), 0);
		const [latest] = await tx
			.select({
				id: platformCatalogRevision.id,
				checksum: platformCatalogRevision.checksum,
			})
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1);
		if (latest?.checksum === provisional.checksum) {
			return null;
		}
		const [changeSet] = await tx
			.insert(platformCatalogChangeSet)
			.values({
				createdBy: actorId,
				title: "Refresh synchronized source catalog",
				reason:
					"Source provider, model, mapping, capability, or price data changed",
				state: "applying",
				baseRevision: latest?.id ?? null,
				operations: [],
				idempotencyKey: `source-sync:${latest?.id ?? "initial"}:${provisional.checksum}`,
			})
			.returning({ id: platformCatalogChangeSet.id });
		if (!changeSet) {
			throw new Error("Source catalog change set was not created");
		}
		const [revision] = await tx
			.insert(platformCatalogRevision)
			.values({
				changeSetId: changeSet.id,
				appliedBy: actorId,
				checksum: provisional.checksum,
				snapshot: provisional as unknown as Record<string, unknown>,
			})
			.returning({ id: platformCatalogRevision.id });
		if (!revision) {
			throw new Error("Source catalog revision was not created");
		}
		const snapshot = { ...provisional, revision: revision.id };
		await tx
			.update(platformCatalogRevision)
			.set({ snapshot: snapshot as unknown as Record<string, unknown> })
			.where(eq(platformCatalogRevision.id, revision.id));
		await tx
			.update(platformCatalogChangeSet)
			.set({
				state: "applied",
				appliedAt: now,
				appliedRevision: revision.id,
				inverseOperations: [],
			})
			.where(eq(platformCatalogChangeSet.id, changeSet.id));
		return {
			changeSetId: changeSet.id,
			catalogRevision: revision.id,
			affectedEntities: [
				...snapshot.providers.map((item) => item.id),
				...snapshot.models.map((item) => item.id),
				...snapshot.mappings.map((item) => item.id),
			],
			cacheInvalidation: "published" as const,
		};
	};
	const result = input.transaction
		? await publishRevision(input.transaction, false)
		: await db.transaction(async (tx) => await publishRevision(tx, true));
	if (!result) {
		return null;
	}
	if (input.deferInvalidation) {
		return result;
	}
	return await publishCatalogRevisionInvalidation(result);
}

export async function publishCatalogRevisionInvalidation(
	result: AppliedCatalogChangeSet,
): Promise<AppliedCatalogChangeSet> {
	try {
		await redisClient.publish(
			CATALOG_INVALIDATION_CHANNEL,
			JSON.stringify({ revision: result.catalogRevision }),
		);
		return result;
	} catch {
		return { ...result, cacheInvalidation: "failed" };
	}
}

export async function applyStoredCatalogChangeSet(input: {
	changeSetId: string;
	actorId: string;
	now?: Date;
	markFailed?: boolean;
}): Promise<AppliedCatalogChangeSet> {
	const now = input.now ?? new Date();
	try {
		const result = await db.transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
			const [changeSet] = await tx
				.select()
				.from(platformCatalogChangeSet)
				.where(eq(platformCatalogChangeSet.id, input.changeSetId))
				.limit(1);
			if (!changeSet) {
				throw new Error("Catalog change set was not found");
			}
			if (changeSet.state === "applied" && changeSet.appliedRevision) {
				return {
					changeSetId: changeSet.id,
					catalogRevision: changeSet.appliedRevision,
					affectedEntities: [],
					cacheInvalidation: "published" as const,
					alreadyApplied: true,
				};
			}
			if (!new Set(["draft", "scheduled"]).has(changeSet.state)) {
				throw new Error("Catalog change set is not applyable");
			}
			if (changeSet.effectiveAt && changeSet.effectiveAt > now) {
				throw new Error("Scheduled catalog change set is not due");
			}
			const [latest] = await tx
				.select({ id: platformCatalogRevision.id })
				.from(platformCatalogRevision)
				.orderBy(desc(platformCatalogRevision.id))
				.limit(1);
			const currentRevision = latest?.id ?? null;
			if (changeSet.baseRevision !== currentRevision) {
				throw new Error("Catalog change set base revision is stale");
			}
			const operations = catalogChangeSetInputSchema.shape.operations.parse(
				changeSet.operations,
			);
			const view = await loadStoreView(tx);
			validateOperationEntities(view, operations);
			const applied = applyCatalogOperations({
				state: policyState(view),
				operations,
				actor: input.actorId,
				updatedAt: now.toISOString(),
			});
			const provisional = resolveStoreSnapshot(view, applied.state, 0);
			const previousSnapshot = resolveStoreSnapshot(
				view,
				policyState(view),
				currentRevision ?? 0,
			);
			validateCatalogActivation(
				provisional,
				applied.state,
				applied.affectedEntityIds,
				previousSnapshot,
			);
			await tx
				.update(platformCatalogChangeSet)
				.set({ state: "applying", errorCode: null })
				.where(eq(platformCatalogChangeSet.id, changeSet.id));
			await persistState(tx, applied.state, operations);
			const [revision] = await tx
				.insert(platformCatalogRevision)
				.values({
					changeSetId: changeSet.id,
					appliedBy: input.actorId,
					checksum: provisional.checksum,
					snapshot: provisional as unknown as Record<string, unknown>,
				})
				.returning({ id: platformCatalogRevision.id });
			if (!revision) {
				throw new Error("Catalog revision was not created");
			}
			const snapshot = { ...provisional, revision: revision.id };
			await tx
				.update(platformCatalogRevision)
				.set({ snapshot: snapshot as unknown as Record<string, unknown> })
				.where(eq(platformCatalogRevision.id, revision.id));
			await tx
				.update(platformCatalogChangeSet)
				.set({
					state: "applied",
					appliedAt: now,
					appliedRevision: revision.id,
					inverseOperations:
						applied.inverseOperations as PlatformCatalogOperationV1[],
				})
				.where(eq(platformCatalogChangeSet.id, changeSet.id));
			return {
				changeSetId: changeSet.id,
				catalogRevision: revision.id,
				affectedEntities: applied.affectedEntityIds,
				cacheInvalidation: "published" as const,
			};
		});
		if (result.alreadyApplied) {
			return result;
		}
		try {
			await redisClient.publish(
				CATALOG_INVALIDATION_CHANNEL,
				JSON.stringify({ revision: result.catalogRevision }),
			);
			return result;
		} catch {
			return { ...result, cacheInvalidation: "failed" };
		}
	} catch (error) {
		if (input.markFailed) {
			await db
				.update(platformCatalogChangeSet)
				.set({
					state: "failed",
					errorCode:
						error instanceof Error
							? error.message.slice(0, 255)
							: "apply_failed",
				})
				.where(
					and(
						eq(platformCatalogChangeSet.id, input.changeSetId),
						inArray(platformCatalogChangeSet.state, ["scheduled", "applying"]),
					),
				);
		}
		throw error;
	}
}

export async function applyDueCatalogChangeSets(
	input: {
		actorId?: string;
		now?: Date;
		limit?: number;
	} = {},
): Promise<Array<AppliedCatalogChangeSet & { error?: string }>> {
	const now = input.now ?? new Date();
	const due = await db
		.select({ id: platformCatalogChangeSet.id })
		.from(platformCatalogChangeSet)
		.where(
			and(
				eq(platformCatalogChangeSet.state, "scheduled"),
				lte(platformCatalogChangeSet.effectiveAt, now),
			),
		)
		.orderBy(platformCatalogChangeSet.effectiveAt)
		.limit(Math.min(Math.max(input.limit ?? 20, 1), 100));
	const results: Array<AppliedCatalogChangeSet & { error?: string }> = [];
	for (const item of due) {
		try {
			results.push(
				await applyStoredCatalogChangeSet({
					changeSetId: item.id,
					actorId: input.actorId ?? "system:scheduler",
					now,
					markFailed: true,
				}),
			);
		} catch (error) {
			results.push({
				changeSetId: item.id,
				catalogRevision: 0,
				affectedEntities: [],
				cacheInvalidation: "failed",
				error: error instanceof Error ? error.message : "apply_failed",
			});
		}
	}
	return results;
}
