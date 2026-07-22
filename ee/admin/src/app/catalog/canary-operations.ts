import type { paths } from "@/lib/api/v1";

type ChangeBody =
	paths["/admin/catalog/change-sets"]["post"]["requestBody"]["content"]["application/json"];
type Operation = ChangeBody["operations"][number];
type MappingPage =
	paths["/admin/catalog/mappings"]["get"]["responses"]["200"]["content"]["application/json"];
type MappingItem = MappingPage["items"][number];

export function prepareHiddenCanaryOperations(
	item: MappingItem,
	mappingOperations: Operation[],
): Operation[] {
	return [
		{
			version: 1,
			type: "provider.set_policy",
			providerId: item.providerId,
			expectedUpdatedAt: item.providerPolicy?.updatedAt ?? null,
			patch: { enabled: true, visible: false, lifecycle: "active" },
		},
		{
			version: 1,
			type: "model.set_policy",
			modelId: item.modelId,
			expectedUpdatedAt: item.modelPolicy?.updatedAt ?? null,
			patch: {
				enabled: true,
				visible: false,
				allowDirect: false,
				lifecycle: "active",
			},
		},
		...mappingOperations.map((operation) =>
			operation.type === "mapping.set_policy"
				? {
						...operation,
						patch: { ...operation.patch, enabled: true, weight: 0 },
					}
				: operation,
		),
	];
}
