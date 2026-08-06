import { z } from "zod";

const idSchema = z.string().trim().min(1).max(255);
const expectedUpdatedAtSchema = z.string().datetime().nullable();
const optionalDateSchema = z.string().datetime().nullable().optional();
const lifecycleSchema = z.enum(["draft", "active", "deprecated", "retired"]);
const decimalStringSchema = z
	.string()
	.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE]\+?\d+)?$/);
// Mirror-unit (per-token) price strings need negative exponents ("1.4e-6").
const sourceDecimalStringSchema = z
	.string()
	.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
// Created entity ids become model-input syntax ("provider/model:region"), so
// separators used by parsing are excluded outright.
const createdEntityIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

const fixedPricesV1Fields = {
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
	audioHour: decimalStringSchema.optional(),
	perSecondByResolution: z.record(idSchema, decimalStringSchema).optional(),
};

export const fixedPricesV1Schema = z
	.object({
		version: z.literal(1),
		...fixedPricesV1Fields,
	})
	.strict();

export const fixedPricesV2Schema = z
	.object({
		version: z.literal(2),
		...fixedPricesV1Fields,
		cacheReadPerMillionTokens: decimalStringSchema.optional(),
		cachedImageInputPerMillionTokens: decimalStringSchema.optional(),
		cachedAudioInputPerMillionTokens: decimalStringSchema.optional(),
		audioInputPerMillionTokens: decimalStringSchema.optional(),
	})
	.strict();

export const fixedPricesSchema = z.union([
	fixedPricesV1Schema,
	fixedPricesV2Schema,
]);

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

export const disabledCapabilitySchema = z.enum([
	"streaming",
	"vision",
	"audio",
	"document",
	"reasoning",
	"tools",
	"jsonOutput",
	"webSearch",
	"embeddings",
	"imageGenerations",
	"videoGenerations",
	"speechGenerations",
	"ocr",
	"supportsResponsesApi",
]);

export type DisabledCatalogCapability = z.infer<
	typeof disabledCapabilitySchema
>;

