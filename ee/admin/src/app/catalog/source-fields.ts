/**
 * Field descriptors for the catalog source editor. One list per entity kind,
 * mirroring the change-set contract schemas: `overridable` marks fields the
 * `*.set_source_override` patch accepts (static rows), `updatable` marks
 * fields the `*.update` patch accepts (admin-created rows), and `nullable`
 * describes the database column so direct updates know whether an explicit
 * NULL is storable. Override patches use `null` to clear a field's override
 * instead, so nullability never applies there.
 */
export type SourceFieldInput =
	| "text"
	| "textarea"
	| "url"
	| "boolean"
	| "number"
	| "integer"
	| "decimal"
	| "csv"
	| "json"
	| "select";

export interface SourceFieldDescriptor {
	key: string;
	label: string;
	input: SourceFieldInput;
	options?: readonly string[];
	nullable: boolean;
	overridable: boolean;
	updatable: boolean;
}

export const CATALOG_DATA_PROTOCOLS = [
	"openai-chat",
	"anthropic-messages",
	"google-generative",
	"bedrock-converse",
] as const;

export const PROVIDER_SOURCE_FIELDS: SourceFieldDescriptor[] = [
	{
		key: "name",
		label: "Name",
		input: "text",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "description",
		label: "Description",
		input: "textarea",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "protocol",
		label: "Protocol",
		input: "select",
		options: CATALOG_DATA_PROTOCOLS,
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "streaming",
		label: "Streaming",
		input: "boolean",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "cancellation",
		label: "Cancellation",
		input: "boolean",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "color",
		label: "Color",
		input: "text",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "website",
		label: "Website",
		input: "url",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "announcement",
		label: "Announcement",
		input: "textarea",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "priority",
		label: "Priority",
		input: "number",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "contentFilter",
		label: "Content filter",
		input: "boolean",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "maxTemperature",
		label: "Max temperature",
		input: "number",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "termsUrl",
		label: "Terms URL",
		input: "url",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "privacyPolicyUrl",
		label: "Privacy policy URL",
		input: "url",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "statusPageUrl",
		label: "Status page URL",
		input: "url",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "apiKeyInstructions",
		label: "API key instructions",
		input: "textarea",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "serviceTiers",
		label: "Service tiers",
		input: "json",
		nullable: true,
		overridable: true,
		updatable: false,
	},
	{
		key: "regionConfig",
		label: "Region config",
		input: "json",
		nullable: true,
		overridable: true,
		updatable: false,
	},
	{
		key: "modelCardBadge",
		label: "Model card badge",
		input: "text",
		nullable: true,
		overridable: true,
		updatable: false,
	},
	{
		key: "additionalLinks",
		label: "Additional links",
		input: "json",
		nullable: true,
		overridable: true,
		updatable: false,
	},
];

export const MODEL_SOURCE_FIELDS: SourceFieldDescriptor[] = [
	{
		key: "name",
		label: "Name",
		input: "text",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "description",
		label: "Description",
		input: "textarea",
		nullable: false,
		overridable: false,
		updatable: true,
	},
	{
		key: "family",
		label: "Family",
		input: "text",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "aliases",
		label: "Aliases",
		input: "csv",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "output",
		label: "Output modalities",
		input: "csv",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "free",
		label: "Free",
		input: "boolean",
		nullable: false,
		overridable: true,
		updatable: true,
	},
];

const MAPPING_PRICE_FIELD_KEYS = [
	["inputPrice", "Input price"],
	["outputPrice", "Output price"],
	["cachedInputPrice", "Cached input price"],
	["cacheReadInputPrice", "Cache read price"],
	["cacheWriteInputPrice", "Cache write price"],
	["cacheWriteInputPrice1h", "Cache write 1h price"],
	["imageInputPrice", "Image input price"],
	["imageOutputPrice", "Image output price"],
	["inputAudioPrice", "Audio input price"],
	["cachedImageInputPrice", "Cached image input price"],
	["cachedInputAudioPrice", "Cached audio input price"],
	["outputAudioPrice", "Audio output price"],
	["inputCharacterPrice", "Character input price"],
	["ocrPagePrice", "OCR page price"],
	["inputAudioHourPrice", "Audio hour price"],
	["requestPrice", "Request price"],
	["webSearchPrice", "Web search price"],
] as const;

