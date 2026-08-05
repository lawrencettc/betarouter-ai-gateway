import { adminMappingId } from "./contracts.js";

import type {
	CatalogOperationV1,
	DisabledCatalogCapability,
	MappingCreateInput,
	MappingUpdatePatch,
	ModelCreateInput,
	ModelUpdatePatch,
	ProviderCreateInput,
	ProviderUpdatePatch,
} from "./contracts.js";

interface PolicyRecord {
	updatedAt: string;
	updatedBy: string;
}

export interface SourceOverrideFieldRecord {
	value: unknown;
	baseValue: unknown;
	setAt: string;
	setBy: string;
}

export interface SourceOverridesRecord {
	version: 1;
	fields: Record<string, SourceOverrideFieldRecord>;
}

export interface ProviderPolicyRecord extends PolicyRecord {
	providerId: string;
	visible: boolean;
	enabled: boolean;
	lifecycle: "draft" | "active" | "deprecated" | "retired";
	displayNameOverride?: string | null;
	descriptionOverride?: string | null;
	websiteOverride?: string | null;
	sortOrder?: number;
	deprecatedAt?: string | null;
	retireAt?: string | null;
	replacementProviderId?: string | null;
	sourceOverrides?: SourceOverridesRecord | null;
}

export interface ModelPolicyRecord extends PolicyRecord {
	modelId: string;
	visible: boolean;
	enabled: boolean;
	allowDirect: boolean;
	lifecycle: "draft" | "active" | "deprecated" | "retired";
	displayNameOverride?: string | null;
	descriptionOverride?: string | null;
	aliasesOverride?: string[] | null;
	sortOrder?: number;
	deprecatedAt?: string | null;
	retireAt?: string | null;
	replacementModelId?: string | null;
	retirementMessage?: string | null;
	sourceOverrides?: SourceOverridesRecord | null;
}

export interface MappingPolicyRecord extends PolicyRecord {
	mappingId: string;
	enabled: boolean;
	externalIdOverride?: string | null;
	contextSizeLimit?: number | null;
	maxOutputLimit?: number | null;
	disabledCapabilities?: DisabledCatalogCapability[];
	priority?: number;
	weight?: number;
	breakerEnabled?: boolean;
	requiredTestRevision?: string | null;
	sourceOverrides?: SourceOverridesRecord | null;
}

export interface MappingPricePolicyRecord extends PolicyRecord {
	mappingId: string;
	policy: Extract<
		CatalogOperationV1,
		{ type: "mapping.set_price_policy" }
	>["policy"];
}

export interface CatalogPolicyState {
	providers: Record<string, ProviderPolicyRecord>;
	models: Record<string, ModelPolicyRecord>;
	mappings: Record<string, MappingPolicyRecord>;
	prices: Record<string, MappingPricePolicyRecord>;
}

export class CatalogConflictError extends Error {
	public constructor(
		public readonly entityType: "provider" | "model" | "mapping" | "price",
		public readonly entityId: string,
	) {
		super(`Catalog policy changed for ${entityType}:${entityId}`);
		this.name = "CatalogConflictError";
	}
}

/**
 * Revisions written before rollback patches were schema-normalized may contain
 * the policy record identity and audit fields inside `patch`. Keep the public
 * input schemas strict, but remove those known legacy fields when reading an
 * internally persisted inverse operation.
 */
export function normalizePersistedInverseOperations(input: unknown): unknown {
	if (!Array.isArray(input)) {
		return input;
	}

	return input.map((value) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return value;
		}
		const operation = value as Record<string, unknown>;
		if (
			!new Set([
				"provider.set_policy",
				"model.set_policy",
				"mapping.set_policy",
			]).has(String(operation.type)) ||
			!operation.patch ||
			typeof operation.patch !== "object" ||
			Array.isArray(operation.patch)
		) {
			return value;
		}

		const {
			providerId: _providerId,
			modelId: _modelId,
			mappingId: _mappingId,
			updatedAt: _updatedAt,
			updatedBy: _updatedBy,
			...patch
		} = operation.patch as Record<string, unknown>;
		return { ...operation, patch };
	});
}

