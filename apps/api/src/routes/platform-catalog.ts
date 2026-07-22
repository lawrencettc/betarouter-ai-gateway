import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformAdminMiddleware } from "@/middleware/admin.js";

import { validateProviderKey } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import {
	applyCatalogOperations,
	catalogMappingTestProfile,
	catalogCredentialConfigurationProfile,
	compareCatalogRevision,
	findCatalogRoutabilityLosses,
	catalogChangeSetInputSchema,
	normalizePersistedInverseOperations,
	fixedPricesV1ToPriceMap,
	getCatalogBreakerStates,
	getCatalogRevisionStatus,
	mappingPolicyPatchSchema,
	mappingPricePolicySchema,
	publishCatalogRevisionInvalidation,
	refreshCatalogRevisionFromSource,
	resolveEffectiveCatalog,
	resolveMappingPrice,
	resetCatalogBreaker,
	sourceMappingPricesToPriceMap,
	validateCatalogActivation,
} from "@llmgateway/catalog";
import {
	db,
	decryptPlatformProviderToken,
	desc,
	eq,
	and,
	gte,
	inArray,
	log,
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformAuditLog,
	platformMappingPolicy,
	platformMappingHealthSummary,
	platformMappingPricePolicy,
	platformMappingTestRun,
	platformModelPolicy,
	platformProviderCredential,
	platformProviderPolicy,
	provider,
	or,
	sql,
	videoJob,
} from "@llmgateway/db";
import { getProviderEnvConfig, getProviderEnvVar } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type {
	CatalogLifecycle,
	CatalogOperationV1,
	CatalogPolicyState,
	CatalogRevisionStatus,
	EffectiveCatalog,
	MappingPolicy,
	ModelPolicy,
	ProviderPolicy,
	ResolvedMappingPrice,
} from "@llmgateway/catalog";
import type { PlatformCatalogOperationV1 } from "@llmgateway/db";
import type { Provider, ProviderId } from "@llmgateway/models";

const platformCatalog = new OpenAPIHono<ServerTypes>();
platformCatalog.use("/*", platformAdminMiddleware);
const CATALOG_INVALIDATION_CHANNEL = "platform-catalog:invalidate";

const lifecycleSchema = z.enum(["draft", "active", "deprecated", "retired"]);
const effectiveProviderSchema = z.object({
	id: z.string(),
	lifecycle: lifecycleSchema,
	configuredVisible: z.boolean(),
	visible: z.boolean(),
	available: z.boolean(),
});
const effectiveModelSchema = z.object({
	id: z.string(),
	lifecycle: lifecycleSchema,
	configuredVisible: z.boolean(),
	visible: z.boolean(),
	available: z.boolean(),
	allowDirect: z.boolean(),
	replacementModelId: z.string().nullable(),
	deprecatedAt: z.string().nullable(),
	retireAt: z.string().nullable(),
	retirementMessage: z.string().nullable(),
});
const effectiveMappingSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	modelId: z.string(),
	region: z.string().nullable(),
	externalId: z.string(),
	displayable: z.boolean(),
	available: z.boolean(),
	routable: z.boolean(),
	probeOnly: z.boolean(),
	priority: z.number(),
	weight: z.number(),
	contextSizeLimit: z.number().int().positive().nullable(),
	maxOutputLimit: z.number().int().positive().nullable(),
	disabledCapabilities: z.array(z.string()),
	sourcePrices: z.record(z.string(), z.string()),
	customerPrices: z.record(z.string(), z.string()),
	margin: z.record(z.string(), z.string()),
	pricingMode: z.enum(["source_cost", "markup", "fixed"]).nullable(),
	markupBps: z.number().nullable(),
	reasons: z.array(z.string()),
});
const providerPolicyViewSchema = z.object({
	updatedAt: z.string(),
	enabled: z.boolean(),
	visible: z.boolean(),
	lifecycle: lifecycleSchema,
	sortOrder: z.number(),
	displayNameOverride: z.string().nullable(),
	descriptionOverride: z.string().nullable(),
	websiteOverride: z.string().nullable(),
	deprecatedAt: z.string().nullable(),
	retireAt: z.string().nullable(),
	replacementProviderId: z.string().nullable(),
});
const modelPolicyViewSchema = z.object({
	updatedAt: z.string(),
	enabled: z.boolean(),
	visible: z.boolean(),
	allowDirect: z.boolean(),
	lifecycle: lifecycleSchema,
	replacementModelId: z.string().nullable(),
	deprecatedAt: z.string().nullable(),
	retireAt: z.string().nullable(),
	retirementMessage: z.string().nullable(),
	displayNameOverride: z.string().nullable(),
	descriptionOverride: z.string().nullable(),
	aliasesOverride: z.array(z.string()).nullable(),
	sortOrder: z.number(),
});
const mappingPolicyViewSchema = z.object({
	updatedAt: z.string(),
	enabled: z.boolean(),
	externalIdOverride: z.string().nullable(),
	priority: z.number(),
	weight: z.number(),
	breakerEnabled: z.boolean(),
	requiredTestRevision: z.string().nullable(),
	contextSizeLimit: z.number().nullable(),
	maxOutputLimit: z.number().nullable(),
	disabledCapabilities: z.array(z.string()),
});
const adminProviderSchema = effectiveProviderSchema.extend({
	name: z.string(),
	description: z.string(),
	credentialAvailable: z.boolean(),
	policy: providerPolicyViewSchema.nullable(),
});
const adminModelSchema = effectiveModelSchema.extend({
	name: z.string(),
	description: z.string(),
	family: z.string(),
	output: z.array(z.string()),
	policy: modelPolicyViewSchema.nullable(),
});
const adminMappingSchema = effectiveMappingSchema.extend({
	credentialAvailable: z.boolean(),
	policy: mappingPolicyViewSchema.nullable(),
	providerPolicy: providerPolicyViewSchema.nullable(),
	modelPolicy: modelPolicyViewSchema.nullable(),
	pricePolicyUpdatedAt: z.string().nullable(),
	pricePolicy: mappingPricePolicySchema.nullable(),
});
const listQuerySchema = z.object({
	search: z.string().optional(),
	state: z
		.enum([
			"all",
			"visible",
			"hidden",
			"available",
			"unavailable",
			"deprecated",
			"retired",
			"unhealthy",
			"unpriced",
			"uncredentialed",
			"untested",
		])
		.default("all"),
	providerId: z.string().optional(),
	modality: z.string().optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
const previewResponseSchema = z.object({
	valid: z.boolean(),
	baseRevision: z.number().nullable(),
	resultingChecksum: z.string(),
	blockers: z.array(
		z.object({ entityId: z.string(), reasons: z.array(z.string()) }),
	),
	warnings: z.array(z.string()),
	affected: z.object({
		providers: z.number(),
		models: z.number(),
		mappings: z.number(),
		credentials: z.number(),
		requests: z.number().nullable(),
		organizations: z.number().nullable(),
		projects: z.number().nullable(),
		apiKeys: z.number().nullable(),
		queuedJobs: z.number().nullable(),
	}),
	fallbackLosses: z.array(z.string()),
	stateChanges: z.array(z.string()),
	scheduledConflicts: z.array(z.string()),
	priceChanges: z.array(z.string()),
	marginEstimate: z.string().nullable(),
});

const catalogRevisionCountsSchema = z.object({
	providers: z.number(),
	models: z.number(),
	mappings: z.number(),
});

const catalogRevisionStatusSchema = z.object({
	revision: z.number(),
	publishedAt: z.string().nullable(),
	publishedChecksum: z.string().nullable(),
	currentChecksum: z.string(),
	drifted: z.boolean(),
	sourceAhead: z.boolean(),
	sourceUpdatedAt: z.string().nullable(),
	publishedCounts: catalogRevisionCountsSchema,
	currentCounts: catalogRevisionCountsSchema,
});

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

function toProviderPolicy(
	row: typeof platformProviderPolicy.$inferSelect,
): ProviderPolicy {
	return {
		providerId: row.providerId,
		visible: row.visible,
		enabled: row.enabled,
		lifecycle: row.lifecycle as CatalogLifecycle,
		deprecatedAt: row.deprecatedAt,
		retireAt: row.retireAt,
	};
}

function toModelPolicy(
	row: typeof platformModelPolicy.$inferSelect,
): ModelPolicy {
	return {
		modelId: row.modelId,
		visible: row.visible,
		enabled: row.enabled,
		allowDirect: row.allowDirect,
		lifecycle: row.lifecycle as CatalogLifecycle,
		deprecatedAt: row.deprecatedAt,
		retireAt: row.retireAt,
		replacementModelId: row.replacementModelId,
		retirementMessage: row.retirementMessage,
	};
}

function toMappingPolicy(
	row: typeof platformMappingPolicy.$inferSelect,
): MappingPolicy {
	return {
		mappingId: row.mappingId,
		enabled: row.enabled,
		priority: row.priority,
		weight: row.weight,
		breakerEnabled: row.breakerEnabled,
		externalIdOverride: row.externalIdOverride,
		contextSizeLimit: row.contextSizeLimit,
		maxOutputLimit: row.maxOutputLimit,
		disabledCapabilities:
			mappingPolicyPatchSchema.shape.disabledCapabilities.parse(
				row.disabledCapabilities,
			),
	};
}

function resolvePricePolicy(
	mapping: typeof modelProviderMapping.$inferSelect,
	policy: CatalogPolicyState["prices"][string]["policy"] | undefined,
): ResolvedMappingPrice & {
	sourcePrices: ReturnType<typeof sourceMappingPricesToPriceMap>;
	pricingMode: "source_cost" | "markup" | "fixed" | null;
	markupBps: number | null;
} {
	const sourcePrices = sourceMappingPricesToPriceMap(mapping);
	if (!policy) {
		return {
			ready: false,
			sourcePrices,
			customerPrices: {},
			margin: {},
			missingUnits: [],
			invalidUnits: [],
			negativeMarginUnits: [],
			pricingMode: null,
			markupBps: null,
		};
	}
	const resolved = resolveMappingPrice({
		sourcePrices,
		policy:
			policy.mode === "fixed"
				? {
						mode: "fixed",
						fixedPrices: fixedPricesV1ToPriceMap(policy.fixedPrices),
						allowNegativeMargin: policy.allowNegativeMargin,
						negativeMarginReason: policy.negativeMarginReason,
					}
				: policy.mode === "markup"
					? {
							mode: "markup",
							markupBps: policy.markupBps,
							allowNegativeMargin: policy.allowNegativeMargin,
							negativeMarginReason: policy.negativeMarginReason,
						}
					: { mode: "source_cost" },
	});
	return {
		...resolved,
		sourcePrices,
		pricingMode: policy.mode,
		markupBps: policy.mode === "markup" ? policy.markupBps : null,
	};
}

export function serializeMappingPricePolicy(
	pricePolicy: typeof platformMappingPricePolicy.$inferSelect,
) {
	const common = {
		currency: pricePolicy.currency,
		allowNegativeMargin: pricePolicy.allowNegativeMargin,
	};
	if (pricePolicy.mode === "source_cost") {
		return mappingPricePolicySchema.parse({
			...common,
			mode: "source_cost",
		});
	}
	if (pricePolicy.mode === "markup") {
		return mappingPricePolicySchema.parse({
			...common,
			mode: "markup",
			markupBps: pricePolicy.markupBps,
			negativeMarginReason: pricePolicy.negativeMarginReason ?? undefined,
		});
	}
	return mappingPricePolicySchema.parse({
		...common,
		mode: "fixed",
		fixedPrices: pricePolicy.fixedPrices,
		negativeMarginReason: pricePolicy.negativeMarginReason ?? undefined,
	});
}

async function loadCatalogView(): Promise<{
	snapshot: EffectiveCatalog;
	sourceProviders: (typeof provider.$inferSelect)[];
	sourceModels: (typeof model.$inferSelect)[];
	sourceMappings: (typeof modelProviderMapping.$inferSelect)[];
	providerPolicies: (typeof platformProviderPolicy.$inferSelect)[];
	modelPolicies: (typeof platformModelPolicy.$inferSelect)[];
	mappingPolicies: (typeof platformMappingPolicy.$inferSelect)[];
	pricePolicies: (typeof platformMappingPricePolicy.$inferSelect)[];
	credentialAvailability: Record<string, boolean>;
	credentials: Array<{
		id: string;
		provider: string;
		tokenFingerprint: string;
		baseUrl: string | null;
		options: unknown;
		priority: number;
	}>;
	passedTests: Set<string>;
	revisionStatus: CatalogRevisionStatus;
}> {
	const [
		sourceProviders,
		sourceModels,
		sourceMappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentials,
		tests,
		latestRevisions,
	] = await Promise.all([
		db.select().from(provider),
		db.select().from(model),
		db.select().from(modelProviderMapping),
		db.select().from(platformProviderPolicy),
		db.select().from(platformModelPolicy),
		db.select().from(platformMappingPolicy),
		db.select().from(platformMappingPricePolicy),
		db
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
		db
			.select({
				mappingId: platformMappingTestRun.mappingId,
				testProfile: platformMappingTestRun.testProfile,
			})
			.from(platformMappingTestRun)
			.where(eq(platformMappingTestRun.status, "passed")),
		db
			.select({
				id: platformCatalogRevision.id,
				createdAt: platformCatalogRevision.createdAt,
				checksum: platformCatalogRevision.checksum,
				snapshot: platformCatalogRevision.snapshot,
			})
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1),
	]);
	const credentialProviders = new Set(credentials.map((item) => item.provider));
	const priceMappingIds = new Set(pricePolicies.map((item) => item.mappingId));
	const pricePolicyById = new Map(
		pricePolicies.map((row) => {
			const rawPolicy = {
				mode: row.mode,
				currency: row.currency,
				...(row.markupBps === null ? {} : { markupBps: row.markupBps }),
				...(row.fixedPrices === null ? {} : { fixedPrices: row.fixedPrices }),
				allowNegativeMargin: row.allowNegativeMargin,
				...(row.negativeMarginReason
					? { negativeMarginReason: row.negativeMarginReason }
					: {}),
			};
			return [
				row.mappingId,
				mappingPricePolicySchema.parse(rawPolicy),
			] as const;
		}),
	);
	const passedTests = new Set(
		tests.map((item) => `${item.mappingId}:${item.testProfile}`),
	);
	const mappingPolicyById = new Map(
		mappingPolicies.map((item) => [item.mappingId, item]),
	);
	const credentialAvailability = Object.fromEntries(
		sourceProviders.map((item) => [
			item.id,
			credentialProviders.has(item.id) ||
				environmentCredentialAvailable(item.id),
		]),
	);
	const snapshot = resolveEffectiveCatalog({
		revision: latestRevisions[0]?.id ?? 0,
		now: new Date(),
		providers: sourceProviders.map((item) => ({
			id: item.id,
			status: item.status,
		})),
		models: sourceModels.map((item) => ({ id: item.id, status: item.status })),
		mappings: sourceMappings.map((item) => ({
			id: item.id,
			providerId: item.providerId,
			modelId: item.modelId,
			status: item.status,
			externalId: item.externalId,
			region: item.region,
			deprecatedAt: item.deprecatedAt,
			deactivatedAt: item.deactivatedAt,
		})),
		providerPolicies: providerPolicies.map(toProviderPolicy),
		modelPolicies: modelPolicies.map(toModelPolicy),
		mappingPolicies: mappingPolicies.map(toMappingPolicy),
		providerCredentialAvailability: credentialAvailability,
		mappingReadiness: Object.fromEntries(
			sourceMappings.map((item) => {
				const mappingPolicy = mappingPolicyById.get(item.id);
				const testedCredential = credentials
					.filter((credential) => credential.provider === item.providerId)
					.sort(
						(left, right) =>
							left.priority - right.priority || left.id.localeCompare(right.id),
					)
					.find((credential) => {
						const profile = catalogMappingTestProfile({
							mappingId: item.id,
							providerId: item.providerId,
							region: item.region,
							externalId: mappingPolicy?.externalIdOverride ?? item.externalId,
							contextSizeLimit: mappingPolicy?.contextSizeLimit,
							maxOutputLimit: mappingPolicy?.maxOutputLimit,
							disabledCapabilities: mappingPolicy?.disabledCapabilities,
							credentialId: credential.id,
							credentialFingerprint: credential.tokenFingerprint,
							baseUrl: credential.baseUrl,
							credentialOptions: credential.options,
						});
						return passedTests.has(`${item.id}:${profile}`);
					});
				const prices = resolvePricePolicy(item, pricePolicyById.get(item.id));
				return [
					item.id,
					{
						priceReady: priceMappingIds.has(item.id) && prices.ready,
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
						sourcePrices: prices.sourcePrices,
						customerPrices: prices.customerPrices,
						margin: prices.margin,
						pricingMode: prices.pricingMode,
						markupBps: prices.markupBps,
					},
				];
			}),
		),
		breakerStates: {},
	});
	const sourceTimestamps = [
		...sourceProviders.map((item) => item.updatedAt.getTime()),
		...sourceModels.map((item) => item.updatedAt.getTime()),
		...sourceMappings.map((item) => item.updatedAt.getTime()),
	];
	const revisionStatus = compareCatalogRevision(
		latestRevisions[0] ?? null,
		snapshot,
		sourceTimestamps.length > 0
			? new Date(Math.max(...sourceTimestamps))
			: null,
	);
	return {
		snapshot,
		revisionStatus,
		sourceProviders,
		sourceModels,
		sourceMappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentialAvailability,
		credentials,
		passedTests,
	};
}

type CatalogView = Awaited<ReturnType<typeof loadCatalogView>>;

function missingOperationBlockers(
	view: CatalogView,
	operations: CatalogOperationV1[],
): Array<{ entityId: string; reasons: string[] }> {
	const providerIds = new Set(view.sourceProviders.map((item) => item.id));
	const modelIds = new Set(view.sourceModels.map((item) => item.id));
	const mappingIds = new Set(view.sourceMappings.map((item) => item.id));
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
	return [...new Set(missing)].map((entityId) => ({
		entityId,
		reasons: ["source_entity_missing"],
	}));
}

function policyStateFromView(view: CatalogView): CatalogPolicyState {
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
			view.pricePolicies.map((row) => {
				const rawPolicy = {
					mode: row.mode,
					currency: row.currency,
					...(row.markupBps === null ? {} : { markupBps: row.markupBps }),
					...(row.fixedPrices === null ? {} : { fixedPrices: row.fixedPrices }),
					allowNegativeMargin: row.allowNegativeMargin,
					...(row.negativeMarginReason
						? { negativeMarginReason: row.negativeMarginReason }
						: {}),
				};
				return [
					row.mappingId,
					{
						mappingId: row.mappingId,
						policy: mappingPricePolicySchema.parse(rawPolicy),
						updatedAt: row.updatedAt.toISOString(),
						updatedBy: row.updatedBy,
					},
				];
			}),
		),
	};
}

