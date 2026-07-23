import { buildBootstrapPolicies } from "@betarouter/catalog";
import {
	closeDatabase,
	db,
	model,
	modelProviderMapping,
	platformMappingPolicy,
	platformMappingPricePolicy,
	platformModelPolicy,
	platformProviderPolicy,
	provider,
} from "@betarouter/db";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const mode = args.has("--legacy") ? "legacy" : "curated";
const actorArg = process.argv.find((value) => value.startsWith("--actor="));
const actor = actorArg?.slice("--actor=".length).trim();

if (apply && !actor) {
	throw new Error("--actor=<platform-admin-id> is required with --apply");
}

const [providers, models, mappings] = await Promise.all([
	db.select({ id: provider.id }).from(provider),
	db.select({ id: model.id }).from(model),
	db.select({ id: modelProviderMapping.id }).from(modelProviderMapping),
]);
const policies = buildBootstrapPolicies({
	providerIds: providers.map((item) => item.id),
	modelIds: models.map((item) => item.id),
	mappingIds: mappings.map((item) => item.id),
	actor: actor ?? "dry-run",
	mode,
});

process.stdout.write(
	JSON.stringify(
		{
			apply,
			mode,
			providers: policies.providerPolicies.length,
			models: policies.modelPolicies.length,
			mappings: policies.mappingPolicies.length,
			prices: policies.pricePolicies.length,
		},
		null,
		2,
	) + "\n",
);

if (apply) {
	await db.transaction(async (tx) => {
		if (policies.providerPolicies.length > 0) {
			await tx
				.insert(platformProviderPolicy)
				.values(policies.providerPolicies)
				.onConflictDoNothing();
		}
		if (policies.modelPolicies.length > 0) {
			await tx
				.insert(platformModelPolicy)
				.values(policies.modelPolicies)
				.onConflictDoNothing();
		}
		if (policies.mappingPolicies.length > 0) {
			await tx
				.insert(platformMappingPolicy)
				.values(policies.mappingPolicies)
				.onConflictDoNothing();
		}
		if (policies.pricePolicies.length > 0) {
			await tx
				.insert(platformMappingPricePolicy)
				.values(policies.pricePolicies)
				.onConflictDoNothing();
		}
	});
}

await closeDatabase();