/**
 * Raw source-row facts the apply step needs beyond policy state: whether an
 * entity exists, whether it is code-mirrored (`static`) or admin-created, and
 * the mirrored values used to record an override's base value at set-time.
 */
export interface CatalogSourceEntity {
	source: string;
	values: Record<string, unknown>;
}

export interface CatalogSourceLookup {
	providers: ReadonlyMap<string, CatalogSourceEntity>;
	models: ReadonlyMap<string, CatalogSourceEntity>;
	mappings: ReadonlyMap<string, CatalogSourceEntity>;
}

export function catalogSourceLookupFromRows<
	P extends { id: string; source: string },
	M extends { id: string; source: string },
	X extends { id: string; source: string },
>(rows: {
	providers: readonly P[];
	models: readonly M[];
	mappings: readonly X[];
}): CatalogSourceLookup {
	const entity = (row: {
		id: string;
		source: string;
	}): CatalogSourceEntity => ({
		source: row.source,
		values: Object.fromEntries(Object.entries(row)),
	});
	return {
		providers: new Map(rows.providers.map((row) => [row.id, entity(row)])),
		models: new Map(rows.models.map((row) => [row.id, entity(row)])),
		mappings: new Map(rows.mappings.map((row) => [row.id, entity(row)])),
	};
}

export type CatalogSourceCreate =
	| { entityType: "provider"; entityId: string; create: ProviderCreateInput }
	| { entityType: "model"; entityId: string; create: ModelCreateInput }
	| { entityType: "mapping"; entityId: string; create: MappingCreateInput };

export type CatalogSourceUpdate =
	| { entityType: "provider"; entityId: string; patch: ProviderUpdatePatch }
	| { entityType: "model"; entityId: string; patch: ModelUpdatePatch }
	| { entityType: "mapping"; entityId: string; patch: MappingUpdatePatch };

interface ApplyCatalogOperationsInput {
	state: CatalogPolicyState;
	operations: CatalogOperationV1[];
	actor: string;
	updatedAt: string;
	/**
	 * Required for source-override, create, and direct-update operations
	 * (base-value capture, static/admin enforcement, existence conflicts,
	 * inverse-value capture). Policy-only operations apply without it.
	 */
	sources?: CatalogSourceLookup;
}

function assertExpected(
	record: PolicyRecord | undefined,
	expectedUpdatedAt: string | null,
	entityType: CatalogConflictError["entityType"],
	entityId: string,
): void {
	if ((record?.updatedAt ?? null) !== expectedUpdatedAt) {
		throw new CatalogConflictError(entityType, entityId);
	}
}

// The strict policy patch schemas do not know `sourceOverrides` (it has its
// own operations), so it must never leak into a persisted set_policy inverse.
function providerPolicyPatch(record: ProviderPolicyRecord) {
	const {
		providerId: _providerId,
		updatedAt: _updatedAt,
		updatedBy: _updatedBy,
		sourceOverrides: _sourceOverrides,
		...policy
	} = record;
	return policy;
}

function modelPolicyPatch(record: ModelPolicyRecord) {
	const {
		modelId: _modelId,
		updatedAt: _updatedAt,
		updatedBy: _updatedBy,
		sourceOverrides: _sourceOverrides,
		...policy
	} = record;
	return policy;
}

function mappingPolicyPatch(record: MappingPolicyRecord) {
	const {
		mappingId: _mappingId,
		updatedAt: _updatedAt,
		updatedBy: _updatedBy,
		sourceOverrides: _sourceOverrides,
		...policy
	} = record;
	return policy;
}

function assertStaticSourceEntity(
	entity: CatalogSourceEntity | undefined,
	entityType: "provider" | "model" | "mapping",
	entityId: string,
): void {
	if (entity && entity.source !== "static") {
		throw new Error(
			`Source overrides apply only to code-defined (static) entries; ${entityType} ${entityId} is admin-created and is edited directly`,
		);
	}
}