function resolveStateSnapshot(
	view: CatalogView,
	state: CatalogPolicyState,
	revision: number,
): EffectiveCatalog {
	return resolveEffectiveCatalog({
		revision,
		now: new Date(),
		providers: view.sourceProviders.map((item) => ({
			id: item.id,
			status: item.status,
		})),
		models: view.sourceModels.map((item) => ({
			id: item.id,
			status: item.status,
		})),
		mappings: view.sourceMappings.map((item) => ({
			id: item.id,
			providerId: item.providerId,
			modelId: item.modelId,
			status: item.status,
			externalId: item.externalId,
			region: item.region,
			deprecatedAt: item.deprecatedAt,
			deactivatedAt: item.deactivatedAt,
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
		providerCredentialAvailability: view.credentialAvailability,
		mappingReadiness: Object.fromEntries(
			view.sourceMappings.map((item) => {
				const mappingPolicy = state.mappings[item.id];
				const testedCredential = view.credentials
					.filter((credential) => credential.provider === item.providerId)
					.sort(
						(left, right) =>
							left.priority - right.priority || left.id.localeCompare(right.id),
					)
					.find((credential) => {
						const profile = catalogMappingTestProfile({
							mappingId: item.id,
							providerId: item.providerId,
							region: item.region,
							externalId: mappingPolicy?.externalIdOverride ?? item.externalId,
							contextSizeLimit: mappingPolicy?.contextSizeLimit,
							maxOutputLimit: mappingPolicy?.maxOutputLimit,
							disabledCapabilities: mappingPolicy?.disabledCapabilities,
							credentialId: credential.id,
							credentialFingerprint: credential.tokenFingerprint,
							baseUrl: credential.baseUrl,
							credentialOptions: credential.options,
						});
						return view.passedTests.has(`${item.id}:${profile}`);
					});
				const prices = resolvePricePolicy(item, state.prices[item.id]?.policy);
				return [
					item.id,
					{
						priceReady: prices.ready,
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
						sourcePrices: prices.sourcePrices,
						customerPrices: prices.customerPrices,
						margin: prices.margin,
						pricingMode: prices.pricingMode,
						markupBps: prices.markupBps,
					},
				];
			}),
		),
		breakerStates: {},
	});
}

function requestMetadata(c: {
	req: { header: (name: string) => string | undefined };
}) {
	return {
		requestId: c.req.header("x-request-id"),
		ipAddress:
			c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for"),
		userAgent: c.req.header("user-agent"),
	};
}

function changeSetMatchesInput(
	existing: typeof platformCatalogChangeSet.$inferSelect,
	input: z.infer<typeof catalogChangeSetInputSchema>,
): boolean {
	return (
		existing.title === input.title &&
		existing.reason === input.reason &&
		existing.baseRevision === input.baseRevision &&
		(existing.effectiveAt?.toISOString() ?? null) ===
			(input.effectiveAt ?? null) &&
		JSON.stringify(existing.operations) === JSON.stringify(input.operations)
	);
}

async function calculateCatalogImpact(
	view: CatalogView,
	operations: CatalogOperationV1[],
	before: EffectiveCatalog,
	after: EffectiveCatalog,
) {
	const providerIds = new Set<string>();
	const modelIds = new Set<string>();
	const mappingIds = new Set<string>();
	for (const operation of operations) {
		if (operation.type === "provider.set_policy") {
			providerIds.add(operation.providerId);
		} else if (operation.type === "model.set_policy") {
			modelIds.add(operation.modelId);
		} else if (operation.type === "entity.archive_policy") {
			if (operation.entityType === "provider") {
				providerIds.add(operation.entityId);
			} else if (operation.entityType === "model") {
				modelIds.add(operation.entityId);
			} else {
				mappingIds.add(operation.entityId);
			}
		} else {
			mappingIds.add(operation.mappingId);
		}
	}
	for (const mapping of view.sourceMappings) {
		if (mappingIds.has(mapping.id)) {
			providerIds.add(mapping.providerId);
			modelIds.add(mapping.modelId);
		}
	}
	const affectedProviderIds = [...providerIds];
	const affectedModelIds = [...modelIds];
	const affectedMappingIds = [...mappingIds];
	const scope = or(
		affectedMappingIds.length > 0
			? inArray(log.modelProviderMappingId, affectedMappingIds)
			: undefined,
		affectedModelIds.length > 0
			? inArray(log.usedModel, affectedModelIds)
			: undefined,
		affectedProviderIds.length > 0
			? inArray(log.usedProvider, affectedProviderIds)
			: undefined,
	);
	const queuedScope = or(
		affectedMappingIds.length > 0
			? inArray(videoJob.modelProviderMappingId, affectedMappingIds)
			: undefined,
		affectedModelIds.length > 0
			? inArray(videoJob.model, affectedModelIds)
			: undefined,
		affectedProviderIds.length > 0
			? inArray(videoJob.usedProvider, affectedProviderIds)
			: undefined,
	);
	const lookbackMs = 24 * 60 * 60 * 1000;
	const since = new Date(Date.now() - lookbackMs);
	const [traffic, queued, credentials, scheduledChangeSets] = await Promise.all(
		[
			scope
				? db
						.select({
							requests: sql<number>`count(*)::int`,
							organizations: sql<number>`count(distinct ${log.organizationId})::int`,
							projects: sql<number>`count(distinct ${log.projectId})::int`,
							apiKeys: sql<number>`count(distinct ${log.apiKeyId})::int`,
						})
						.from(log)
						.where(and(gte(log.createdAt, since), scope))
				: Promise.resolve([
						{ requests: 0, organizations: 0, projects: 0, apiKeys: 0 },
					]),
			queuedScope
				? db
						.select({ count: sql<number>`count(*)::int` })
						.from(videoJob)
						.where(
							and(
								inArray(videoJob.status, ["queued", "in_progress"]),
								queuedScope,
							),
						)
				: Promise.resolve([{ count: 0 }]),
			affectedProviderIds.length > 0
				? db
						.select({ count: sql<number>`count(*)::int` })
						.from(platformProviderCredential)
						.where(
							and(
								inArray(
									platformProviderCredential.provider,
									affectedProviderIds,
								),
								inArray(platformProviderCredential.status, [
									"active",
									"inactive",
								]),
							),
						)
				: Promise.resolve([{ count: 0 }]),
			db
				.select({
					id: platformCatalogChangeSet.id,
					operations: platformCatalogChangeSet.operations,
				})
				.from(platformCatalogChangeSet)
				.where(eq(platformCatalogChangeSet.state, "scheduled")),
		],
	);
	const previousMappings = new Map(
		before.mappings.map((item) => [item.id, item]),
	);
	const priceChanges = after.mappings.flatMap((mapping) => {
		if (
			!mappingIds.has(mapping.id) &&
			!providerIds.has(mapping.providerId) &&
			!modelIds.has(mapping.modelId)
		) {
			return [];
		}
		const previous = previousMappings.get(mapping.id);
		const units = new Set([
			...Object.keys(previous?.customerPrices ?? {}),
			...Object.keys(mapping.customerPrices),
		]);
		return [...units]
			.filter(
				(unit) =>
					previous?.customerPrices[
						unit as keyof typeof mapping.customerPrices
					] !==
					mapping.customerPrices[unit as keyof typeof mapping.customerPrices],
			)
			.map(
				(unit) =>
					`${mapping.id}:${unit}:${previous?.customerPrices[unit as keyof typeof mapping.customerPrices] ?? "unset"}->${mapping.customerPrices[unit as keyof typeof mapping.customerPrices] ?? "unset"}`,
			);
	});
	const beforeProviders = new Map(
		before.providers.map((item) => [item.id, item]),
	);
	const beforeModels = new Map(before.models.map((item) => [item.id, item]));
	const stateChanges = [
		...after.providers.flatMap((item) => {
			if (!providerIds.has(item.id)) {
				return [];
			}
			const previous = beforeProviders.get(item.id);
			return previous?.visible !== item.visible ||
				previous?.available !== item.available ||
				previous?.lifecycle !== item.lifecycle
				? [
						`provider:${item.id}:visible ${previous?.visible ?? false}->${item.visible}, available ${previous?.available ?? false}->${item.available}, lifecycle ${previous?.lifecycle ?? "unset"}->${item.lifecycle}`,
					]
				: [];
		}),
		...after.models.flatMap((item) => {
			if (!modelIds.has(item.id)) {
				return [];
			}
			const previous = beforeModels.get(item.id);
			return previous?.visible !== item.visible ||
				previous?.available !== item.available ||
				previous?.allowDirect !== item.allowDirect ||
				previous?.lifecycle !== item.lifecycle
				? [
						`model:${item.id}:visible ${previous?.visible ?? false}->${item.visible}, available ${previous?.available ?? false}->${item.available}, direct ${previous?.allowDirect ?? false}->${item.allowDirect}, lifecycle ${previous?.lifecycle ?? "unset"}->${item.lifecycle}`,
					]
				: [];
		}),
	];
	const affectedEntityIds = new Set([
		...affectedProviderIds,
		...affectedModelIds,
		...affectedMappingIds,
	]);
	const scheduledConflicts = scheduledChangeSets.flatMap((changeSet) => {
		const scheduledIds = new Set(
			catalogChangeSetInputSchema.shape.operations
				.parse(changeSet.operations)
				.flatMap((operation) =>
					operation.type === "provider.set_policy"
						? [operation.providerId]
						: operation.type === "model.set_policy"
							? [operation.modelId]
							: operation.type === "entity.archive_policy"
								? [operation.entityId]
								: [operation.mappingId],
				),
		);
		return [...scheduledIds].some((id) => affectedEntityIds.has(id))
			? [changeSet.id]
			: [];
	});
	const previousMargins = new Map(
		before.mappings.map((item) => [item.id, item.margin]),
	);
	const marginChangeCount = after.mappings.reduce((count, mapping) => {
		if (
			!mappingIds.has(mapping.id) &&
			!providerIds.has(mapping.providerId) &&
			!modelIds.has(mapping.modelId)
		) {
			return count;
		}
		const previous = previousMargins.get(mapping.id) ?? {};
		const units = new Set([
			...Object.keys(previous),
			...Object.keys(mapping.margin),
		]);
		return (
			count +
			[...units].filter(
				(unit) =>
					previous[unit as keyof typeof previous] !==
					mapping.margin[unit as keyof typeof mapping.margin],
			).length
		);
	}, 0);
	return {
		providerIds,
		modelIds,
		mappingIds,
		requests: Number(traffic[0]?.requests ?? 0),
		organizations: Number(traffic[0]?.organizations ?? 0),
		projects: Number(traffic[0]?.projects ?? 0),
		apiKeys: Number(traffic[0]?.apiKeys ?? 0),
		queuedJobs: Number(queued[0]?.count ?? 0),
		credentials: Number(credentials[0]?.count ?? 0),
		priceChanges,
		stateChanges,
		scheduledConflicts,
		marginEstimate:
			marginChangeCount > 0
				? `${marginChangeCount} per-unit margin change${marginChangeCount === 1 ? "" : "s"} across ${Number(traffic[0]?.requests ?? 0)} requests in the last 24 hours`
				: null,
	};
}

type CatalogTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function persistPolicyState(
	tx: CatalogTransaction,
	state: CatalogPolicyState,
	operations: CatalogOperationV1[],
): Promise<void> {
	const providerIds = new Set<string>();
	const modelIds = new Set<string>();
	const mappingIds = new Set<string>();
	const priceMappingIds = new Set<string>();
	for (const operation of operations) {
		switch (operation.type) {
			case "provider.set_policy":
				providerIds.add(operation.providerId);
				break;
			case "model.set_policy":
				modelIds.add(operation.modelId);
				break;
			case "mapping.set_policy":
			case "mapping.set_external_id":
				mappingIds.add(operation.mappingId);
				break;
			case "mapping.set_price_policy":
				priceMappingIds.add(operation.mappingId);
				break;
			case "mapping.clear_price_policy":
				priceMappingIds.add(operation.mappingId);
				break;
			case "entity.archive_policy":
				if (operation.entityType === "provider") {
					providerIds.add(operation.entityId);
				} else if (operation.entityType === "model") {
					modelIds.add(operation.entityId);
				} else {
					mappingIds.add(operation.entityId);
				}
				break;
		}
	}

	for (const providerId of providerIds) {
		const row = state.providers[providerId];
		if (!row) {
			throw new HTTPException(409, { message: "Provider policy is stale" });
		}
		const values = {
			providerId: row.providerId,
			visible: row.visible,
			enabled: row.enabled,
			displayNameOverride: row.displayNameOverride ?? null,
			descriptionOverride: row.descriptionOverride ?? null,
			websiteOverride: row.websiteOverride ?? null,
			sortOrder: row.sortOrder ?? 1000,
			lifecycle: row.lifecycle,
			deprecatedAt: row.deprecatedAt ? new Date(row.deprecatedAt) : null,
			retireAt: row.retireAt ? new Date(row.retireAt) : null,
			replacementProviderId: row.replacementProviderId ?? null,
			updatedAt: new Date(row.updatedAt),
			updatedBy: row.updatedBy,
		};
		await tx.insert(platformProviderPolicy).values(values).onConflictDoUpdate({
			target: platformProviderPolicy.providerId,
			set: values,
		});
	}
	for (const modelId of modelIds) {
		const row = state.models[modelId];
		if (!row) {
			throw new HTTPException(409, { message: "Model policy is stale" });
		}
		const values = {
			modelId: row.modelId,
			visible: row.visible,
			enabled: row.enabled,
			allowDirect: row.allowDirect,
			displayNameOverride: row.displayNameOverride ?? null,
			descriptionOverride: row.descriptionOverride ?? null,
			aliasesOverride: row.aliasesOverride ?? null,
			sortOrder: row.sortOrder ?? 1000,
			lifecycle: row.lifecycle,
			deprecatedAt: row.deprecatedAt ? new Date(row.deprecatedAt) : null,
			retireAt: row.retireAt ? new Date(row.retireAt) : null,
			replacementModelId: row.replacementModelId ?? null,
			retirementMessage: row.retirementMessage ?? null,
			updatedAt: new Date(row.updatedAt),
			updatedBy: row.updatedBy,
		};
		await tx
			.insert(platformModelPolicy)
			.values(values)
			.onConflictDoUpdate({ target: platformModelPolicy.modelId, set: values });
	}
	for (const mappingId of mappingIds) {
		const row = state.mappings[mappingId];
		if (!row) {
			throw new HTTPException(409, { message: "Mapping policy is stale" });
		}
		const values = {
			mappingId: row.mappingId,
			enabled: row.enabled,
			externalIdOverride: row.externalIdOverride ?? null,
			contextSizeLimit: row.contextSizeLimit ?? null,
			maxOutputLimit: row.maxOutputLimit ?? null,
			disabledCapabilities: row.disabledCapabilities ?? [],
			priority: row.priority ?? 100,
			weight: row.weight ?? 100,
			breakerEnabled: row.breakerEnabled ?? true,
			requiredTestRevision: row.requiredTestRevision ?? null,
			updatedAt: new Date(row.updatedAt),
			updatedBy: row.updatedBy,
		};
		await tx.insert(platformMappingPolicy).values(values).onConflictDoUpdate({
			target: platformMappingPolicy.mappingId,
			set: values,
		});
	}
	for (const mappingId of priceMappingIds) {
		const row = state.prices[mappingId];
		if (!row) {
			await tx
				.delete(platformMappingPricePolicy)
				.where(eq(platformMappingPricePolicy.mappingId, mappingId));
			continue;
		}
		const policy = row.policy;
		const values = {
			mappingId,
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

function paginate<T>(
	items: T[],
	page: number,
	pageSize: number,
): { items: T[]; total: number; page: number; pageSize: number } {
	return {
		items: items.slice((page - 1) * pageSize, page * pageSize),
		total: items.length,
		page,
		pageSize,
	};
}

interface FilterableEffective {
	id: string;
	providerId?: string;
	modelId?: string;
	externalId?: string;
	region?: string | null;
	visible?: boolean;
	displayable?: boolean;
	available: boolean;
	lifecycle?: "draft" | "active" | "deprecated" | "retired";
	routable?: boolean;
	reasons?: string[];
}

export function matchesCatalogSearch(
	item: Pick<
		FilterableEffective,
		"id" | "providerId" | "modelId" | "externalId" | "region"
	>,
	search: string,
): boolean {
	const query = search.trim().toLowerCase();
	if (!query) {
		return true;
	}
	return [
		item.id,
		item.providerId,
		item.modelId,
		item.externalId,
		item.region,
	].some((value) => value?.toLowerCase().includes(query) ?? false);
}

function filterEffective<T extends FilterableEffective>(
	items: T[],
	query: z.infer<typeof listQuerySchema>,
): T[] {
	const search = query.search?.trim().toLowerCase();
	return items.filter((item) => {
		if (search && !matchesCatalogSearch(item, search)) {
			return false;
		}
		switch (query.state) {
			case "visible":
				return (item.visible ?? item.displayable) === true;
			case "hidden":
				return (item.visible ?? item.displayable) === false;
			case "available":
				return item.available;
			case "unavailable":
				return !item.available;
			case "deprecated":
				return item.lifecycle === "deprecated";
			case "retired":
				return item.lifecycle === "retired";
			case "unhealthy":
				return (
					item.routable === false &&
					(item.reasons?.some((reason) => reason.startsWith("circuit_")) ??
						false)
				);
			case "unpriced":
				return item.reasons?.includes("mapping_price_incomplete") ?? false;
			case "uncredentialed":
				return (
					item.reasons?.includes("provider_credential_unavailable") ?? false
				);
			case "untested":
				return item.reasons?.includes("mapping_test_required") ?? false;
			case "all":
				return true;
			default:
				return false;
		}
	});
}

function definedPriceRecord(
	values: Record<string, string | undefined>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/summary",
		responses: {
			200: {
				description: "Effective catalog launch readiness summary",
				content: {
					"application/json": {
						schema: z.object({
							revision: z.number(),
							checksum: z.string(),
							providers: z.object({
								total: z.number(),
								visible: z.number(),
								available: z.number(),
							}),
							models: z.object({
								total: z.number(),
								visible: z.number(),
								available: z.number(),
							}),
							mappings: z.object({
								total: z.number(),
								routable: z.number(),
								blocked: z.number(),
							}),
							revisionStatus: catalogRevisionStatusSchema,
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const { snapshot, revisionStatus } = await loadCatalogView();
		return c.json({
			revision: snapshot.revision,
			checksum: snapshot.checksum,
			providers: {
				total: snapshot.providers.length,
				visible: snapshot.visibleProviderIds.length,
				available: snapshot.providers.filter((item) => item.available).length,
			},
			models: {
				total: snapshot.models.length,
				visible: snapshot.visibleModelIds.length,
				available: snapshot.availableModelIds.length,
			},
			mappings: {
				total: snapshot.mappings.length,
				routable: snapshot.routableMappingIds.length,
				blocked: snapshot.mappings.filter((item) => !item.available).length,
			},
			revisionStatus,
		});
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/source/refresh",
		responses: {
			200: {
				description:
					"Idempotently publish current synchronized source and readiness state",
				content: {
					"application/json": {
						schema: z.object({
							changed: z.boolean(),
							changeSetId: z.string().nullable(),
							catalogRevision: z.number(),
							cacheInvalidation: z.enum(["published", "failed"]).nullable(),
							status: catalogRevisionStatusSchema,
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		let beforeRevision = 0;
		try {
			const committed = await db.transaction(async (tx) => {
				await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
				const before = await getCatalogRevisionStatus({ transaction: tx });
				beforeRevision = before.revision;
				const result = await refreshCatalogRevisionFromSource({
					actorId: user.id,
					transaction: tx,
					deferInvalidation: true,
				});
				const status = await getCatalogRevisionStatus({ transaction: tx });
				await tx.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.source_refresh",
					resourceId: result?.changeSetId ?? `revision:${status.revision}`,
					success: true,
					metadata: {
						changed: result !== null,
						beforeRevision,
						catalogRevision: status.revision,
					},
					...requestMetadata(c),
				});
				return { result, status };
			});
			const result = committed.result
				? await publishCatalogRevisionInvalidation(committed.result)
				: null;
			return c.json({
				changed: result !== null,
				changeSetId: result?.changeSetId ?? null,
				catalogRevision: committed.status.revision,
				cacheInvalidation: result?.cacheInvalidation ?? null,
				status: committed.status,
			});
		} catch (error) {
			try {
				await db.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.source_refresh",
					resourceId: `revision:${beforeRevision}`,
					success: false,
					metadata: {
						beforeRevision,
						errorClass:
							error instanceof Error ? error.name : "catalog_refresh_error",
					},
					...requestMetadata(c),
				});
			} catch {
				// Preserve the refresh error if the audit store is unavailable.
			}
			throw error;
		}
	},
);

function catalogListResponse<T extends z.ZodTypeAny>(item: T) {
	return z.object({
		items: z.array(item),
		total: z.number(),
		page: z.number(),
		pageSize: z.number(),
		revision: z.number(),
		checksum: z.string(),
	});
}

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/providers",
		request: { query: listQuerySchema },
		responses: {
			200: {
				description: "Paginated effective catalog providers",
				content: {
					"application/json": {
						schema: catalogListResponse(adminProviderSchema),
					},
				},
			},
		},
	}),
	async (c) => {
		const query = c.req.valid("query");
		const view = await loadCatalogView();
		const sourceById = new Map(
			view.sourceProviders.map((item) => [item.id, item]),
		);
		const policyById = new Map(
			view.providerPolicies.map((item) => [item.providerId, item]),
		);
		const providerCandidates = query.providerId
			? view.snapshot.providers.filter((item) => item.id === query.providerId)
			: view.snapshot.providers;
		const filtered = filterEffective(providerCandidates, query).map((item) => {
			const source = sourceById.get(item.id)!;
			const policy = policyById.get(item.id);
			return {
				...item,
				name: source.name,
				description: source.description,
				credentialAvailable: view.credentialAvailability[item.id] ?? false,
				policy: policy
					? {
							updatedAt: policy.updatedAt.toISOString(),
							enabled: policy.enabled,
							visible: policy.visible,
							lifecycle: policy.lifecycle,
							sortOrder: policy.sortOrder,
							displayNameOverride: policy.displayNameOverride,
							descriptionOverride: policy.descriptionOverride,
							websiteOverride: policy.websiteOverride,
							deprecatedAt: policy.deprecatedAt?.toISOString() ?? null,
							retireAt: policy.retireAt?.toISOString() ?? null,
							replacementProviderId: policy.replacementProviderId,
						}
					: null,
			};
		});
		return c.json({
			...paginate(filtered, query.page, query.pageSize),
			revision: view.snapshot.revision,
			checksum: view.snapshot.checksum,
		});
	},
);

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/models",
		request: { query: listQuerySchema },
		responses: {
			200: {
				description: "Paginated effective catalog models",
				content: {
					"application/json": { schema: catalogListResponse(adminModelSchema) },
				},
			},
		},
	}),
	async (c) => {
		const query = c.req.valid("query");
		const view = await loadCatalogView();
		const sourceById = new Map(
			view.sourceModels.map((item) => [item.id, item]),
		);
		const policyById = new Map(
			view.modelPolicies.map((item) => [item.modelId, item]),
		);
		const modelIdsForProvider = query.providerId
			? new Set(
					view.snapshot.mappings
						.filter((item) => item.providerId === query.providerId)
						.map((item) => item.modelId),
				)
			: null;
		const modelCandidates = view.snapshot.models.filter((item) => {
			const source = sourceById.get(item.id);
			return (
				(!modelIdsForProvider || modelIdsForProvider.has(item.id)) &&
				(!query.modality || source?.output.includes(query.modality))
			);
		});
		const filtered = filterEffective(modelCandidates, query).map((item) => {
			const source = sourceById.get(item.id)!;
			const policy = policyById.get(item.id);
			return {
				...item,
				name: source.name,
				description: source.description,
				family: source.family,
				output: source.output,
				policy: policy
					? {
							updatedAt: policy.updatedAt.toISOString(),
							enabled: policy.enabled,
							visible: policy.visible,
							allowDirect: policy.allowDirect,
							lifecycle: policy.lifecycle,
							replacementModelId: policy.replacementModelId,
							deprecatedAt: policy.deprecatedAt?.toISOString() ?? null,
							retireAt: policy.retireAt?.toISOString() ?? null,
							retirementMessage: policy.retirementMessage,
							displayNameOverride: policy.displayNameOverride,
							descriptionOverride: policy.descriptionOverride,
							aliasesOverride: policy.aliasesOverride,
							sortOrder: policy.sortOrder,
						}
					: null,
			};
		});
		return c.json({
			...paginate(filtered, query.page, query.pageSize),
			revision: view.snapshot.revision,
			checksum: view.snapshot.checksum,
		});
	},
);

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/mappings",
		request: { query: listQuerySchema },
		responses: {
			200: {
				description: "Paginated effective catalog mappings",
				content: {
					"application/json": {
						schema: catalogListResponse(adminMappingSchema),
					},
				},
			},
		},
	}),
	async (c) => {
		const query = c.req.valid("query");
		const view = await loadCatalogView();
		const policyById = new Map(
			view.mappingPolicies.map((item) => [item.mappingId, item]),
		);
		const providerPolicyById = new Map(
			view.providerPolicies.map((item) => [item.providerId, item]),
		);
		const modelPolicyById = new Map(
			view.modelPolicies.map((item) => [item.modelId, item]),
		);
		const pricePolicyById = new Map(
			view.pricePolicies.map((item) => [item.mappingId, item]),
		);
		const sourceModelById = new Map(
			view.sourceModels.map((item) => [item.id, item]),
		);
		const mappingCandidates = view.snapshot.mappings.filter(
			(item) =>
				(!query.providerId || item.providerId === query.providerId) &&
				(!query.modality ||
					sourceModelById.get(item.modelId)?.output.includes(query.modality)),
		);
		const filtered = filterEffective(mappingCandidates, query).map((item) => {
			const policy = policyById.get(item.id);
			const providerPolicy = providerPolicyById.get(item.providerId);
			const modelPolicy = modelPolicyById.get(item.modelId);
			const pricePolicy = pricePolicyById.get(item.id);
			return {
				...item,
				sourcePrices: definedPriceRecord(item.sourcePrices),
				customerPrices: definedPriceRecord(item.customerPrices),
				margin: definedPriceRecord(item.margin),
				pricePolicyUpdatedAt: pricePolicy?.updatedAt.toISOString() ?? null,
				pricePolicy: pricePolicy
					? serializeMappingPricePolicy(pricePolicy)
					: null,
				credentialAvailable:
					view.credentialAvailability[item.providerId] ?? false,
				policy: policy
					? {
							updatedAt: policy.updatedAt.toISOString(),
							enabled: policy.enabled,
							externalIdOverride: policy.externalIdOverride,
							priority: policy.priority,
							weight: policy.weight,
							breakerEnabled: policy.breakerEnabled,
							requiredTestRevision: policy.requiredTestRevision,
							contextSizeLimit: policy.contextSizeLimit,
							maxOutputLimit: policy.maxOutputLimit,
							disabledCapabilities: policy.disabledCapabilities,
						}
					: null,
				providerPolicy: providerPolicy
					? {
							updatedAt: providerPolicy.updatedAt.toISOString(),
							enabled: providerPolicy.enabled,
							visible: providerPolicy.visible,
							lifecycle: providerPolicy.lifecycle,
							sortOrder: providerPolicy.sortOrder,
							displayNameOverride: providerPolicy.displayNameOverride,
							descriptionOverride: providerPolicy.descriptionOverride,
							websiteOverride: providerPolicy.websiteOverride,
							deprecatedAt: providerPolicy.deprecatedAt?.toISOString() ?? null,
							retireAt: providerPolicy.retireAt?.toISOString() ?? null,
							replacementProviderId: providerPolicy.replacementProviderId,
						}
					: null,
				modelPolicy: modelPolicy
					? {
							updatedAt: modelPolicy.updatedAt.toISOString(),
							enabled: modelPolicy.enabled,
							visible: modelPolicy.visible,
							allowDirect: modelPolicy.allowDirect,
							lifecycle: modelPolicy.lifecycle,
							replacementModelId: modelPolicy.replacementModelId,
							deprecatedAt: modelPolicy.deprecatedAt?.toISOString() ?? null,
							retireAt: modelPolicy.retireAt?.toISOString() ?? null,
							retirementMessage: modelPolicy.retirementMessage,
							displayNameOverride: modelPolicy.displayNameOverride,
							descriptionOverride: modelPolicy.descriptionOverride,
							aliasesOverride: modelPolicy.aliasesOverride,
							sortOrder: modelPolicy.sortOrder,
						}
					: null,
			};
		});
		return c.json({
			...paginate(filtered, query.page, query.pageSize),
			revision: view.snapshot.revision,
			checksum: view.snapshot.checksum,
		});
	},
);

const mappingTestResponseSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	mappingId: z.string(),
	credentialId: z.string().nullable(),
	catalogRevision: z.number().nullable(),
	status: z.enum(["running", "passed", "failed", "error"]),
	testProfile: z.string(),
	latencyMs: z.number().nullable(),
	upstreamStatus: z.number().nullable(),
	errorClass: z.string().nullable(),
	sanitizedMessage: z.string().nullable(),
	finishedAt: z.string().nullable(),
});

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/mappings/{id}/tests",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description: "Sanitized mapping test history",
				content: {
					"application/json": { schema: z.array(mappingTestResponseSchema) },
				},
			},
		},
	}),
	async (c) => {
		const rows = await db
			.select()
			.from(platformMappingTestRun)
			.where(eq(platformMappingTestRun.mappingId, c.req.valid("param").id))
			.orderBy(desc(platformMappingTestRun.createdAt))
			.limit(100);
		return c.json(
			rows.map((row) => ({
				...row,
				createdAt: row.createdAt.toISOString(),
				finishedAt: row.finishedAt?.toISOString() ?? null,
			})),
		);
	},
);

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/mappings/{id}/health",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description: "Mapping readiness and live health",
				content: {
					"application/json": {
						schema: z.object({
							mapping: effectiveMappingSchema,
							breaker: z
								.object({
									state: z.enum(["closed", "open", "half_open"]),
									consecutiveFailures: z.number(),
									requestCount: z.number(),
									openedAt: z.number().nullable(),
									retryAt: z.number().nullable(),
								})
								.nullable(),
							credentialCount: z.number(),
							validCredentialCount: z.number(),
							latestTest: mappingTestResponseSchema.nullable(),
							latestSummary: z
								.object({
									createdAt: z.string(),
									requestCount: z.number(),
									upstreamFailureCount: z.number(),
									latencyP50Ms: z.number().nullable(),
									latencyP95Ms: z.number().nullable(),
									lastSuccessAt: z.string().nullable(),
								})
								.nullable(),
						}),
					},
				},
			},
			404: { description: "Mapping not found" },
		},
	}),
	async (c) => {
		const mappingId = c.req.valid("param").id;
		const view = await loadCatalogView();
		const mapping = view.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		if (!mapping) {
			return c.json({ message: "Mapping not found" }, 404);
		}
		const [breakerStates, credentials, tests, summaries] = await Promise.all([
			getCatalogBreakerStates({
				revision: view.snapshot.revision,
				mappingIds: [mappingId],
			}).catch(
				() => ({}) as Awaited<ReturnType<typeof getCatalogBreakerStates>>,
			),
			db
				.select({
					status: platformProviderCredential.status,
					validationStatus: platformProviderCredential.validationStatus,
				})
				.from(platformProviderCredential)
				.where(eq(platformProviderCredential.provider, mapping.providerId)),
			db
				.select()
				.from(platformMappingTestRun)
				.where(eq(platformMappingTestRun.mappingId, mappingId))
				.orderBy(desc(platformMappingTestRun.createdAt))
				.limit(1),
			db
				.select()
				.from(platformMappingHealthSummary)
				.where(eq(platformMappingHealthSummary.mappingId, mappingId))
				.orderBy(desc(platformMappingHealthSummary.createdAt))
				.limit(1),
		]);
		const breaker = breakerStates[mappingId];
		const latestTest = tests[0];
		const latestSummary = summaries[0];
		return c.json({
			mapping,
			breaker: breaker
				? {
						state: breaker.state,
						consecutiveFailures: breaker.consecutiveFailures,
						requestCount: breaker.window.length,
						openedAt: breaker.openedAt ?? null,
						retryAt: breaker.retryAt ?? null,
					}
				: null,
			credentialCount: credentials.filter((item) => item.status === "active")
				.length,
			validCredentialCount: credentials.filter(
				(item) => item.status === "active" && item.validationStatus === "valid",
			).length,
			latestTest: latestTest
				? {
						...latestTest,
						createdAt: latestTest.createdAt.toISOString(),
						finishedAt: latestTest.finishedAt?.toISOString() ?? null,
					}
				: null,
			latestSummary: latestSummary
				? {
						createdAt: latestSummary.createdAt.toISOString(),
						requestCount: latestSummary.requestCount,
						upstreamFailureCount: latestSummary.upstreamFailureCount,
						latencyP50Ms: latestSummary.latencyP50Ms,
						latencyP95Ms: latestSummary.latencyP95Ms,
						lastSuccessAt: latestSummary.lastSuccessAt?.toISOString() ?? null,
					}
				: null,
		});
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/mappings/{id}/breaker/reset",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description: "Breaker reset",
				content: {
					"application/json": {
						schema: z.object({
							success: z.literal(true),
							revision: z.number(),
						}),
					},
				},
			},
			409: { description: "A passing mapping test is required" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const mappingId = c.req.valid("param").id;
		const view = await loadCatalogView();
		const [latestTest] = await db
			.select()
			.from(platformMappingTestRun)
			.where(eq(platformMappingTestRun.mappingId, mappingId))
			.orderBy(desc(platformMappingTestRun.createdAt))
			.limit(1);
		const mapping = view.snapshot.mappings.find(
			(item) => item.id === mappingId,
		);
		if (
			!latestTest ||
			latestTest.status !== "passed" ||
			!mapping ||
			mapping.reasons.includes("mapping_test_required")
		) {
			throw new HTTPException(409, {
				message: "Run and pass a mapping test before resetting its breaker",
			});
		}
		await resetCatalogBreaker(view.snapshot.revision, mappingId);
		await db.insert(platformAuditLog).values({
			userId: user.id,
			action: "platform_catalog.circuit_close",
			resourceId: mappingId,
			success: true,
			metadata: {
				revision: view.snapshot.revision,
				testRunId: latestTest.id,
				manual: true,
			},
			...requestMetadata(c),
		});
		return c.json({ success: true as const, revision: view.snapshot.revision });
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/mappings/{id}/test",
		request: {
			params: z.object({ id: z.string().min(1) }),
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z.object({
							credentialId: z.string().min(1),
							testProfile: z.literal("minimal-chat").default("minimal-chat"),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Completed mapping test",
				content: {
					"application/json": { schema: mappingTestResponseSchema },
				},
			},
			400: { description: "Credential does not match mapping" },
			404: { description: "Mapping or credential not found" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const mappingId = c.req.valid("param").id;
		const input = c.req.valid("json");
		const [[mapping], [credential], [revision], mappingPolicy] =
			await Promise.all([
				db
					.select()
					.from(modelProviderMapping)
					.where(eq(modelProviderMapping.id, mappingId))
					.limit(1),
				db
					.select()
					.from(platformProviderCredential)
					.where(eq(platformProviderCredential.id, input.credentialId))
					.limit(1),
				db
					.select({ id: platformCatalogRevision.id })
					.from(platformCatalogRevision)
					.orderBy(desc(platformCatalogRevision.id))
					.limit(1),
				db
					.select({
						externalIdOverride: platformMappingPolicy.externalIdOverride,
						contextSizeLimit: platformMappingPolicy.contextSizeLimit,
						maxOutputLimit: platformMappingPolicy.maxOutputLimit,
						disabledCapabilities: platformMappingPolicy.disabledCapabilities,
					})
					.from(platformMappingPolicy)
					.where(eq(platformMappingPolicy.mappingId, mappingId))
					.limit(1),
			]);
		if (!mapping || !credential || credential.status === "deleted") {
			throw new HTTPException(404, {
				message: "Mapping or platform credential not found",
			});
		}
		if (
			credential.status !== "active" ||
			credential.provider !== mapping.providerId
		) {
			throw new HTTPException(400, {
				message: "Select an active credential for the mapping provider",
			});
		}
		const [sourceModel] = await db
			.select({ output: model.output })
			.from(model)
			.where(eq(model.id, mapping.modelId))
			.limit(1);
		if (!sourceModel?.output.includes("text")) {
			throw new HTTPException(400, {
				message:
					"This launch supports mapping probes for text/chat models only. Keep this mapping disabled until its operation-specific probe profile is available.",
			});
		}
		const currentPolicy = mappingPolicy[0];
		const testProfile = catalogMappingTestProfile({
			mappingId,
			providerId: mapping.providerId,
			region: mapping.region,
			externalId: currentPolicy?.externalIdOverride ?? mapping.externalId,
			contextSizeLimit: currentPolicy?.contextSizeLimit,
			maxOutputLimit: currentPolicy?.maxOutputLimit,
			disabledCapabilities: currentPolicy
				? mappingPolicyPatchSchema.shape.disabledCapabilities.parse(
						currentPolicy.disabledCapabilities,
					)
				: [],
			credentialId: credential.id,
			credentialFingerprint: credential.tokenFingerprint,
			baseUrl: credential.baseUrl,
			credentialOptions: credential.options,
			profile: input.testProfile,
		});
		const [run] = await db
			.insert(platformMappingTestRun)
			.values({
				createdBy: user.id,
				mappingId,
				credentialId: credential.id,
				catalogRevision: revision?.id ?? null,
				status: "running",
				testProfile,
			})
			.returning();
		if (!run) {
			throw new HTTPException(500, { message: "Mapping test was not created" });
		}
		const startedAt = Date.now();
		let status: "passed" | "failed" | "error" = "error";
		let upstreamStatus: number | null = null;
		let errorClass: string | null = null;
		let sanitizedMessage = "Mapping test could not be completed";
		try {
			const token = decryptPlatformProviderToken(
				credential,
				credential.id,
				credential.provider,
			);
			const result = await validateProviderKey(
				credential.provider as ProviderId,
				token,
				credential.baseUrl ?? undefined,
				process.env.NODE_ENV === "test",
				credential.options ?? undefined,
				{
					modelId: mapping.modelId,
					externalId: currentPolicy?.externalIdOverride ?? mapping.externalId,
					region: mapping.region,
				},
			);
			status = result.valid ? "passed" : "failed";
			upstreamStatus = result.statusCode ?? null;
			errorClass = result.valid ? null : "upstream_validation_failed";
			sanitizedMessage = result.valid
				? "Mapping test passed"
				: result.statusCode
					? `Mapping test failed (upstream status ${result.statusCode})`
					: "Mapping test failed";
		} catch (error) {
			errorClass = error instanceof Error ? error.name : "mapping_test_error";
		}
		const finishedAt = new Date();
		const [updated] = await db
			.update(platformMappingTestRun)
			.set({
				status,
				latencyMs: Date.now() - startedAt,
				upstreamStatus,
				errorClass,
				sanitizedMessage,
				finishedAt,
			})
			.where(eq(platformMappingTestRun.id, run.id))
			.returning();
		await db.insert(platformAuditLog).values({
			userId: user.id,
			action: "platform_catalog.test",
			resourceId: mappingId,
			success: status === "passed",
			metadata: {
				testRunId: run.id,
				credentialId: credential.id,
				testProfile,
				status,
				upstreamStatus,
			},
			...requestMetadata(c),
		});
		if (!updated) {
			throw new HTTPException(500, { message: "Mapping test was not saved" });
		}
		return c.json({
			...updated,
			createdAt: updated.createdAt.toISOString(),
			finishedAt: updated.finishedAt?.toISOString() ?? null,
		});
	},
);

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/revisions/{revision}",
		request: {
			params: z.object({ revision: z.coerce.number().int().positive() }),
		},
		responses: {
			200: {
				description: "Immutable effective snapshot metadata",
				content: {
					"application/json": {
						schema: z.object({
							id: z.number(),
							createdAt: z.string(),
							changeSetId: z.string(),
							appliedBy: z.string(),
							checksum: z.string(),
							snapshot: z.record(z.string(), z.unknown()),
						}),
					},
				},
			},
			404: { description: "Revision not found" },
		},
	}),
	async (c) => {
		const revision = c.req.valid("param").revision;
		const [row] = await db
			.select()
			.from(platformCatalogRevision)
			.where(eq(platformCatalogRevision.id, revision))
			.limit(1);
		if (!row) {
			return c.json({ message: "Revision not found" }, 404);
		}
		return c.json({ ...row, createdAt: row.createdAt.toISOString() });
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/change-sets",
		request: {
			body: {
				required: true,
				content: {
					"application/json": { schema: catalogChangeSetInputSchema },
				},
			},
		},
		responses: {
			200: {
				description: "Existing idempotent catalog change set",
				content: {
					"application/json": { schema: z.record(z.string(), z.unknown()) },
				},
			},
			201: {
				description: "Saved draft or scheduled catalog change set",
				content: {
					"application/json": { schema: z.record(z.string(), z.unknown()) },
				},
			},
			409: { description: "Base revision is stale" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const input = c.req.valid("json");
		const [idempotentReplay] = await db
			.select()
			.from(platformCatalogChangeSet)
			.where(eq(platformCatalogChangeSet.idempotencyKey, input.idempotencyKey))
			.limit(1);
		if (idempotentReplay) {
			if (!changeSetMatchesInput(idempotentReplay, input)) {
				return c.json(
					{
						message: "Idempotency key was already used for another change set",
					},
					409,
				);
			}
			return c.json(idempotentReplay);
		}
		const view = await loadCatalogView();
		const currentRevision = view.snapshot.revision || null;
		if (input.baseRevision !== currentRevision) {
			return c.json({ message: "Catalog base revision is stale" }, 409);
		}
		const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : null;
		const state = effectiveAt ? ("scheduled" as const) : ("draft" as const);
		const [created] = await db
			.insert(platformCatalogChangeSet)
			.values({
				createdBy: user.id,
				title: input.title,
				reason: input.reason,
				state,
				baseRevision: input.baseRevision,
				operations: input.operations as PlatformCatalogOperationV1[],
				effectiveAt,
				idempotencyKey: input.idempotencyKey,
			})
			.onConflictDoNothing({
				target: platformCatalogChangeSet.idempotencyKey,
			})
			.returning();
		if (!created) {
			const [existing] = await db
				.select()
				.from(platformCatalogChangeSet)
				.where(
					eq(platformCatalogChangeSet.idempotencyKey, input.idempotencyKey),
				)
				.limit(1);
			if (!existing || !changeSetMatchesInput(existing, input)) {
				return c.json(
					{
						message: "Idempotency key was already used for another change set",
					},
					409,
				);
			}
			return c.json(existing);
		}
		await db.insert(platformAuditLog).values({
			userId: user.id,
			action: effectiveAt
				? "platform_catalog.schedule"
				: "platform_catalog.preview",
			resourceId: created.id,
			success: true,
			metadata: {
				draftSaved: !effectiveAt,
				baseRevision: input.baseRevision,
				operationCount: input.operations.length,
				effectiveAt: input.effectiveAt,
			},
			...requestMetadata(c),
		});
		return c.json(created, 201);
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/change-sets/preview",
		request: {
			body: {
				required: true,
				content: {
					"application/json": { schema: catalogChangeSetInputSchema },
				},
			},
		},
		responses: {
			200: {
				description: "Validated catalog change impact preview",
				content: { "application/json": { schema: previewResponseSchema } },
			},
			409: { description: "Base revision or entity version is stale" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const input = c.req.valid("json");
		try {
			const view = await loadCatalogView();
			const currentRevision = view.snapshot.revision || null;
			if (input.baseRevision !== currentRevision) {
				await db.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.preview",
					success: false,
					metadata: {
						errorCode: "stale_base_revision",
						requestedRevision: input.baseRevision,
						currentRevision,
					},
					...requestMetadata(c),
				});
				return c.json({ message: "Catalog base revision is stale" }, 409);
			}
			const applied = applyCatalogOperations({
				state: policyStateFromView(view),
				operations: input.operations,
				actor: user.id,
				updatedAt: new Date().toISOString(),
			});
			const snapshot = resolveStateSnapshot(
				view,
				applied.state,
				view.snapshot.revision + 1,
			);
			const impact = await calculateCatalogImpact(
				view,
				input.operations,
				view.snapshot,
				snapshot,
			);
			const activatingProviderIds = new Set(
				input.operations
					.filter(
						(operation) =>
							operation.type === "provider.set_policy" &&
							(operation.patch.enabled === true ||
								operation.patch.visible === true),
					)
					.map((operation) =>
						operation.type === "provider.set_policy"
							? operation.providerId
							: "",
					),
			);
			const activatingModelIds = new Set(
				input.operations
					.filter(
						(operation) =>
							operation.type === "model.set_policy" &&
							(operation.patch.enabled === true ||
								operation.patch.visible === true),
					)
					.map((operation) =>
						operation.type === "model.set_policy" ? operation.modelId : "",
					),
			);
			const inspectedMappings = snapshot.mappings.filter(
				(mapping) =>
					impact.providerIds.has(mapping.providerId) ||
					impact.modelIds.has(mapping.modelId) ||
					impact.mappingIds.has(mapping.id),
			);
			const mappingBlockers = inspectedMappings
				.filter(
					(mapping) =>
						impact.mappingIds.has(mapping.id) &&
						applied.state.mappings[mapping.id]?.enabled === true &&
						!mapping.available,
				)
				.map((mapping) => ({
					entityId: mapping.id,
					reasons: mapping.reasons.filter(
						(reason) =>
							reason !== "circuit_open" && reason !== "circuit_half_open",
					),
				}))
				.filter((blocker) => blocker.reasons.length > 0);
			const entityBlockers = [
				...[...activatingProviderIds]
					.filter(
						(providerId) =>
							!snapshot.mappings.some(
								(mapping) =>
									mapping.providerId === providerId && mapping.available,
							),
					)
					.map((entityId) => ({
						entityId,
						reasons: ["no_available_mapping"],
					})),
				...[...activatingModelIds]
					.filter(
						(modelId) =>
							!snapshot.mappings.some(
								(mapping) => mapping.modelId === modelId && mapping.available,
							),
					)
					.map((entityId) => ({
						entityId,
						reasons: ["no_available_mapping"],
					})),
				...Object.values(applied.state.models)
					.filter((policy) => {
						if (
							!impact.modelIds.has(policy.modelId) ||
							!policy.replacementModelId
						) {
							return false;
						}
						const replacement = snapshot.models.find(
							(item) => item.id === policy.replacementModelId,
						);
						return (
							!replacement?.available || replacement.lifecycle !== "active"
						);
					})
					.map((policy) => ({
						entityId: policy.modelId,
						reasons: ["replacement_model_unavailable"],
					})),
			];
			const fallbackLosses = findCatalogRoutabilityLosses(
				view.snapshot,
				snapshot,
				applied.state,
			);
			const blockers = [
				...missingOperationBlockers(view, input.operations),
				...mappingBlockers,
				...entityBlockers,
				...fallbackLosses.map((entityId) => ({
					entityId,
					reasons: ["fallback_coverage_lost"],
				})),
			];
			const response = {
				valid: blockers.length === 0,
				baseRevision: input.baseRevision,
				resultingChecksum: snapshot.checksum,
				blockers,
				warnings: [
					...(input.operations.length >= 100
						? ["High-impact bulk change requires typed confirmation"]
						: []),
					...(impact.queuedJobs > 0
						? [
								`${impact.queuedJobs} queued or in-progress jobs retain their accepted mapping and revision`,
							]
						: []),
					...(impact.scheduledConflicts.length > 0
						? [
								`Overlaps scheduled change sets: ${impact.scheduledConflicts.join(", ")}`,
							]
						: []),
					...(impact.marginEstimate && impact.requests === 0
						? [
								"Margin changed but no matching requests were found in the 24-hour impact window",
							]
						: []),
				],
				affected: {
					providers: impact.providerIds.size,
					models: impact.modelIds.size,
					mappings: inspectedMappings.length,
					credentials: impact.credentials,
					requests: impact.requests,
					organizations: impact.organizations,
					projects: impact.projects,
					apiKeys: impact.apiKeys,
					queuedJobs: impact.queuedJobs,
				},
				fallbackLosses,
				stateChanges: impact.stateChanges,
				scheduledConflicts: impact.scheduledConflicts,
				priceChanges: impact.priceChanges,
				marginEstimate: impact.marginEstimate,
			};
			await db.insert(platformAuditLog).values({
				userId: user.id,
				action: "platform_catalog.preview",
				success: true,
				metadata: {
					baseRevision: input.baseRevision,
					operationCount: input.operations.length,
					valid: response.valid,
					blockerCount: blockers.length,
				},
				...requestMetadata(c),
			});
			return c.json(response);
		} catch (error) {
			await db.insert(platformAuditLog).values({
				userId: user.id,
				action: "platform_catalog.preview",
				success: false,
				metadata: {
					errorCode: error instanceof Error ? error.name : "preview_failed",
					operationCount: input.operations.length,
				},
				...requestMetadata(c),
			});
			throw error;
		}
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/change-sets/{id}/cancel",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description: "Cancelled draft or scheduled catalog change",
				content: {
					"application/json": {
						schema: z.object({
							changeSetId: z.string(),
							state: z.literal("cancelled"),
						}),
					},
				},
			},
			404: { description: "Change set not found or not cancellable" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const changeSetId = c.req.valid("param").id;
		const [cancelled] = await db
			.update(platformCatalogChangeSet)
			.set({ state: "cancelled" })
			.where(
				and(
					eq(platformCatalogChangeSet.id, changeSetId),
					inArray(platformCatalogChangeSet.state, ["draft", "scheduled"]),
				),
			)
			.returning({ id: platformCatalogChangeSet.id });
		if (!cancelled) {
			throw new HTTPException(404, {
				message: "Change set not found or not cancellable",
			});
		}
		await db.insert(platformAuditLog).values({
			userId: user.id,
			action: "platform_catalog.cancel",
			resourceId: changeSetId,
			success: true,
			...requestMetadata(c),
		});
		return c.json({ changeSetId, state: "cancelled" as const });
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/change-sets/{id}/apply",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description: "Atomically applied catalog revision",
				content: {
					"application/json": {
						schema: z.object({
							changeSetId: z.string(),
							catalogRevision: z.number(),
							affectedEntities: z.array(z.string()),
							cacheInvalidation: z.enum(["published", "failed"]),
						}),
					},
				},
			},
			400: { description: "Change set is invalid or blocked" },
			404: { description: "Change set not found" },
			409: { description: "Change set or base revision is stale" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const changeSetId = c.req.valid("param").id;
		let result: {
			changeSetId: string;
			catalogRevision: number;
			affectedEntities: string[];
		};
		try {
			result = await db.transaction(async (tx) => {
				await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
				const view = await loadCatalogView();
				const [changeSet] = await tx
					.select()
					.from(platformCatalogChangeSet)
					.where(eq(platformCatalogChangeSet.id, changeSetId))
					.limit(1);
				if (!changeSet) {
					throw new HTTPException(404, { message: "Change set not found" });
				}
				if (changeSet.state === "applied" && changeSet.appliedRevision) {
					return {
						changeSetId,
						catalogRevision: changeSet.appliedRevision,
						affectedEntities: [],
					};
				}
				if (!new Set(["draft", "scheduled"]).has(changeSet.state)) {
					throw new HTTPException(409, {
						message: "Change set is not applyable",
					});
				}
				if (
					changeSet.effectiveAt &&
					changeSet.effectiveAt.getTime() > Date.now()
				) {
					throw new HTTPException(409, {
						message: "Scheduled change set is not due",
					});
				}
				const [latestRevision] = await tx
					.select({ id: platformCatalogRevision.id })
					.from(platformCatalogRevision)
					.orderBy(desc(platformCatalogRevision.id))
					.limit(1);
				const currentRevision = latestRevision?.id ?? null;
				if (changeSet.baseRevision !== currentRevision) {
					throw new HTTPException(409, {
						message: "Change set base revision is stale",
					});
				}
				const operations = catalogChangeSetInputSchema.shape.operations.parse(
					changeSet.operations,
				);
				const missing = missingOperationBlockers(view, operations);
				if (missing.length > 0) {
					throw new HTTPException(400, {
						message: `Catalog source entities do not exist: ${missing
							.map((item) => item.entityId)
							.join(", ")}`,
					});
				}
				const updatedAt = new Date().toISOString();
				const applied = applyCatalogOperations({
					state: policyStateFromView(view),
					operations,
					actor: user.id,
					updatedAt,
				});
				const provisionalSnapshot = resolveStateSnapshot(
					view,
					applied.state,
					0,
				);
				try {
					validateCatalogActivation(
						provisionalSnapshot,
						applied.state,
						applied.affectedEntityIds,
						view.snapshot,
					);
				} catch (error) {
					throw new HTTPException(400, {
						message:
							error instanceof Error
								? error.message
								: "Catalog activation is blocked",
					});
				}
				await tx
					.update(platformCatalogChangeSet)
					.set({ state: "applying" })
					.where(eq(platformCatalogChangeSet.id, changeSetId));
				await persistPolicyState(tx, applied.state, operations);
				const [revision] = await tx
					.insert(platformCatalogRevision)
					.values({
						changeSetId,
						appliedBy: user.id,
						checksum: provisionalSnapshot.checksum,
						snapshot: provisionalSnapshot as unknown as Record<string, unknown>,
					})
					.returning({ id: platformCatalogRevision.id });
				if (!revision) {
					throw new HTTPException(500, {
						message: "Catalog revision was not created",
					});
				}
				const snapshot = { ...provisionalSnapshot, revision: revision.id };
				await tx
					.update(platformCatalogRevision)
					.set({ snapshot: snapshot as unknown as Record<string, unknown> })
					.where(eq(platformCatalogRevision.id, revision.id));
				await tx
					.update(platformCatalogChangeSet)
					.set({
						state: "applied",
						appliedAt: new Date(updatedAt),
						appliedRevision: revision.id,
						inverseOperations:
							applied.inverseOperations as PlatformCatalogOperationV1[],
					})
					.where(eq(platformCatalogChangeSet.id, changeSetId));
				await tx.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.apply",
					resourceId: changeSetId,
					success: true,
					metadata: {
						catalogRevision: revision.id,
						checksum: snapshot.checksum,
						operationCount: operations.length,
						affectedEntityIds: applied.affectedEntityIds,
					},
					...requestMetadata(c),
				});
				return {
					changeSetId,
					catalogRevision: revision.id,
					affectedEntities: applied.affectedEntityIds,
				};
			});
		} catch (error) {
			try {
				await db.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.apply",
					resourceId: changeSetId,
					success: false,
					metadata: {
						errorCode: error instanceof Error ? error.name : "apply_failed",
						statusCode: error instanceof HTTPException ? error.status : 500,
					},
					...requestMetadata(c),
				});
			} catch {
				// Preserve the apply error if the audit store is unavailable.
			}
			throw error;
		}
		let cacheInvalidation: "published" | "failed" = "published";
		try {
			await redisClient.publish(
				CATALOG_INVALIDATION_CHANNEL,
				JSON.stringify({ revision: result.catalogRevision }),
			);
		} catch {
			cacheInvalidation = "failed";
		}
		return c.json({ ...result, cacheInvalidation });
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/change-sets/{id}/rollback/preview",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description:
					"Validate and calculate impact for an inverse catalog revision",
				content: { "application/json": { schema: previewResponseSchema } },
			},
			404: { description: "Applied change set not found" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const originalId = c.req.valid("param").id;
		const view = await loadCatalogView();
		const [original] = await db
			.select()
			.from(platformCatalogChangeSet)
			.where(eq(platformCatalogChangeSet.id, originalId))
			.limit(1);
		if (
			!original ||
			!new Set(["applied", "rolled_back"]).has(original.state) ||
			!original.inverseOperations
		) {
			throw new HTTPException(404, {
				message: "Applied change set is not rollbackable",
			});
		}
		const operations = catalogChangeSetInputSchema.shape.operations.parse(
			normalizePersistedInverseOperations(original.inverseOperations),
		);
		const missing = missingOperationBlockers(view, operations);
		const applied = applyCatalogOperations({
			state: policyStateFromView(view),
			operations,
			actor: user.id,
			updatedAt: new Date().toISOString(),
		});
		const snapshot = resolveStateSnapshot(
			view,
			applied.state,
			view.snapshot.revision + 1,
		);
		const blockers = [...missing];
		if (blockers.length === 0) {
			try {
				validateCatalogActivation(
					snapshot,
					applied.state,
					applied.affectedEntityIds,
					view.snapshot,
				);
			} catch (error) {
				blockers.push({
					entityId: "catalog",
					reasons: [
						error instanceof Error
							? error.message
							: "Rollback conflicts with current catalog state",
					],
				});
			}
		}
		const impact = await calculateCatalogImpact(
			view,
			operations,
			view.snapshot,
			snapshot,
		);
		const inspectedMappings = snapshot.mappings.filter(
			(mapping) =>
				impact.providerIds.has(mapping.providerId) ||
				impact.modelIds.has(mapping.modelId) ||
				impact.mappingIds.has(mapping.id),
		);
		const fallbackLosses = findCatalogRoutabilityLosses(
			view.snapshot,
			snapshot,
			applied.state,
		);
		blockers.push(
			...fallbackLosses.map((entityId) => ({
				entityId,
				reasons: ["fallback_coverage_lost"],
			})),
		);
		const response = {
			valid: blockers.length === 0,
			baseRevision: view.snapshot.revision || null,
			resultingChecksum: snapshot.checksum,
			blockers,
			warnings: [
				...(impact.queuedJobs > 0
					? [
							`${impact.queuedJobs} queued or in-progress jobs retain their accepted mapping and revision`,
						]
					: []),
				...(impact.scheduledConflicts.length > 0
					? [
							`Overlaps scheduled change sets: ${impact.scheduledConflicts.join(", ")}`,
						]
					: []),
			],
			affected: {
				providers: impact.providerIds.size,
				models: impact.modelIds.size,
				mappings: inspectedMappings.length,
				credentials: impact.credentials,
				requests: impact.requests,
				organizations: impact.organizations,
				projects: impact.projects,
				apiKeys: impact.apiKeys,
				queuedJobs: impact.queuedJobs,
			},
			fallbackLosses,
			stateChanges: impact.stateChanges,
			scheduledConflicts: impact.scheduledConflicts,
			priceChanges: impact.priceChanges,
			marginEstimate: impact.marginEstimate,
		};
		await db.insert(platformAuditLog).values({
			userId: user.id,
			action: "platform_catalog.preview",
			resourceId: originalId,
			success: true,
			metadata: {
				kind: "rollback",
				operationCount: operations.length,
				valid: response.valid,
			},
			...requestMetadata(c),
		});
		return c.json(response);
	},
);

