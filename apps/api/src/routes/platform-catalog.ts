import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { platformAdminMiddleware } from "@/middleware/admin.js";

import {
	applyCatalogOperations,
	catalogChangeSetInputSchema,
	mappingPricePolicySchema,
	resolveEffectiveCatalog,
} from "@llmgateway/catalog";
import {
	db,
	model,
	modelProviderMapping,
	platformCatalogChangeSet,
	platformCatalogRevision,
	platformAuditLog,
	platformMappingPolicy,
	platformMappingPricePolicy,
	platformMappingTestRun,
	platformModelPolicy,
	platformProviderCredential,
	platformProviderPolicy,
	provider,
} from "@llmgateway/db";
import { getProviderEnvConfig, getProviderEnvVar } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type {
	CatalogLifecycle,
	CatalogPolicyState,
	EffectiveCatalog,
	MappingPolicy,
	ModelPolicy,
	ProviderPolicy,
} from "@llmgateway/catalog";
import type { Provider } from "@llmgateway/models";

const platformCatalog = new OpenAPIHono<ServerTypes>();
platformCatalog.use("/*", platformAdminMiddleware);

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
});
const effectiveMappingSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	modelId: z.string(),
	externalId: z.string(),
	displayable: z.boolean(),
	available: z.boolean(),
	routable: z.boolean(),
	probeOnly: z.boolean(),
	priority: z.number(),
	weight: z.number(),
	reasons: z.array(z.string()),
});
const listQuerySchema = z.object({
	search: z.string().optional(),
	state: z
		.enum(["all", "visible", "hidden", "available", "unavailable"])
		.default("all"),
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
		requests: z.number().nullable(),
		organizations: z.number().nullable(),
		projects: z.number().nullable(),
		apiKeys: z.number().nullable(),
		queuedJobs: z.number().nullable(),
	}),
	fallbackLosses: z.array(z.string()),
	priceChanges: z.array(z.string()),
	marginEstimate: z.string().nullable(),
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
	};
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
	passedTests: Set<string>;
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
			.select({ provider: platformProviderCredential.provider })
			.from(platformProviderCredential)
			.where(eq(platformProviderCredential.status, "active")),
		db
			.select({
				mappingId: platformMappingTestRun.mappingId,
				testProfile: platformMappingTestRun.testProfile,
			})
			.from(platformMappingTestRun)
			.where(eq(platformMappingTestRun.status, "passed")),
		db
			.select({ id: platformCatalogRevision.id })
			.from(platformCatalogRevision)
			.orderBy(desc(platformCatalogRevision.id))
			.limit(1),
	]);
	const credentialProviders = new Set(credentials.map((item) => item.provider));
	const priceMappingIds = new Set(pricePolicies.map((item) => item.mappingId));
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
			deprecatedAt: item.deprecatedAt,
			deactivatedAt: item.deactivatedAt,
		})),
		providerPolicies: providerPolicies.map(toProviderPolicy),
		modelPolicies: modelPolicies.map(toModelPolicy),
		mappingPolicies: mappingPolicies.map(toMappingPolicy),
		providerCredentialAvailability: credentialAvailability,
		mappingReadiness: Object.fromEntries(
			sourceMappings.map((item) => {
				const requiredTestRevision = mappingPolicyById.get(
					item.id,
				)?.requiredTestRevision;
				return [
					item.id,
					{
						priceReady: priceMappingIds.has(item.id),
						testPassed:
							!requiredTestRevision ||
							passedTests.has(`${item.id}:${requiredTestRevision}`),
					},
				];
			}),
		),
		breakerStates: {},
	});
	return {
		snapshot,
		sourceProviders,
		sourceModels,
		sourceMappings,
		providerPolicies,
		modelPolicies,
		mappingPolicies,
		pricePolicies,
		credentialAvailability,
		passedTests,
	};
}