/**
 * Direct updates need the source row twice over: to enforce that only
 * admin-created rows are edited this way, and to capture the previous field
 * values for the inverse operation. A missing row is therefore a conflict,
 * not a soft skip.
 */
function requireAdminSourceEntity(
	entity: CatalogSourceEntity | undefined,
	entityType: "provider" | "model" | "mapping",
	entityId: string,
): CatalogSourceEntity {
	if (!entity) {
		throw new CatalogConflictError(entityType, entityId);
	}
	if (entity.source !== "admin") {
		throw new Error(
			`Direct updates apply only to admin-created entries; ${entityType} ${entityId} is code-defined — use a source override instead`,
		);
	}
	return entity;
}

/**
 * Previous values of the fields a direct update touches, shaped as another
 * update patch so rollback replays through the same operation. `?? null` only
 * fires for nullable columns — non-nullable fields always have a value on the
 * row, so the inverse stays parseable by the strict patch schemas.
 */
function inverseUpdatePatch(
	patch: Record<string, unknown>,
	values: Record<string, unknown>,
): Record<string, unknown> {
	const inverse: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) {
			continue;
		}
		inverse[key] = values[key] ?? null;
	}
	return inverse;
}

/**
 * Merge a partial override patch into the stored override record. A `null`
 * patch value clears that field's override; a set field records the mirrored
 * value at set-time so the upstream-change review can detect the base moving
 * underneath it. The inverse patch restores each touched field's previous
 * override value (or clears it) — its base values are re-captured at rollback
 * apply time.
 */
function mergeSourceOverrides(input: {
	current: SourceOverridesRecord | null | undefined;
	patch: Record<string, unknown>;
	base: Record<string, unknown> | undefined;
	actor: string;
	updatedAt: string;
}): {
	next: SourceOverridesRecord | null;
	inversePatch: Record<string, unknown>;
} {
	const cleared = new Set<string>();
	const updated: Record<string, SourceOverrideFieldRecord> = {};
	const inversePatch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input.patch)) {
		if (value === undefined) {
			continue;
		}
		inversePatch[key] = input.current?.fields[key]?.value ?? null;
		if (value === null) {
			cleared.add(key);
		} else {
			updated[key] = {
				value,
				baseValue: input.base?.[key] ?? null,
				setAt: input.updatedAt,
				setBy: input.actor,
			};
		}
	}
	const fields: Record<string, SourceOverrideFieldRecord> = {
		...Object.fromEntries(
			Object.entries(input.current?.fields ?? {}).filter(
				([key]) => !cleared.has(key),
			),
		),
		...updated,
	};
	return {
		next: Object.keys(fields).length > 0 ? { version: 1, fields } : null,
		inversePatch,
	};
}

function overrideValuesPatch(
	record: SourceOverridesRecord,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record.fields).map(([key, field]) => [key, field.value]),
	);
}

