import { describe, expect, it } from "vitest";

import { resolveEffectiveCatalog } from "./catalog.js";
import {
	catalogSnapshotHasProviderBaseData,
	compareCatalogProviderResolution,
	resolveProviderFromCatalog,
} from "./provider-resolution.js";
import { parseStoredCatalogSnapshot } from "./runtime.js";

import type { CatalogResolverInput, SourceProvider } from "./catalog.js";
import type { ProviderDefinition } from "@betarouter/models";

const staticProvider: ProviderDefinition = {
	id: "acme",
	name: "Acme",
	description: "Acme upstream",
	protocol: "openai-chat",
	env: { required: { apiKey: "LLM_ACME_API_KEY" } },
	streaming: true,
	cancellation: true,
	color: "#123456",
	website: "https://acme.test",
	announcement: null,
	priority: 0.9,
	contentFilter: true,
	maxTemperature: 1,
	learnMore: "https://acme.test/keys",
	regionConfig: {
		optionsKey: "acme_region",
		defaultRegion: "us",
		regions: [{ id: "us", label: "US" }],
		endpointMap: { us: "https://us.acme.test" },
	},
	serviceTiers: [
		{ id: "flex", name: "Flex" },
	] as ProviderDefinition["serviceTiers"],
};

/** Provider source row shaped like the worker sync writes it. */
function mirroredSourceProvider(
	overrides: Partial<SourceProvider> = {},
): SourceProvider {
	return {
		id: "acme",
		status: "active",
		name: "Acme",
		description: "Acme upstream",
		streaming: true,
		cancellation: true,
		color: "#123456",
		website: "https://acme.test",
		announcement: null,
		protocol: "openai-chat",
		priority: 0.9,
		contentFilter: true,
		maxTemperature: 1,
		headquarters: null,
		dataPolicy: null,
		serviceTiers: staticProvider.serviceTiers ?? null,
		regionConfig: staticProvider.regionConfig ?? null,
		termsUrl: null,
		privacyPolicyUrl: null,
		statusPageUrl: null,
		apiKeyInstructions: null,
		modelCardBadge: null,
		additionalLinks: null,
		...overrides,
	};
}

function resolverInput(provider: SourceProvider): CatalogResolverInput {
	return {
		revision: 7,
		now: new Date("2026-08-06T00:00:00.000Z"),
		providers: [provider],
		models: [],
		mappings: [],
		providerPolicies: [],
		modelPolicies: [],
		mappingPolicies: [],
		providerCredentialAvailability: {},
		mappingReadiness: {},
		breakerStates: {},
	};
}

function snapshotFor(provider: SourceProvider) {
	return resolveEffectiveCatalog(resolverInput(provider));
}

describe("resolveProviderFromCatalog", () => {
	it("carries provider base data into the effective catalog and stored form", () => {
		const snapshot = snapshotFor(mirroredSourceProvider());
		expect(catalogSnapshotHasProviderBaseData(snapshot)).toBe(true);
		const effective = snapshot.providers[0]!;
		expect(effective).toMatchObject({
			id: "acme",
			name: "Acme",
			protocol: "openai-chat",
			priority: 0.9,
			contentFilter: true,
			maxTemperature: 1,
			cancellation: true,
		});
		// The stored (JSON round-tripped) form parses strictly and keeps the data.
		const parsed = parseStoredCatalogSnapshot(
			JSON.parse(JSON.stringify(snapshot)),
		);
		expect(parsed.providers[0]).toMatchObject({
			name: "Acme",
			protocol: "openai-chat",
			priority: 0.9,
		});
	});

	it("reconstructs a mirrored static provider with zero divergence", () => {
		const snapshot = snapshotFor(mirroredSourceProvider());
		const resolved = resolveProviderFromCatalog("acme", snapshot, {
			staticProviders: [staticProvider],
		});
		expect(resolved).not.toBeNull();
		expect(resolved?.env).toEqual(staticProvider.env);
		expect(resolved?.learnMore).toBe(staticProvider.learnMore);
		expect(compareCatalogProviderResolution(staticProvider, resolved!)).toEqual(
			[],
		);
	});

	it("lets snapshot values (source overrides) win over the static graft", () => {
		const snapshot = snapshotFor(
			mirroredSourceProvider({ maxTemperature: 0.5, priority: 0.2 }),
		);
		const resolved = resolveProviderFromCatalog("acme", snapshot, {
			staticProviders: [staticProvider],
		});
		expect(resolved?.maxTemperature).toBe(0.5);
		expect(resolved?.priority).toBe(0.2);
		const divergences = compareCatalogProviderResolution(
			staticProvider,
			resolved!,
		);
		expect(divergences.map((item) => item.field).sort()).toEqual([
			"maxTemperature",
			"priority",
		]);
	});

	it("treats a null mirror value as authoritative not-set", () => {
		const snapshot = snapshotFor(
			mirroredSourceProvider({ maxTemperature: null, contentFilter: null }),
		);
		const resolved = resolveProviderFromCatalog("acme", snapshot, {
			staticProviders: [staticProvider],
		});
		expect(resolved?.maxTemperature).toBeUndefined();
		expect(resolved?.contentFilter).toBeUndefined();
	});

	it("returns null for pre-provider-base-data revisions and unknown ids", () => {
		const snapshot = snapshotFor({ id: "acme", status: "active" });
		expect(catalogSnapshotHasProviderBaseData(snapshot)).toBe(false);
		expect(
			resolveProviderFromCatalog("acme", snapshot, {
				staticProviders: [staticProvider],
			}),
		).toBeNull();
		const enriched = snapshotFor(mirroredSourceProvider());
		expect(
			resolveProviderFromCatalog("missing", enriched, {
				staticProviders: [staticProvider],
			}),
		).toBeNull();
	});

	it("reconstructs an admin-created provider without a static counterpart", () => {
		const snapshot = snapshotFor(
			mirroredSourceProvider({
				id: "relay",
				name: "Relay",
				description: "Admin relay",
				protocol: "anthropic-messages",
				priority: 0.8,
				contentFilter: null,
				maxTemperature: null,
				serviceTiers: null,
				regionConfig: null,
				streaming: null,
				cancellation: null,
				color: null,
				website: null,
			}),
		);
		const resolved = resolveProviderFromCatalog("relay", snapshot, {
			staticProviders: [staticProvider],
		});
		expect(resolved).toMatchObject({
			id: "relay",
			name: "Relay",
			description: "Admin relay",
			protocol: "anthropic-messages",
			priority: 0.8,
		});
		// Env is never mirrored; providers without a static definition get an
		// empty env config (they are credentialed via platform credentials).
		expect(resolved?.env).toEqual({ required: {} });
		expect(resolved?.streaming).toBeUndefined();
		expect(resolved?.regionConfig).toBeUndefined();
	});

	it("compares mirrored JSON fields insensitively to jsonb key order", () => {
		const reordered = JSON.parse(
			JSON.stringify(staticProvider.regionConfig),
		) as NonNullable<ProviderDefinition["regionConfig"]>;
		const shuffled = Object.fromEntries(
			Object.entries(reordered).reverse(),
		) as typeof reordered;
		const snapshot = snapshotFor(
			mirroredSourceProvider({ regionConfig: shuffled }),
		);
		const resolved = resolveProviderFromCatalog("acme", snapshot, {
			staticProviders: [staticProvider],
		});
		expect(compareCatalogProviderResolution(staticProvider, resolved!)).toEqual(
			[],
		);
	});
});
