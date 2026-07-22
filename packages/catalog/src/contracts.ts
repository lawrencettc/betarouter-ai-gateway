import { z } from "zod";

const idSchema = z.string().trim().min(1).max(255);
const expectedUpdatedAtSchema = z.string().datetime().nullable();
const optionalDateSchema = z.string().datetime().nullable().optional();
const lifecycleSchema = z.enum(["draft", "active", "deprecated", "retired"]);
const decimalStringSchema = z
	.string()
	.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE]\+?\d+)?$/);

export const fixedPricesV1Schema = z
	.object({
		version: z.literal(1),
		inputPerMillionTokens: decimalStringSchema.optional(),
		outputPerMillionTokens: decimalStringSchema.optional(),
		cachedInputPerMillionTokens: decimalStringSchema.optional(),
		cacheWritePerMillionTokens: decimalStringSchema.optional(),
		cacheWrite1hPerMillionTokens: decimalStringSchema.optional(),
		imageInput: decimalStringSchema.optional(),
		imageOutput: decimalStringSchema.optional(),
		request: decimalStringSchema.optional(),
		webSearch: decimalStringSchema.optional(),
		audioOutputPerMillionTokens: decimalStringSchema.optional(),
		ocrPage: decimalStringSchema.optional(),
		inputPerMillionCharacters: decimalStringSchema.optional(),
		perSecondByResolution: z.record(idSchema, decimalStringSchema).optional(),
	})
	.strict();

export const providerPolicyPatchSchema = z
	.object({
		visible: z.boolean().optional(),
		enabled: z.boolean().optional(),
		displayNameOverride: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.nullable()
			.optional(),
		descriptionOverride: z.string().max(10_000).nullable().optional(),
		websiteOverride: z.string().url().nullable().optional(),
		sortOrder: z.number().int().min(0).max(1_000_000).optional(),
		lifecycle: lifecycleSchema.optional(),
		deprecatedAt: optionalDateSchema,
		retireAt: optionalDateSchema,
		replacementProviderId: idSchema.nullable().optional(),
	})
	.strict();

export const modelPolicyPatchSchema = z
	.object({
		visible: z.boolean().optional(),
		enabled: z.boolean().optional(),
		allowDirect: z.boolean().optional(),
		displayNameOverride: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.nullable()
			.optional(),
		descriptionOverride: z.string().max(10_000).nullable().optional(),
		aliasesOverride: z.array(idSchema).max(100).nullable().optional(),
		sortOrder: z.number().int().min(0).max(1_000_000).optional(),
		lifecycle: lifecycleSchema.optional(),
		deprecatedAt: optionalDateSchema,
		retireAt: optionalDateSchema,
		replacementModelId: idSchema.nullable().optional(),
		retirementMessage: z.string().max(2_000).nullable().optional(),
	})
	.strict();

export const mappingPolicyPatchSchema = z
	.object({
		enabled: z.boolean().optional(),
		externalIdOverride: idSchema.nullable().optional(),
		contextSizeLimit: z.number().int().positive().nullable().optional(),
		maxOutputLimit: z.number().int().positive().nullable().optional(),
		disabledCapabilities: z.array(idSchema).max(100).optional(),
		priority: z.number().int().min(0).max(1_000_000).optional(),
		weight: z.number().int().min(0).max(10_000).optional(),
		breakerEnabled: z.boolean().optional(),
		requiredTestRevision: idSchema.nullable().optional(),
	})
	.strict();

const sourceCostPriceSchema = z
	.object({
		mode: z.literal("source_cost"),
		currency: z.literal("USD").default("USD"),
		allowNegativeMargin: z.literal(false).default(false),
		negativeMarginReason: z.null().optional(),
	})
	.strict();
const markupPriceSchema = z
	.object({
		mode: z.literal("markup"),
		currency: z.literal("USD").default("USD"),
		markupBps: z.number().int().min(-10_000).max(100_000),
		allowNegativeMargin: z.boolean().default(false),
		negativeMarginReason: z.string().trim().min(1).max(2_000).optional(),
	})
	.strict()
	.refine((value) => !value.allowNegativeMargin || value.negativeMarginReason, {
		message: "A reason is required to allow negative margin",
	});
const fixedPriceSchema = z
	.object({
		mode: z.literal("fixed"),
		currency: z.literal("USD").default("USD"),
		fixedPrices: fixedPricesV1Schema,
		allowNegativeMargin: z.boolean().default(false),
		negativeMarginReason: z.string().trim().min(1).max(2_000).optional(),
	})
	.strict()
	.refine((value) => !value.allowNegativeMargin || value.negativeMarginReason, {
		message: "A reason is required to allow negative margin",
	});

export const mappingPricePolicySchema = z.union([
	sourceCostPriceSchema,
	markupPriceSchema,
	fixedPriceSchema,
]);

const operationBase = {
	version: z.literal(1),
	expectedUpdatedAt: expectedUpdatedAtSchema,
};

export const catalogOperationV1Schema = z.discriminatedUnion("type", [
	z
		.object({
			...operationBase,
			type: z.literal("provider.set_policy"),
			providerId: idSchema,
			patch: providerPolicyPatchSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("model.set_policy"),
			modelId: idSchema,
			patch: modelPolicyPatchSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("mapping.set_policy"),
			mappingId: idSchema,
			patch: mappingPolicyPatchSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("mapping.set_price_policy"),
			mappingId: idSchema,
			policy: mappingPricePolicySchema,
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			type: z.literal("mapping.clear_price_policy"),
			mappingId: idSchema,
			expectedUpdatedAt: z.string().datetime(),
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("mapping.set_external_id"),
			mappingId: idSchema,
			externalId: idSchema.nullable(),
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			type: z.literal("entity.archive_policy"),
			entityType: z.enum(["provider", "model", "mapping"]),
			entityId: idSchema,
			expectedUpdatedAt: z.string().datetime(),
		})
		.strict(),
]);

export const catalogChangeSetInputSchema = z
	.object({
		title: z.string().trim().min(1).max(255),
		reason: z.string().trim().min(1).max(2_000),
		baseRevision: z.number().int().positive().nullable(),
		effectiveAt: z.string().datetime().nullable(),
		idempotencyKey: z.string().trim().min(8).max(255),
		operations: z.array(catalogOperationV1Schema).min(1).max(500),
	})
	.strict();

export type CatalogOperationV1 = z.infer<typeof catalogOperationV1Schema>;
export type CatalogChangeSetInput = z.infer<typeof catalogChangeSetInputSchema>;
