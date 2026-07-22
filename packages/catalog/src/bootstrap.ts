export interface BuildBootstrapPoliciesInput {
	providerIds: string[];
	modelIds: string[];
	mappingIds: string[];
	actor: string;
	mode: "curated" | "legacy";
}

export function buildBootstrapPolicies(input: BuildBootstrapPoliciesInput) {
	const enabled = input.mode === "legacy";
	const lifecycle = enabled ? ("active" as const) : ("draft" as const);
	return {
		providerPolicies: [...input.providerIds].sort().map((providerId) => ({
			providerId,
			visible: enabled,
			enabled,
			lifecycle,
			updatedBy: input.actor,
		})),
		modelPolicies: [...input.modelIds].sort().map((modelId) => ({
			modelId,
			visible: enabled,
			enabled,
			allowDirect: false,
			lifecycle,
			updatedBy: input.actor,
		})),
		mappingPolicies: [...input.mappingIds].sort().map((mappingId) => ({
			mappingId,
			enabled,
			updatedBy: input.actor,
		})),
		pricePolicies:
			input.mode === "legacy"
				? [...input.mappingIds].sort().map((mappingId) => ({
						mappingId,
						currency: "USD" as const,
						mode: "source_cost" as const,
						updatedBy: input.actor,
					}))
				: [],
	};
}
