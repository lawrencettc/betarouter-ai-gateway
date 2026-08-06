import { providers as staticProviderCatalog } from "@betarouter/models";

import type { EffectiveCatalog } from "./catalog.js";
import type { ProviderDefinition, ProviderProtocol } from "@betarouter/models";

export interface CatalogProviderResolutionDivergence {
	providerId: string;
	field: string;
	staticValue: string;
	catalogValue: string;
}

/**
 * Env config synthesized for providers without a static definition
 * (admin-created). Env credentials are deployment config, deliberately not
 * mirrored into the catalog: database-defined providers are credentialed
 * exclusively through platform credentials, and the env lookup helpers
 * (`getProviderEnvVar`, `getProviderEnvConfig`) key on the static array, so
 * they never read this stub.
 */
const ADMIN_PROVIDER_ENV: ProviderDefinition["env"] = { required: {} };

/**
 * Whether a stored snapshot carries provider base data (name, protocol,
 * routing knobs). Snapshots published before the provider mirror rode the
 * snapshot still parse but cannot back provider resolution, so callers fall
 * back to the static array for those revisions.
 */
export function catalogSnapshotHasProviderBaseData(
	snapshot: EffectiveCatalog,
): boolean {
	return snapshot.providers.some((provider) => provider.name !== undefined);
}

export interface ResolveProviderFromCatalogOptions {
	/** Static definitions used for graft. Injectable for tests. */
	staticProviders?: readonly ProviderDefinition[];
}

/**
 * Pick a field value with the mirror semantics shared with mapping
 * reconstruction: an absent field means a pre-provider-base-data revision
 * (fall back to the graft); a null field is the mirror's authoritative "not
 * set" and must not resurrect the grafted static value.
 */
function mirrorField<T>(
	snapshotValue: T | null | undefined,
	staticValue: T | undefined,
): T | undefined {
	return snapshotValue === undefined
		? staticValue
		: (snapshotValue ?? undefined);
}

/**
 * Rebuild a provider definition in the static-array shape from the stored
 * catalog snapshot — the provider analog of `resolveModelFromCatalog`. This
 * is what makes provider-level source overrides (and admin-created
 * providers' own base data) take effect at runtime.
 *
 * Returns null when the snapshot does not know the provider or predates the
 * provider base-data mirror; callers fall back to static resolution. `env`
 * and `learnMore` are never mirrored and always graft from the static
 * definition (admin-created providers get an empty env config).
 */
export function resolveProviderFromCatalog(
	providerId: string,
	snapshot: EffectiveCatalog,
	options?: ResolveProviderFromCatalogOptions,
): ProviderDefinition | null {
	const catalogProvider = snapshot.providers.find(
		(provider) => provider.id === providerId,
	);
	if (!catalogProvider || catalogProvider.name === undefined) {
		return null;
	}
	const source =
		options?.staticProviders ??
		(staticProviderCatalog as readonly ProviderDefinition[]);
	const staticDef = source.find((provider) => provider.id === providerId);
	return {
		id: catalogProvider.id,
		name: catalogProvider.name,
		description: catalogProvider.description ?? staticDef?.description ?? "",
		// Snapshot protocol values originate from the enum'd mirror column. A
		// null protocol only exists on legacy rows synced before the protocol
		// column; those are always static providers, so the graft applies.
		protocol: (catalogProvider.protocol ??
			staticDef?.protocol ??
			"openai-chat") as ProviderProtocol,
		env: staticDef?.env ?? ADMIN_PROVIDER_ENV,
		streaming: mirrorField(catalogProvider.streaming, staticDef?.streaming),
		cancellation: mirrorField(
			catalogProvider.cancellation,
			staticDef?.cancellation,
		),
		color: mirrorField(catalogProvider.color, staticDef?.color),
		website: mirrorField(
			catalogProvider.website,
			staticDef?.website ?? undefined,
		),
		statusPageUrl: mirrorField(
			catalogProvider.statusPageUrl,
			staticDef?.statusPageUrl ?? undefined,
		),
		announcement: mirrorField(
			catalogProvider.announcement,
			staticDef?.announcement ?? undefined,
		),
		modelCardBadge: mirrorField(
			catalogProvider.modelCardBadge,
			staticDef?.modelCardBadge ?? undefined,
		),
		apiKeyInstructions: mirrorField(
			catalogProvider.apiKeyInstructions,
			staticDef?.apiKeyInstructions,
		),
		learnMore: staticDef?.learnMore,
		priority: mirrorField(catalogProvider.priority, staticDef?.priority),
		contentFilter: mirrorField(
			catalogProvider.contentFilter,
			staticDef?.contentFilter,
		),
		maxTemperature: mirrorField(
			catalogProvider.maxTemperature,
			staticDef?.maxTemperature,
		),
		regionConfig: mirrorField(
			catalogProvider.regionConfig,
			staticDef?.regionConfig,
		),
		serviceTiers: mirrorField(
			catalogProvider.serviceTiers,
			staticDef?.serviceTiers,
		),
		termsUrl: mirrorField(
			catalogProvider.termsUrl,
			staticDef?.termsUrl ?? undefined,
		),
		privacyPolicyUrl: mirrorField(
			catalogProvider.privacyPolicyUrl,
			staticDef?.privacyPolicyUrl ?? undefined,
		),
		headquarters: mirrorField(
			catalogProvider.headquarters,
			staticDef?.headquarters ?? undefined,
		),
		dataPolicy: mirrorField(
			catalogProvider.dataPolicy,
			staticDef?.dataPolicy ?? undefined,
		),
		additionalLinks: mirrorField(
			catalogProvider.additionalLinks,
			staticDef?.additionalLinks,
		),
	};
}