platformCatalog.openapi(
	createRoute({
		method: "post",
		path: "/change-sets/{id}/rollback",
		request: { params: z.object({ id: z.string().min(1) }) },
		responses: {
			200: {
				description: "Applied an audited inverse catalog revision",
				content: {
					"application/json": {
						schema: z.object({
							changeSetId: z.string(),
							inverseOf: z.string(),
							catalogRevision: z.number(),
							cacheInvalidation: z.enum(["published", "failed"]),
						}),
					},
				},
			},
			404: { description: "Applied change set not found" },
			409: { description: "Rollback conflicts with newer policy changes" },
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const originalId = c.req.valid("param").id;
		let rollback: {
			changeSetId: string;
			inverseOf: string;
			catalogRevision: number;
		};
		try {
			rollback = await db.transaction(async (tx) => {
				await tx.execute(sql`SELECT pg_advisory_xact_lock(7220260722)`);
				const view = await loadCatalogView();
				const [original] = await tx
					.select()
					.from(platformCatalogChangeSet)
					.where(eq(platformCatalogChangeSet.id, originalId))
					.limit(1);
				if (
					!original ||
					!new Set(["applied", "rolled_back"]).has(original.state) ||
					!original.inverseOperations
				) {
					throw new HTTPException(404, {
						message: "Applied change set is not rollbackable",
					});
				}
				const [existingRollback] = await tx
					.select()
					.from(platformCatalogChangeSet)
					.where(eq(platformCatalogChangeSet.inverseOf, originalId))
					.orderBy(desc(platformCatalogChangeSet.createdAt))
					.limit(1);
				if (
					existingRollback?.state === "applied" &&
					existingRollback.appliedRevision
				) {
					return {
						changeSetId: existingRollback.id,
						inverseOf: originalId,
						catalogRevision: existingRollback.appliedRevision,
					};
				}
				const [latestRevision] = await tx
					.select({ id: platformCatalogRevision.id })
					.from(platformCatalogRevision)
					.orderBy(desc(platformCatalogRevision.id))
					.limit(1);
				const baseRevision = latestRevision?.id ?? null;
				const operations = catalogChangeSetInputSchema.shape.operations.parse(
					normalizePersistedInverseOperations(original.inverseOperations),
				);
				const missing = missingOperationBlockers(view, operations);
				if (missing.length > 0) {
					throw new HTTPException(409, {
						message: `Rollback source entities no longer exist: ${missing
							.map((item) => item.entityId)
							.join(", ")}`,
					});
				}
				const [rollbackChangeSet] = await tx
					.insert(platformCatalogChangeSet)
					.values({
						createdBy: user.id,
						title: `Rollback: ${original.title}`,
						reason: `Restore catalog state before change set ${original.id}`,
						state: "applying",
						baseRevision,
						operations: operations as PlatformCatalogOperationV1[],
						inverseOf: original.id,
						idempotencyKey: `rollback:${original.id}:${baseRevision ?? "initial"}`,
					})
					.returning({ id: platformCatalogChangeSet.id });
				if (!rollbackChangeSet) {
					throw new HTTPException(500, {
						message: "Rollback change set was not created",
					});
				}
				const updatedAt = new Date().toISOString();
				const applied = applyCatalogOperations({
					state: policyStateFromView(view),
					operations,
					actor: user.id,
					updatedAt,
				});
				const provisionalSnapshot = resolveStateSnapshot(
					view,
					applied.state,
					0,
				);
				try {
					validateCatalogActivation(
						provisionalSnapshot,
						applied.state,
						applied.affectedEntityIds,
						view.snapshot,
					);
				} catch (error) {
					throw new HTTPException(409, {
						message:
							error instanceof Error
								? error.message
								: "Rollback conflicts with current catalog state",
					});
				}
				await persistPolicyState(tx, applied.state, operations);
				const [revision] = await tx
					.insert(platformCatalogRevision)
					.values({
						changeSetId: rollbackChangeSet.id,
						appliedBy: user.id,
						checksum: provisionalSnapshot.checksum,
						snapshot: provisionalSnapshot as unknown as Record<string, unknown>,
					})
					.returning({ id: platformCatalogRevision.id });
				if (!revision) {
					throw new HTTPException(500, {
						message: "Rollback revision was not created",
					});
				}
				await tx
					.update(platformCatalogRevision)
					.set({
						snapshot: {
							...provisionalSnapshot,
							revision: revision.id,
						} as unknown as Record<string, unknown>,
					})
					.where(eq(platformCatalogRevision.id, revision.id));
				await tx
					.update(platformCatalogChangeSet)
					.set({
						state: "applied",
						appliedAt: new Date(updatedAt),
						appliedRevision: revision.id,
						inverseOperations:
							applied.inverseOperations as PlatformCatalogOperationV1[],
					})
					.where(eq(platformCatalogChangeSet.id, rollbackChangeSet.id));
				await tx
					.update(platformCatalogChangeSet)
					.set({ state: "rolled_back" })
					.where(eq(platformCatalogChangeSet.id, original.id));
				await tx.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.rollback",
					resourceId: rollbackChangeSet.id,
					success: true,
					metadata: {
						inverseOf: original.id,
						catalogRevision: revision.id,
						checksum: provisionalSnapshot.checksum,
						affectedEntityIds: applied.affectedEntityIds,
					},
					...requestMetadata(c),
				});
				return {
					changeSetId: rollbackChangeSet.id,
					inverseOf: original.id,
					catalogRevision: revision.id,
				};
			});
		} catch (error) {
			try {
				await db.insert(platformAuditLog).values({
					userId: user.id,
					action: "platform_catalog.rollback",
					resourceId: originalId,
					success: false,
					metadata: {
						errorCode: error instanceof Error ? error.name : "rollback_failed",
						statusCode: error instanceof HTTPException ? error.status : 500,
					},
					...requestMetadata(c),
				});
			} catch {
				// Preserve the rollback error if the audit store is unavailable.
			}
			throw error;
		}
		let cacheInvalidation: "published" | "failed" = "published";
		try {
			await redisClient.publish(
				CATALOG_INVALIDATION_CHANNEL,
				JSON.stringify({ revision: rollback.catalogRevision }),
			);
		} catch {
			cacheInvalidation = "failed";
		}
		return c.json({ ...rollback, cacheInvalidation });
	},
);

platformCatalog.openapi(
	createRoute({
		method: "get",
		path: "/change-sets",
		responses: {
			200: {
				description: "Catalog change-set history",
				content: {
					"application/json": {
						schema: z.array(
							z.object({
								id: z.string(),
								createdAt: z.string(),
								createdBy: z.string(),
								updatedAt: z.string(),
								title: z.string(),
								reason: z.string(),
								state: z.enum([
									"draft",
									"scheduled",
									"applying",
									"applied",
									"failed",
									"cancelled",
									"rolled_back",
								]),
								baseRevision: z.number().nullable(),
								appliedRevision: z.number().nullable(),
								effectiveAt: z.string().nullable(),
								appliedAt: z.string().nullable(),
							}),
						),
					},
				},
			},
		},
	}),
	async (c) => {
		const rows = await db
			.select()
			.from(platformCatalogChangeSet)
			.orderBy(desc(platformCatalogChangeSet.createdAt))
			.limit(200);
		return c.json(
			rows.map((row) => ({
				...row,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				effectiveAt: row.effectiveAt?.toISOString() ?? null,
				appliedAt: row.appliedAt?.toISOString() ?? null,
			})),
		);
	},
);

export default platformCatalog;