export const MAPPING_SOURCE_FIELDS: SourceFieldDescriptor[] = [
	{
		key: "externalId",
		label: "External model ID",
		input: "text",
		nullable: false,
		// The mapping policy's externalIdOverride already owns this override
		// for static rows; direct edits apply to admin rows only.
		overridable: false,
		updatable: true,
	},
	{
		key: "contextSize",
		label: "Context size",
		input: "integer",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "maxOutput",
		label: "Max output",
		input: "integer",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "streaming",
		label: "Streaming",
		input: "boolean",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "vision",
		label: "Vision",
		input: "boolean",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "reasoning",
		label: "Reasoning",
		input: "boolean",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "reasoningMaxTokens",
		label: "Reasoning max tokens",
		input: "boolean",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "tools",
		label: "Tools",
		input: "boolean",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "jsonOutput",
		label: "JSON output",
		input: "boolean",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "jsonOutputSchema",
		label: "JSON output schema",
		input: "boolean",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "webSearch",
		label: "Web search",
		input: "boolean",
		nullable: false,
		overridable: true,
		updatable: true,
	},
	{
		key: "supportedParameters",
		label: "Supported parameters",
		input: "csv",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "pricingTiers",
		label: "Pricing tiers",
		input: "json",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	{
		key: "serviceTierMultipliers",
		label: "Service tier multipliers",
		input: "json",
		nullable: true,
		overridable: true,
		updatable: true,
	},
	...MAPPING_PRICE_FIELD_KEYS.map(([key, label]): SourceFieldDescriptor => ({
		key,
		label,
		input: "decimal",
		nullable: true,
		overridable: true,
		updatable: true,
	})),
	{
		key: "perSecondPrice",
		label: "Per-second price",
		input: "json",
		nullable: true,
		overridable: true,
		updatable: true,
	},
];

export function sourceFieldsFor(
	kind: "provider" | "model" | "mapping",
): SourceFieldDescriptor[] {
	return kind === "provider"
		? PROVIDER_SOURCE_FIELDS
		: kind === "model"
			? MODEL_SOURCE_FIELDS
			: MAPPING_SOURCE_FIELDS;
}

// Client-side mirror of the contract's source-decimal pattern ("1.4e-6").
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function formatSourceFieldValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	if (typeof value === "string") {
		return value === "" ? '""' : value;
	}
	return JSON.stringify(value);
}

export function sourceFieldDraft(
	field: SourceFieldDescriptor,
	value: unknown,
): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (field.input === "csv" && Array.isArray(value)) {
		return value.join(", ");
	}
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value, null, field.input === "json" ? 2 : undefined);
}

export function parseSourceFieldDraft(
	field: SourceFieldDescriptor,
	draft: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
	const raw =
		field.input === "textarea" || field.input === "json" ? draft : draft.trim();
	switch (field.input) {
		case "text":
		case "textarea":
		case "url":
		case "select":
		case "decimal": {
			if (!raw) {
				return { ok: false, error: `${field.label} requires a value` };
			}
			if (field.input === "decimal" && !DECIMAL_PATTERN.test(raw)) {
				return {
					ok: false,
					error: `${field.label} must be a decimal string like 1.4e-6`,
				};
			}
			return { ok: true, value: raw };
		}
		case "boolean": {
			if (raw !== "true" && raw !== "false") {
				return { ok: false, error: `${field.label} must be true or false` };
			}
			return { ok: true, value: raw === "true" };
		}
		case "number": {
			const parsed = Number(raw);
			if (!raw || Number.isNaN(parsed)) {
				return { ok: false, error: `${field.label} must be a number` };
			}
			return { ok: true, value: parsed };
		}
		case "integer": {
			if (!/^\d+$/.test(raw)) {
				return { ok: false, error: `${field.label} must be a whole number` };
			}
			return { ok: true, value: Number(raw) };
		}
		case "csv": {
			return {
				ok: true,
				value: raw
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean),
			};
		}
		case "json": {
			try {
				return { ok: true, value: JSON.parse(raw) as unknown };
			} catch {
				return { ok: false, error: `${field.label} must be valid JSON` };
			}
		}
	}
}