export const mappingPolicyPatchSchema = z
	.object({
		enabled: z.boolean().optional(),
		externalIdOverride: idSchema.nullable().optional(),
		contextSizeLimit: z.number().int().positive().nullable().optional(),
		maxOutputLimit: z.number().int().positive().nullable().optional(),
		disabledCapabilities: z.array(disabledCapabilitySchema).max(14).optional(),
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
		fixedPrices: fixedPricesSchema,
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

// "provider-specific" is deliberately absent: that protocol marks bespoke
// code-keyed transports, so a provider on it can never be defined (or
// redefined) as data.
const dataProtocolSchema = z.enum([
	"openai-chat",
	"anthropic-messages",
	"google-generative",
	"bedrock-converse",
]);

// Mirror-shaped pricing tier: prices are per-token strings and an unbounded
// top tier is `upToTokens: null` (JSON cannot represent Infinity).
const mappingPricingTierSchema = z
	.object({
		name: z.string().trim().min(1).max(64),
		upToTokens: z.number().int().positive().nullable(),
		inputPrice: sourceDecimalStringSchema,
		outputPrice: sourceDecimalStringSchema,
		cachedInputPrice: sourceDecimalStringSchema.optional(),
		cacheReadInputPrice: sourceDecimalStringSchema.optional(),
		cacheWriteInputPrice: sourceDecimalStringSchema.optional(),
		cacheWriteInputPrice1h: sourceDecimalStringSchema.optional(),
	})
	.strict();

const requireOverrideField = {
	message: "At least one override field is required",
};

const requireUpdateField = {
	message: "At least one update field is required",
};

/**
 * Compliance attestations (`dataPolicy`, `headquarters`) are intentionally
 * not overridable while the console has a single operator role; the strict
 * schemas reject them. Identity (`id`, `source`, `status`) and stats fields
 * are equally out of scope.
 */
export const providerSourceOverridePatchSchema = z
	.object({
		name: z.string().trim().min(1).max(255).nullable().optional(),
		description: z.string().max(10_000).nullable().optional(),
		streaming: z.boolean().nullable().optional(),
		cancellation: z.boolean().nullable().optional(),
		color: z.string().trim().min(1).max(64).nullable().optional(),
		website: z.string().url().nullable().optional(),
		announcement: z.string().max(2_000).nullable().optional(),
		protocol: dataProtocolSchema.nullable().optional(),
		priority: z.number().min(0).max(1_000_000).nullable().optional(),
		contentFilter: z.boolean().nullable().optional(),
		maxTemperature: z.number().min(0).max(10).nullable().optional(),
		serviceTiers: z
			.array(z.record(z.string(), z.unknown()))
			.max(10)
			.nullable()
			.optional(),
		regionConfig: z.record(z.string(), z.unknown()).nullable().optional(),
		termsUrl: z.string().url().nullable().optional(),
		privacyPolicyUrl: z.string().url().nullable().optional(),
		statusPageUrl: z.string().url().nullable().optional(),
		apiKeyInstructions: z.string().max(10_000).nullable().optional(),
		modelCardBadge: z.string().trim().min(1).max(255).nullable().optional(),
		additionalLinks: z
			.array(z.record(z.string(), z.unknown()))
			.max(20)
			.nullable()
			.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, requireOverrideField);

export const modelSourceOverridePatchSchema = z
	.object({
		name: z.string().trim().min(1).max(255).nullable().optional(),
		family: z.string().trim().min(1).max(255).nullable().optional(),
		aliases: z.array(idSchema).max(100).nullable().optional(),
		output: z
			.array(z.string().trim().min(1).max(64))
			.max(10)
			.nullable()
			.optional(),
		free: z.boolean().nullable().optional(),
		imageInputRequired: z.boolean().nullable().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, requireOverrideField);

/**
 * `externalId` is intentionally absent — the mapping policy's
 * `externalIdOverride` already owns that override, and two override paths for
 * one field would race. Price fields use mirror units (per-token strings, the
 * same `e-6` notation the code catalogue uses) so the recorded base value
 * stays directly comparable to the mirror row.
 */
export const mappingSourceOverridePatchSchema = z
	.object({
		contextSize: z.number().int().positive().nullable().optional(),
		maxOutput: z.number().int().positive().nullable().optional(),
		streaming: z.boolean().nullable().optional(),
		vision: z.boolean().nullable().optional(),
		reasoning: z.boolean().nullable().optional(),
		reasoningMaxTokens: z.boolean().nullable().optional(),
		tools: z.boolean().nullable().optional(),
		jsonOutput: z.boolean().nullable().optional(),
		jsonOutputSchema: z.boolean().nullable().optional(),
		webSearch: z.boolean().nullable().optional(),
		embeddings: z.boolean().nullable().optional(),
		imageGenerations: z.boolean().nullable().optional(),
		videoGenerations: z.boolean().nullable().optional(),
		speechGenerations: z.boolean().nullable().optional(),
		transcriptions: z.boolean().nullable().optional(),
		realtime: z.boolean().nullable().optional(),
		realtimeTranscription: z.boolean().nullable().optional(),
		ocr: z.boolean().nullable().optional(),
		rerank: z.boolean().nullable().optional(),
		supportedParameters: z.array(idSchema).max(100).nullable().optional(),
		pricingTiers: z
			.array(mappingPricingTierSchema)
			.min(1)
			.max(10)
			.nullable()
			.optional(),
		serviceTierMultipliers: z
			.record(idSchema, z.number().positive().max(100))
			.nullable()
			.optional(),
		inputPrice: sourceDecimalStringSchema.nullable().optional(),
		outputPrice: sourceDecimalStringSchema.nullable().optional(),
		cachedInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cacheReadInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cacheWriteInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cacheWriteInputPrice1h: sourceDecimalStringSchema.nullable().optional(),
		imageInputPrice: sourceDecimalStringSchema.nullable().optional(),
		imageOutputPrice: sourceDecimalStringSchema.nullable().optional(),
		inputAudioPrice: sourceDecimalStringSchema.nullable().optional(),
		cachedImageInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cachedInputAudioPrice: sourceDecimalStringSchema.nullable().optional(),
		outputAudioPrice: sourceDecimalStringSchema.nullable().optional(),
		inputCharacterPrice: sourceDecimalStringSchema.nullable().optional(),
		ocrPagePrice: sourceDecimalStringSchema.nullable().optional(),
		inputAudioHourPrice: sourceDecimalStringSchema.nullable().optional(),
		requestPrice: sourceDecimalStringSchema.nullable().optional(),
		webSearchPrice: sourceDecimalStringSchema.nullable().optional(),
		perSecondPrice: z
			.record(idSchema, sourceDecimalStringSchema)
			.nullable()
			.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, requireOverrideField);

/**
 * Direct edits to admin-created (`source: 'admin'`) rows — decision 2 of the
 * plan: they have no code counterpart, so there is no mirror to override and
 * the source row itself is the authority. Field coverage deliberately equals
 * the corresponding create schema (what can be set at create time can be
 * edited afterwards); nullability mirrors the database columns, not the
 * override schemas, because `null` here means "store NULL", not "clear an
 * override". Identity fields (ids, mapping model/provider/region) and
 * compliance attestations stay immutable.
 */
export const providerUpdateSchema = z
	.object({
		name: z.string().trim().min(1).max(255).optional(),
		description: z.string().max(10_000).optional(),
		protocol: dataProtocolSchema.optional(),
		streaming: z.boolean().nullable().optional(),
		cancellation: z.boolean().nullable().optional(),
		color: z.string().trim().min(1).max(64).nullable().optional(),
		website: z.string().url().nullable().optional(),
		announcement: z.string().max(2_000).nullable().optional(),
		priority: z.number().min(0).max(1_000_000).nullable().optional(),
		contentFilter: z.boolean().nullable().optional(),
		maxTemperature: z.number().min(0).max(10).nullable().optional(),
		termsUrl: z.string().url().nullable().optional(),
		privacyPolicyUrl: z.string().url().nullable().optional(),
		statusPageUrl: z.string().url().nullable().optional(),
		apiKeyInstructions: z.string().max(10_000).nullable().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, requireUpdateField);

export const modelUpdateSchema = z
	.object({
		name: z.string().trim().min(1).max(255).optional(),
		description: z.string().max(10_000).optional(),
		family: z.string().trim().min(1).max(255).optional(),
		aliases: z.array(idSchema).max(100).optional(),
		output: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
		free: z.boolean().optional(),
		imageInputRequired: z.boolean().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, requireUpdateField);

export const mappingUpdateSchema = z
	.object({
		externalId: idSchema.optional(),
		contextSize: z.number().int().positive().nullable().optional(),
		maxOutput: z.number().int().positive().nullable().optional(),
		streaming: z.boolean().optional(),
		vision: z.boolean().nullable().optional(),
		reasoning: z.boolean().nullable().optional(),
		reasoningMaxTokens: z.boolean().optional(),
		tools: z.boolean().nullable().optional(),
		jsonOutput: z.boolean().optional(),
		jsonOutputSchema: z.boolean().optional(),
		webSearch: z.boolean().optional(),
		embeddings: z.boolean().optional(),
		imageGenerations: z.boolean().optional(),
		videoGenerations: z.boolean().optional(),
		speechGenerations: z.boolean().optional(),
		transcriptions: z.boolean().optional(),
		realtime: z.boolean().optional(),
		realtimeTranscription: z.boolean().optional(),
		ocr: z.boolean().optional(),
		rerank: z.boolean().optional(),
		supportedParameters: z.array(idSchema).max(100).nullable().optional(),
		pricingTiers: z
			.array(mappingPricingTierSchema)
			.min(1)
			.max(10)
			.nullable()
			.optional(),
		serviceTierMultipliers: z
			.record(idSchema, z.number().positive().max(100))
			.nullable()
			.optional(),
		inputPrice: sourceDecimalStringSchema.nullable().optional(),
		outputPrice: sourceDecimalStringSchema.nullable().optional(),
		cachedInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cacheReadInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cacheWriteInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cacheWriteInputPrice1h: sourceDecimalStringSchema.nullable().optional(),
		imageInputPrice: sourceDecimalStringSchema.nullable().optional(),
		imageOutputPrice: sourceDecimalStringSchema.nullable().optional(),
		inputAudioPrice: sourceDecimalStringSchema.nullable().optional(),
		cachedImageInputPrice: sourceDecimalStringSchema.nullable().optional(),
		cachedInputAudioPrice: sourceDecimalStringSchema.nullable().optional(),
		outputAudioPrice: sourceDecimalStringSchema.nullable().optional(),
		inputCharacterPrice: sourceDecimalStringSchema.nullable().optional(),
		ocrPagePrice: sourceDecimalStringSchema.nullable().optional(),
		inputAudioHourPrice: sourceDecimalStringSchema.nullable().optional(),
		requestPrice: sourceDecimalStringSchema.nullable().optional(),
		webSearchPrice: sourceDecimalStringSchema.nullable().optional(),
		perSecondPrice: z
			.record(idSchema, sourceDecimalStringSchema)
			.nullable()
			.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, requireUpdateField);

export const providerCreateSchema = z
	.object({
		providerId: createdEntityIdSchema,
		name: z.string().trim().min(1).max(255),
		description: z.string().max(10_000).default(""),
		protocol: dataProtocolSchema,
		streaming: z.boolean().optional(),
		cancellation: z.boolean().optional(),
		color: z.string().trim().min(1).max(64).optional(),
		website: z.string().url().optional(),
		announcement: z.string().max(2_000).optional(),
		priority: z.number().min(0).max(1_000_000).optional(),
		contentFilter: z.boolean().optional(),
		maxTemperature: z.number().min(0).max(10).optional(),
		termsUrl: z.string().url().optional(),
		privacyPolicyUrl: z.string().url().optional(),
		statusPageUrl: z.string().url().optional(),
		apiKeyInstructions: z.string().max(10_000).optional(),
	})
	.strict();

export const modelCreateSchema = z
	.object({
		modelId: createdEntityIdSchema,
		family: z.string().trim().min(1).max(255),
		name: z.string().trim().min(1).max(255).optional(),
		description: z.string().max(10_000).optional(),
		aliases: z.array(idSchema).max(100).optional(),
		output: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
		free: z.boolean().optional(),
		imageInputRequired: z.boolean().optional(),
	})
	.strict();

export const mappingCreateSchema = z
	.object({
		modelId: idSchema,
		providerId: idSchema,
		externalId: idSchema,
		region: z.string().trim().min(1).max(64).nullable().optional(),
		contextSize: z.number().int().positive().optional(),
		maxOutput: z.number().int().positive().optional(),
		streaming: z.boolean().optional(),
		vision: z.boolean().optional(),
		reasoning: z.boolean().optional(),
		reasoningMaxTokens: z.boolean().optional(),
		tools: z.boolean().optional(),
		jsonOutput: z.boolean().optional(),
		jsonOutputSchema: z.boolean().optional(),
		webSearch: z.boolean().optional(),
		embeddings: z.boolean().optional(),
		imageGenerations: z.boolean().optional(),
		videoGenerations: z.boolean().optional(),
		speechGenerations: z.boolean().optional(),
		transcriptions: z.boolean().optional(),
		realtime: z.boolean().optional(),
		realtimeTranscription: z.boolean().optional(),
		ocr: z.boolean().optional(),
		rerank: z.boolean().optional(),
		supportedParameters: z.array(idSchema).max(100).optional(),
		pricingTiers: z.array(mappingPricingTierSchema).min(1).max(10).optional(),
		serviceTierMultipliers: z
			.record(idSchema, z.number().positive().max(100))
			.optional(),
		inputPrice: sourceDecimalStringSchema.optional(),
		outputPrice: sourceDecimalStringSchema.optional(),
		cachedInputPrice: sourceDecimalStringSchema.optional(),
		cacheReadInputPrice: sourceDecimalStringSchema.optional(),
		cacheWriteInputPrice: sourceDecimalStringSchema.optional(),
		cacheWriteInputPrice1h: sourceDecimalStringSchema.optional(),
		imageInputPrice: sourceDecimalStringSchema.optional(),
		imageOutputPrice: sourceDecimalStringSchema.optional(),
		inputAudioPrice: sourceDecimalStringSchema.optional(),
		cachedImageInputPrice: sourceDecimalStringSchema.optional(),
		cachedInputAudioPrice: sourceDecimalStringSchema.optional(),
		outputAudioPrice: sourceDecimalStringSchema.optional(),
		inputCharacterPrice: sourceDecimalStringSchema.optional(),
		ocrPagePrice: sourceDecimalStringSchema.optional(),
		inputAudioHourPrice: sourceDecimalStringSchema.optional(),
		requestPrice: sourceDecimalStringSchema.optional(),
		webSearchPrice: sourceDecimalStringSchema.optional(),
		perSecondPrice: z.record(idSchema, sourceDecimalStringSchema).optional(),
	})
	.strict();

/**
 * Deterministic id for an admin-created mapping. Preview and apply must
 * derive the identical id (it is embedded in the snapshot and therefore the
 * checksum), so it is a pure function of the mapping's uniqueness key.
 */
export function adminMappingId(input: {
	modelId: string;
	providerId: string;
	region?: string | null;
}): string {
	return `adm:${input.modelId}:${input.providerId}${
		input.region ? `:${input.region}` : ""
	}`;
}

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
	z
		.object({
			...operationBase,
			type: z.literal("provider.set_source_override"),
			providerId: idSchema,
			patch: providerSourceOverridePatchSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("model.set_source_override"),
			modelId: idSchema,
			patch: modelSourceOverridePatchSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("mapping.set_source_override"),
			mappingId: idSchema,
			patch: mappingSourceOverridePatchSchema,
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			type: z.literal("provider.clear_source_override"),
			providerId: idSchema,
			expectedUpdatedAt: z.string().datetime(),
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			type: z.literal("model.clear_source_override"),
			modelId: idSchema,
			expectedUpdatedAt: z.string().datetime(),
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			type: z.literal("mapping.clear_source_override"),
			mappingId: idSchema,
			expectedUpdatedAt: z.string().datetime(),
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("provider.update"),
			providerId: idSchema,
			patch: providerUpdateSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("model.update"),
			modelId: idSchema,
			patch: modelUpdateSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("mapping.update"),
			mappingId: idSchema,
			patch: mappingUpdateSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("provider.create"),
			create: providerCreateSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("model.create"),
			create: modelCreateSchema,
		})
		.strict(),
	z
		.object({
			...operationBase,
			type: z.literal("mapping.create"),
			create: mappingCreateSchema,
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
export type FixedPricesInput = z.infer<typeof fixedPricesSchema>;
export type ProviderSourceOverridePatch = z.infer<
	typeof providerSourceOverridePatchSchema
>;
export type ModelSourceOverridePatch = z.infer<
	typeof modelSourceOverridePatchSchema
>;
export type MappingSourceOverridePatch = z.infer<
	typeof mappingSourceOverridePatchSchema
>;
export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;
export type ModelCreateInput = z.infer<typeof modelCreateSchema>;
export type MappingCreateInput = z.infer<typeof mappingCreateSchema>;
export type ProviderUpdatePatch = z.infer<typeof providerUpdateSchema>;
export type ModelUpdatePatch = z.infer<typeof modelUpdateSchema>;
export type MappingUpdatePatch = z.infer<typeof mappingUpdateSchema>;