/**
 * Canonical JSON for structural comparison: Postgres jsonb does not preserve
 * object key order, so mirrored JSON fields must compare with sorted keys.
 */
function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, current) => {
		if (
			current === null ||
			typeof current !== "object" ||
			Array.isArray(current)
		) {
			return current;
		}
		return Object.fromEntries(
			Object.entries(current as Record<string, unknown>).sort(
				([left], [right]) => left.localeCompare(right),
			),
		);
	});
}

function formatValue(value: unknown): string {
	if (value === undefined) {
		return "undefined";
	}
	if (typeof value === "object" && value !== null) {
		return canonicalJson(value);
	}
	return String(value);
}

const SCALAR_PROVIDER_FIELDS = [
	"name",
	"description",
	"protocol",
	"streaming",
	"cancellation",
	"color",
	"website",
	"statusPageUrl",
	"announcement",
	"modelCardBadge",
	"apiKeyInstructions",
	"priority",
	"contentFilter",
	"maxTemperature",
	"termsUrl",
	"privacyPolicyUrl",
	"headquarters",
] as const;

const JSON_PROVIDER_FIELDS = [
	"dataPolicy",
	"serviceTiers",
	"regionConfig",
	"additionalLinks",
] as const;

/**
 * Field-by-field comparison of a static provider definition against its
 * catalog-reconstructed counterpart, limited to mirrored fields (`env` and
 * `learnMore` graft and are identical by construction). Null and undefined
 * both mean "not set" — the sync writes code-absent optionals as NULL — so
 * they compare equal. None of these fields feed billing, so divergences are
 * soak signals, not inversion aborts.
 */
export function compareCatalogProviderResolution(
	staticProvider: ProviderDefinition,
	catalogProvider: ProviderDefinition,
): CatalogProviderResolutionDivergence[] {
	const divergences: CatalogProviderResolutionDivergence[] = [];
	const check = (field: string, equal: boolean) => {
		if (!equal) {
			divergences.push({
				providerId: staticProvider.id,
				field,
				staticValue: formatValue(
					staticProvider[field as keyof ProviderDefinition],
				),
				catalogValue: formatValue(
					catalogProvider[field as keyof ProviderDefinition],
				),
			});
		}
	};
	for (const field of SCALAR_PROVIDER_FIELDS) {
		check(
			field,
			(staticProvider[field] ?? undefined) ===
				(catalogProvider[field] ?? undefined),
		);
	}
	for (const field of JSON_PROVIDER_FIELDS) {
		const staticValue = staticProvider[field] ?? undefined;
		const catalogValue = catalogProvider[field] ?? undefined;
		check(
			field,
			staticValue === undefined || catalogValue === undefined
				? staticValue === catalogValue
				: canonicalJson(staticValue) === canonicalJson(catalogValue),
		);
	}
	return divergences;
}