type CatalogView = Awaited<ReturnType<typeof loadCatalogView>>;

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
				{ ...row, updatedAt: row.updatedAt.toISOString() },
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
		})),
		mappingPolicies: Object.values(state.mappings).map((item) => ({
			mappingId: item.mappingId,
			enabled: item.enabled,
			priority: item.priority ?? 100,
			weight: item.weight ?? 100,
			breakerEnabled: item.breakerEnabled ?? true,
			externalIdOverride: item.externalIdOverride,
		})),
		providerCredentialAvailability: view.credentialAvailability,
		mappingReadiness: Object.fromEntries(
			view.sourceMappings.map((item) => {
				const requiredTestRevision =
					state.mappings[item.id]?.requiredTestRevision;
				return [
					item.id,
					{
						priceReady: Boolean(state.prices[item.id]),
						testPassed:
							!requiredTestRevision ||
							view.passedTests.has(`${item.id}:${requiredTestRevision}`),
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

function filterEffective<
	T extends { id: string; visible?: boolean; available: boolean },
>(items: T[], query: z.infer<typeof listQuerySchema>): T[] {
	const search = query.search?.trim().toLowerCase();
	return items.filter((item) => {
		if (search && !item.id.toLowerCase().includes(search)) {
			return false;
		}
		switch (query.state) {
			case "visible":
				return item.visible === true;
			case "hidden":
				return item.visible === false;
			case "available":
				return item.available;
			case "unavailable":
				return !item.available;
			case "all":
				return true;
			default:
				return false;
		}
	});
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
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const { snapshot } = await loadCatalogView();
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
		});
	},
);

for (const definition of [
	{ path: "/providers", key: "providers", schema: effectiveProviderSchema },
	{ path: "/models", key: "models", schema: effectiveModelSchema },
	{ path: "/mappings", key: "mappings", schema: effectiveMappingSchema },
] as const) {
	platformCatalog.openapi(
		createRoute({
			method: "get",
			path: definition.path,
			request: { query: listQuerySchema },
			responses: {
				200: {
					description: "Paginated effective catalog entities",
					content: {
						"application/json": {
							schema: z.object({
								items: z.array(definition.schema),
								total: z.number(),
								page: z.number(),
								pageSize: z.number(),
								revision: z.number(),
								checksum: z.string(),
							}),
						},
					},
				},
			},
		}),
		async (c) => {
			const query = c.req.valid("query");
			const { snapshot } = await loadCatalogView();
			const items = filterEffective(snapshot[definition.key], query);
			return c.json({
				...paginate(items, query.page, query.pageSize),
				revision: snapshot.revision,
				checksum: snapshot.checksum,
			});
		},
	);
}

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
			const activatingMappingIds = new Set(
				input.operations
					.filter(
						(operation) =>
							operation.type === "mapping.set_policy" &&
							operation.patch.enabled === true,
					)
					.map((operation) =>
						operation.type === "mapping.set_policy" ? operation.mappingId : "",
					),
			);
			const inspectedMappings = snapshot.mappings.filter(
				(mapping) =>
					activatingProviderIds.has(mapping.providerId) ||
					activatingModelIds.has(mapping.modelId) ||
					activatingMappingIds.has(mapping.id),
			);
			const blockers = inspectedMappings
				.filter((mapping) => !mapping.available)
				.map((mapping) => ({
					entityId: mapping.id,
					reasons: mapping.reasons.filter(
						(reason) =>
							reason !== "circuit_open" && reason !== "circuit_half_open",
					),
				}))
				.filter((blocker) => blocker.reasons.length > 0);
			const fallbackLosses = snapshot.models
				.filter(
					(item) =>
						item.available &&
						!snapshot.mappings.some(
							(mapping) => mapping.modelId === item.id && mapping.routable,
						),
				)
				.map((item) => item.id);
			const entityTypes = new Set(
				input.operations.map((operation) => {
					if (operation.type.startsWith("provider.")) {
						return "provider";
					}
					if (operation.type.startsWith("model.")) {
						return "model";
					}
					if (operation.type === "entity.archive_policy") {
						return operation.entityType;
					}
					return "mapping";
				}),
			);
			const response = {
				valid: blockers.length === 0,
				baseRevision: input.baseRevision,
				resultingChecksum: snapshot.checksum,
				blockers,
				warnings:
					input.operations.length >= 100
						? ["High-impact bulk change requires typed confirmation"]
						: [],
				affected: {
					providers: entityTypes.has("provider")
						? activatingProviderIds.size
						: 0,
					models: entityTypes.has("model") ? activatingModelIds.size : 0,
					mappings: inspectedMappings.length,
					requests: null,
					organizations: null,
					projects: null,
					apiKeys: null,
					queuedJobs: null,
				},
				fallbackLosses,
				priceChanges: input.operations
					.filter((operation) => operation.type === "mapping.set_price_policy")
					.map((operation) =>
						operation.type === "mapping.set_price_policy"
							? operation.mappingId
							: "",
					),
				marginEstimate: null,
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
		method: "get",
		path: "/change-sets",
		responses: {
			200: {
				description: "Catalog change-set history",
				content: {
					"application/json": {
						schema: z.array(z.record(z.string(), z.unknown())),
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
		return c.json(rows);
	},
);

export default platformCatalog;
