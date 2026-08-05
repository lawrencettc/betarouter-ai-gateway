import { describe, expect, it } from "vitest";

import {
	enforceCatalogRequest,
	filterProviderMappingsByCatalog,
	findCatalogMappingForProvider,
	isCatalogOperationEnabled,
	isCatalogRoutingEnforcedForOperation,
	isTenantCustomProviderId,
} from "./catalog-policy.js";

import type {
	CatalogRequestDecision,
	EffectiveMapping,
} from "@betarouter/catalog";
import type { ProviderModelMapping } from "@betarouter/models";

describe("filterProviderMappingsByCatalog", () => {
	it("keeps unvalidated non-chat operations on legacy routing at launch", () => {
		expect(isCatalogOperationEnabled("chat")).toBe(true);
		expect(isCatalogOperationEnabled("embeddings")).toBe(true);
		expect(isCatalogOperationEnabled("deferred_non_chat")).toBe(false);
	});

	it("enforces embeddings only behind its own routing flip", () => {
		const routingOff = {
			routingEnabled: false,
			embeddingsRoutingEnabled: true,
		};
		expect(isCatalogRoutingEnforcedForOperation("chat", routingOff)).toBe(
			false,
		);
		expect(isCatalogRoutingEnforcedForOperation("embeddings", routingOff)).toBe(
			false,
		);

		// A deployment already enforcing chat must not start enforcing
		// embeddings until the operator flips the embeddings flag.
		const chatOnly = { routingEnabled: true, embeddingsRoutingEnabled: false };
		expect(isCatalogRoutingEnforcedForOperation("chat", chatOnly)).toBe(true);
		expect(isCatalogRoutingEnforcedForOperation("embeddings", chatOnly)).toBe(
			false,
		);
		expect(
			isCatalogRoutingEnforcedForOperation("deferred_non_chat", chatOnly),
		).toBe(false);

		const both = { routingEnabled: true, embeddingsRoutingEnabled: true };
		expect(isCatalogRoutingEnforcedForOperation("embeddings", both)).toBe(true);
		expect(
			isCatalogRoutingEnforcedForOperation("deferred_non_chat", both),
		).toBe(false);
	});

	it("removes disabled fallbacks and applies the effective external id", () => {
		const providers = [
			{ providerId: "openai", externalId: "old", streaming: true },
			{
				providerId: "relay",
				externalId: "relay",
				streaming: true,
				tools: true,
				contextSize: 8192,
				maxOutput: 1024,
			},
		] as ProviderModelMapping[];
		const decision = {
			allowed: true,
			revision: 4,
			mappingIds: ["mapping-2", "mapping-1"],
			mappings: [
				{
					id: "mapping-2",
					providerId: "relay",
					modelId: "gpt",
					region: "us-east",
					externalId: "relay-priority",
					platformCredentialId: "relay-credential",
					platformCredentialProfile: "sha256:relay-profile",
					displayable: true,
					available: true,
					routable: true,
					probeOnly: false,
					priority: 0,
					weight: 100,
					contextSizeLimit: 4096,
					maxOutputLimit: 512,
					disabledCapabilities: ["tools"],
					sourcePrices: {},
					customerPrices: {},
					margin: {},
					pricingMode: null,
					markupBps: null,
					reasons: [],
				},
				{
					id: "mapping-1",
					providerId: "openai",
					modelId: "gpt",
					region: null,
					externalId: "new-upstream-id",
					platformCredentialId: "openai-credential",
					platformCredentialProfile: "sha256:openai-profile",
					displayable: true,
					available: true,
					routable: true,
					probeOnly: false,
					priority: 1,
					weight: 100,
					contextSizeLimit: null,
					maxOutputLimit: null,
					disabledCapabilities: [],
					sourcePrices: {},
					customerPrices: {},
					margin: {},
					pricingMode: null,
					markupBps: null,
					reasons: [],
				},
			],
			deprecated: false,
			deprecatedAt: null,
			retireAt: null,
			replacementModelId: null,
		} satisfies Extract<CatalogRequestDecision, { allowed: true }>;

		expect(filterProviderMappingsByCatalog(providers, decision)).toEqual([
			expect.objectContaining({
				providerId: "relay",
				region: "us-east",
				externalId: "relay-priority",
				platformCredentialId: "relay-credential",
				platformCredentialProfile: "sha256:relay-profile",
				tools: false,
				contextSize: 4096,
				maxOutput: 512,
			}),
			expect.objectContaining({
				providerId: "openai",
				externalId: "new-upstream-id",
			}),
		]);
		expect(
			findCatalogMappingForProvider(decision, "relay", "us-east"),
		).toMatchObject({ id: "mapping-2" });
	});

	it("prefers an exact regional mapping over the provider-level fallback", () => {
		const providers = [
			{ providerId: "relay", externalId: "generic", streaming: true },
			{
				providerId: "relay",
				region: "us-east",
				externalId: "regional",
				streaming: true,
				tools: true,
			},
		] as ProviderModelMapping[];
		const mapping: EffectiveMapping = {
			id: "mapping-us-east",
			providerId: "relay",
			modelId: "gpt",
			region: "us-east",
			deactivatedAt: null,
			externalId: "catalog-regional",
			platformCredentialId: "credential",
			platformCredentialProfile: "sha256:profile",
			displayable: true,
			available: true,
			routable: true,
			probeOnly: false,
			priority: 0,
			weight: 100,
			contextSizeLimit: null,
			maxOutputLimit: null,
			disabledCapabilities: [],
			sourcePrices: {},
			customerPrices: {},
			margin: {},
			pricingMode: null,
			markupBps: null,
			reasons: [],
		};
		const decision = {
			allowed: true,
			revision: 5,
			mappingIds: [mapping.id],
			mappings: [mapping],
			deprecated: false,
			deprecatedAt: null,
			retireAt: null,
			replacementModelId: null,
		} satisfies Extract<CatalogRequestDecision, { allowed: true }>;

		expect(
			filterProviderMappingsByCatalog(providers, decision)[0],
		).toMatchObject({
			region: "us-east",
			tools: true,
			externalId: "catalog-regional",
		});
	});
});

describe("tenant custom provider exemption", () => {
	it("recognises the reserved tenant provider namespace", () => {
		expect(isTenantCustomProviderId("custom")).toBe(true);
		expect(isTenantCustomProviderId("custom/acme")).toBe(true);
		expect(isTenantCustomProviderId("customer")).toBe(false);
		expect(isTenantCustomProviderId("openai")).toBe(false);
		expect(isTenantCustomProviderId(undefined)).toBe(false);
	});

	it("never enforces the catalogue on tenant custom providers", async () => {
		await expect(
			enforceCatalogRequest(
				{ modelId: "an-org-private-model", providerId: "custom" },
				{ operation: "chat" },
			),
		).resolves.toBeNull();
	});

	it("passes custom provider mappings through catalogue filtering", () => {
		const providers = [
			{ providerId: "custom", externalId: "byok-model", streaming: true },
			{ providerId: "openai", externalId: "old", streaming: true },
		] as ProviderModelMapping[];
		const decision = {
			allowed: true,
			revision: 6,
			mappingIds: [],
			mappings: [],
			deprecated: false,
			deprecatedAt: null,
			retireAt: null,
			replacementModelId: null,
		} satisfies Extract<CatalogRequestDecision, { allowed: true }>;

		expect(filterProviderMappingsByCatalog(providers, decision)).toEqual([
			expect.objectContaining({ providerId: "custom" }),
		]);
	});
});
