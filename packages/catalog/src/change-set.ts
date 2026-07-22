import type { CatalogOperationV1 } from "./contracts.js";

interface PolicyRecord {
	updatedAt: string;
	updatedBy: string;
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
}

export interface MappingPolicyRecord extends PolicyRecord {
	mappingId: string;
	enabled: boolean;
	externalIdOverride?: string | null;
	contextSizeLimit?: number | null;
	maxOutputLimit?: number | null;
	disabledCapabilities?: string[];
	priority?: number;
	weight?: number;
	breakerEnabled?: boolean;
	requiredTestRevision?: string | null;
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

interface ApplyCatalogOperationsInput {
	state: CatalogPolicyState;
	operations: CatalogOperationV1[];
	actor: string;
	updatedAt: string;
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

function withoutMetadata<T extends PolicyRecord>(record: T) {
	const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...policy } = record;
	return policy;
}

export function applyCatalogOperations(input: ApplyCatalogOperationsInput): {
	state: CatalogPolicyState;
	inverseOperations: CatalogOperationV1[];
	affectedEntityIds: string[];
} {
	const next = structuredClone(input.state);
	const inverseOperations: CatalogOperationV1[] = [];
	const affectedEntityIds = new Set<string>();

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
						? withoutMetadata(current)
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
						? withoutMetadata(current)
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
					patch: current ? withoutMetadata(current) : { enabled: false },
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
				}
				affectedEntityIds.add(operation.mappingId);
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
						patch: withoutMetadata(current),
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
						patch: withoutMetadata(current),
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
						patch: withoutMetadata(current),
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
	};
}