export function applyCatalogOperations(input: ApplyCatalogOperationsInput): {
	state: CatalogPolicyState;
	inverseOperations: CatalogOperationV1[];
	affectedEntityIds: string[];
	sourceCreates: CatalogSourceCreate[];
	sourceUpdates: CatalogSourceUpdate[];
} {
	const next = structuredClone(input.state);
	const inverseOperations: CatalogOperationV1[] = [];
	const affectedEntityIds = new Set<string>();
	const sourceCreates: CatalogSourceCreate[] = [];
	const sourceUpdates: CatalogSourceUpdate[] = [];

	for (const operation of input.operations) {
		switch (operation.type) {
			case "provider.set_policy": {
				const current = next.providers[operation.providerId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"provider",
					operation.providerId,
				);
				const base =
					current ??
					({
						providerId: operation.providerId,
						visible: false,
						enabled: false,
						lifecycle: "draft",
					} satisfies Omit<ProviderPolicyRecord, keyof PolicyRecord>);
				next.providers[operation.providerId] = {
					...base,
					...operation.patch,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "provider.set_policy",
					providerId: operation.providerId,
					expectedUpdatedAt: input.updatedAt,
					patch: current
						? providerPolicyPatch(current)
						: { visible: false, enabled: false, lifecycle: "draft" },
				});
				affectedEntityIds.add(operation.providerId);
				break;
			}
			case "model.set_policy": {
				const current = next.models[operation.modelId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"model",
					operation.modelId,
				);
				const base = current ?? {
					modelId: operation.modelId,
					visible: false,
					enabled: false,
					allowDirect: false,
					lifecycle: "draft" as const,
				};
				next.models[operation.modelId] = {
					...base,
					...operation.patch,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "model.set_policy",
					modelId: operation.modelId,
					expectedUpdatedAt: input.updatedAt,
					patch: current
						? modelPolicyPatch(current)
						: {
								visible: false,
								enabled: false,
								allowDirect: false,
								lifecycle: "draft",
							},
				});
				affectedEntityIds.add(operation.modelId);
				break;
			}
			case "mapping.set_policy":
			case "mapping.set_external_id": {
				const current = next.mappings[operation.mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"mapping",
					operation.mappingId,
				);
				const base = current ?? {
					mappingId: operation.mappingId,
					enabled: false,
				};
				const patch =
					operation.type === "mapping.set_external_id"
						? { externalIdOverride: operation.externalId }
						: operation.patch;
				next.mappings[operation.mappingId] = {
					...base,
					...patch,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "mapping.set_policy",
					mappingId: operation.mappingId,
					expectedUpdatedAt: input.updatedAt,
					patch: current ? mappingPolicyPatch(current) : { enabled: false },
				});
				affectedEntityIds.add(operation.mappingId);
				break;
			}
			case "mapping.set_price_policy": {
				const current = next.prices[operation.mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"price",
					operation.mappingId,
				);
				next.prices[operation.mappingId] = {
					mappingId: operation.mappingId,
					policy: operation.policy,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				if (current) {
					inverseOperations.unshift({
						version: 1,
						type: "mapping.set_price_policy",
						mappingId: operation.mappingId,
						expectedUpdatedAt: input.updatedAt,
						policy: current.policy,
					});
				} else {
					inverseOperations.unshift({
						version: 1,
						type: "mapping.clear_price_policy",
						mappingId: operation.mappingId,
						expectedUpdatedAt: input.updatedAt,
					});
				}
				affectedEntityIds.add(operation.mappingId);
				break;
			}
			case "mapping.clear_price_policy": {
				const current = next.prices[operation.mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"price",
					operation.mappingId,
				);
				if (!current) {
					throw new CatalogConflictError("price", operation.mappingId);
				}
				const { [operation.mappingId]: _removed, ...remainingPrices } =
					next.prices;
				next.prices = remainingPrices;
				inverseOperations.unshift({
					version: 1,
					type: "mapping.set_price_policy",
					mappingId: operation.mappingId,
					expectedUpdatedAt: null,
					policy: current.policy,
				});
				affectedEntityIds.add(operation.mappingId);
				break;
			}
			case "provider.set_source_override": {
				const current = next.providers[operation.providerId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"provider",
					operation.providerId,
				);
				const entity = input.sources?.providers.get(operation.providerId);
				assertStaticSourceEntity(entity, "provider", operation.providerId);
				const merged = mergeSourceOverrides({
					current: current?.sourceOverrides,
					patch: operation.patch,
					base: entity?.values,
					actor: input.actor,
					updatedAt: input.updatedAt,
				});
				const base =
					current ??
					({
						providerId: operation.providerId,
						visible: false,
						enabled: false,
						lifecycle: "draft",
					} satisfies Omit<ProviderPolicyRecord, keyof PolicyRecord>);
				next.providers[operation.providerId] = {
					...base,
					sourceOverrides: merged.next,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "provider.set_source_override",
					providerId: operation.providerId,
					expectedUpdatedAt: input.updatedAt,
					patch: merged.inversePatch as typeof operation.patch,
				});
				affectedEntityIds.add(operation.providerId);
				break;
			}
			case "model.set_source_override": {
				const current = next.models[operation.modelId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"model",
					operation.modelId,
				);
				const entity = input.sources?.models.get(operation.modelId);
				assertStaticSourceEntity(entity, "model", operation.modelId);
				const merged = mergeSourceOverrides({
					current: current?.sourceOverrides,
					patch: operation.patch,
					base: entity?.values,
					actor: input.actor,
					updatedAt: input.updatedAt,
				});
				const base = current ?? {
					modelId: operation.modelId,
					visible: false,
					enabled: false,
					allowDirect: false,
					lifecycle: "draft" as const,
				};
				next.models[operation.modelId] = {
					...base,
					sourceOverrides: merged.next,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "model.set_source_override",
					modelId: operation.modelId,
					expectedUpdatedAt: input.updatedAt,
					patch: merged.inversePatch as typeof operation.patch,
				});
				affectedEntityIds.add(operation.modelId);
				break;
			}
			case "mapping.set_source_override": {
				const current = next.mappings[operation.mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"mapping",
					operation.mappingId,
				);
				const entity = input.sources?.mappings.get(operation.mappingId);
				assertStaticSourceEntity(entity, "mapping", operation.mappingId);
				const merged = mergeSourceOverrides({
					current: current?.sourceOverrides,
					patch: operation.patch,
					base: entity?.values,
					actor: input.actor,
					updatedAt: input.updatedAt,
				});
				const base = current ?? {
					mappingId: operation.mappingId,
					enabled: false,
				};
				next.mappings[operation.mappingId] = {
					...base,
					sourceOverrides: merged.next,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "mapping.set_source_override",
					mappingId: operation.mappingId,
					expectedUpdatedAt: input.updatedAt,
					patch: merged.inversePatch as typeof operation.patch,
				});
				affectedEntityIds.add(operation.mappingId);
				break;
			}
			case "provider.clear_source_override": {
				const current = next.providers[operation.providerId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"provider",
					operation.providerId,
				);
				if (
					!current?.sourceOverrides ||
					Object.keys(current.sourceOverrides.fields).length === 0
				) {
					throw new CatalogConflictError("provider", operation.providerId);
				}
				const previous = current.sourceOverrides;
				next.providers[operation.providerId] = {
					...current,
					sourceOverrides: null,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "provider.set_source_override",
					providerId: operation.providerId,
					expectedUpdatedAt: input.updatedAt,
					patch: overrideValuesPatch(previous) as Extract<
						CatalogOperationV1,
						{ type: "provider.set_source_override" }
					>["patch"],
				});
				affectedEntityIds.add(operation.providerId);
				break;
			}
			case "model.clear_source_override": {
				const current = next.models[operation.modelId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"model",
					operation.modelId,
				);
				if (
					!current?.sourceOverrides ||
					Object.keys(current.sourceOverrides.fields).length === 0
				) {
					throw new CatalogConflictError("model", operation.modelId);
				}
				const previous = current.sourceOverrides;
				next.models[operation.modelId] = {
					...current,
					sourceOverrides: null,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "model.set_source_override",
					modelId: operation.modelId,
					expectedUpdatedAt: input.updatedAt,
					patch: overrideValuesPatch(previous) as Extract<
						CatalogOperationV1,
						{ type: "model.set_source_override" }
					>["patch"],
				});
				affectedEntityIds.add(operation.modelId);
				break;
			}
			case "mapping.clear_source_override": {
				const current = next.mappings[operation.mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"mapping",
					operation.mappingId,
				);
				if (
					!current?.sourceOverrides ||
					Object.keys(current.sourceOverrides.fields).length === 0
				) {
					throw new CatalogConflictError("mapping", operation.mappingId);
				}
				const previous = current.sourceOverrides;
				next.mappings[operation.mappingId] = {
					...current,
					sourceOverrides: null,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				inverseOperations.unshift({
					version: 1,
					type: "mapping.set_source_override",
					mappingId: operation.mappingId,
					expectedUpdatedAt: input.updatedAt,
					patch: overrideValuesPatch(previous) as Extract<
						CatalogOperationV1,
						{ type: "mapping.set_source_override" }
					>["patch"],
				});
				affectedEntityIds.add(operation.mappingId);
				break;
			}
			case "provider.update": {
				const current = next.providers[operation.providerId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"provider",
					operation.providerId,
				);
				const entity = requireAdminSourceEntity(
					input.sources?.providers.get(operation.providerId),
					"provider",
					operation.providerId,
				);
				const base =
					current ??
					({
						providerId: operation.providerId,
						visible: false,
						enabled: false,
						lifecycle: "draft",
					} satisfies Omit<ProviderPolicyRecord, keyof PolicyRecord>);
				next.providers[operation.providerId] = {
					...base,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				sourceUpdates.push({
					entityType: "provider",
					entityId: operation.providerId,
					patch: operation.patch,
				});
				inverseOperations.unshift({
					version: 1,
					type: "provider.update",
					providerId: operation.providerId,
					expectedUpdatedAt: input.updatedAt,
					patch: inverseUpdatePatch(
						operation.patch,
						entity.values,
					) as typeof operation.patch,
				});
				affectedEntityIds.add(operation.providerId);
				break;
			}
			case "model.update": {
				const current = next.models[operation.modelId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"model",
					operation.modelId,
				);
				const entity = requireAdminSourceEntity(
					input.sources?.models.get(operation.modelId),
					"model",
					operation.modelId,
				);
				const base = current ?? {
					modelId: operation.modelId,
					visible: false,
					enabled: false,
					allowDirect: false,
					lifecycle: "draft" as const,
				};
				next.models[operation.modelId] = {
					...base,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				sourceUpdates.push({
					entityType: "model",
					entityId: operation.modelId,
					patch: operation.patch,
				});
				inverseOperations.unshift({
					version: 1,
					type: "model.update",
					modelId: operation.modelId,
					expectedUpdatedAt: input.updatedAt,
					patch: inverseUpdatePatch(
						operation.patch,
						entity.values,
					) as typeof operation.patch,
				});
				affectedEntityIds.add(operation.modelId);
				break;
			}
			case "mapping.update": {
				const current = next.mappings[operation.mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"mapping",
					operation.mappingId,
				);
				const entity = requireAdminSourceEntity(
					input.sources?.mappings.get(operation.mappingId),
					"mapping",
					operation.mappingId,
				);
				const base = current ?? {
					mappingId: operation.mappingId,
					enabled: false,
				};
				next.mappings[operation.mappingId] = {
					...base,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				sourceUpdates.push({
					entityType: "mapping",
					entityId: operation.mappingId,
					patch: operation.patch,
				});
				inverseOperations.unshift({
					version: 1,
					type: "mapping.update",
					mappingId: operation.mappingId,
					expectedUpdatedAt: input.updatedAt,
					patch: inverseUpdatePatch(
						operation.patch,
						entity.values,
					) as typeof operation.patch,
				});
				affectedEntityIds.add(operation.mappingId);
				break;
			}
			case "provider.create": {
				const providerId = operation.create.providerId;
				const current = next.providers[providerId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"provider",
					providerId,
				);
				if (current || input.sources?.providers.has(providerId)) {
					throw new CatalogConflictError("provider", providerId);
				}
				next.providers[providerId] = {
					providerId,
					visible: false,
					enabled: false,
					lifecycle: "draft",
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				sourceCreates.push({
					entityType: "provider",
					entityId: providerId,
					create: operation.create,
				});
				// Creation cannot be undone by deletion (no catalog row is ever
				// hard-deleted); the inverse retires the created entry instead.
				inverseOperations.unshift({
					version: 1,
					type: "entity.archive_policy",
					entityType: "provider",
					entityId: providerId,
					expectedUpdatedAt: input.updatedAt,
				});
				affectedEntityIds.add(providerId);
				break;
			}
			case "model.create": {
				const modelId = operation.create.modelId;
				const current = next.models[modelId];
				assertExpected(current, operation.expectedUpdatedAt, "model", modelId);
				if (current || input.sources?.models.has(modelId)) {
					throw new CatalogConflictError("model", modelId);
				}
				next.models[modelId] = {
					modelId,
					visible: false,
					enabled: false,
					allowDirect: false,
					lifecycle: "draft",
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				sourceCreates.push({
					entityType: "model",
					entityId: modelId,
					create: operation.create,
				});
				inverseOperations.unshift({
					version: 1,
					type: "entity.archive_policy",
					entityType: "model",
					entityId: modelId,
					expectedUpdatedAt: input.updatedAt,
				});
				affectedEntityIds.add(modelId);
				break;
			}
			case "mapping.create": {
				const mappingId = adminMappingId(operation.create);
				const current = next.mappings[mappingId];
				assertExpected(
					current,
					operation.expectedUpdatedAt,
					"mapping",
					mappingId,
				);
				if (current || input.sources?.mappings.has(mappingId)) {
					throw new CatalogConflictError("mapping", mappingId);
				}
				next.mappings[mappingId] = {
					mappingId,
					enabled: false,
					updatedAt: input.updatedAt,
					updatedBy: input.actor,
				};
				sourceCreates.push({
					entityType: "mapping",
					entityId: mappingId,
					create: operation.create,
				});
				inverseOperations.unshift({
					version: 1,
					type: "entity.archive_policy",
					entityType: "mapping",
					entityId: mappingId,
					expectedUpdatedAt: input.updatedAt,
				});
				affectedEntityIds.add(mappingId);
				break;
			}
			case "entity.archive_policy": {
				if (operation.entityType === "provider") {
					const current = next.providers[operation.entityId];
					assertExpected(
						current,
						operation.expectedUpdatedAt,
						"provider",
						operation.entityId,
					);
					if (!current) {
						throw new CatalogConflictError("provider", operation.entityId);
					}
					next.providers[operation.entityId] = {
						...current,
						visible: false,
						enabled: false,
						lifecycle: "retired",
						updatedAt: input.updatedAt,
						updatedBy: input.actor,
					};
					inverseOperations.unshift({
						version: 1,
						type: "provider.set_policy",
						providerId: operation.entityId,
						expectedUpdatedAt: input.updatedAt,
						patch: providerPolicyPatch(current),
					});
				} else if (operation.entityType === "model") {
					const current = next.models[operation.entityId];
					assertExpected(
						current,
						operation.expectedUpdatedAt,
						"model",
						operation.entityId,
					);
					if (!current) {
						throw new CatalogConflictError("model", operation.entityId);
					}
					next.models[operation.entityId] = {
						...current,
						visible: false,
						enabled: false,
						lifecycle: "retired",
						updatedAt: input.updatedAt,
						updatedBy: input.actor,
					};
					inverseOperations.unshift({
						version: 1,
						type: "model.set_policy",
						modelId: operation.entityId,
						expectedUpdatedAt: input.updatedAt,
						patch: modelPolicyPatch(current),
					});
				} else {
					const current = next.mappings[operation.entityId];
					assertExpected(
						current,
						operation.expectedUpdatedAt,
						"mapping",
						operation.entityId,
					);
					if (!current) {
						throw new CatalogConflictError("mapping", operation.entityId);
					}
					next.mappings[operation.entityId] = {
						...current,
						enabled: false,
						updatedAt: input.updatedAt,
						updatedBy: input.actor,
					};
					inverseOperations.unshift({
						version: 1,
						type: "mapping.set_policy",
						mappingId: operation.entityId,
						expectedUpdatedAt: input.updatedAt,
						patch: mappingPolicyPatch(current),
					});
				}
				affectedEntityIds.add(operation.entityId);
				break;
			}
		}
	}

	return {
		state: next,
		inverseOperations,
		affectedEntityIds: [...affectedEntityIds].sort(),
		sourceCreates,
		sourceUpdates,
	};
}
