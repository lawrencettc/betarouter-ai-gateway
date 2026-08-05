import { describe, expect, it } from "vitest";

import {
	catalogChangeSetInputSchema,
	fixedPricesV1Schema,
	fixedPricesV2Schema,
	mappingSourceOverridePatchSchema,
	providerCreateSchema,
	providerSourceOverridePatchSchema,
} from "./contracts.js";

const baseChangeSet = {
	title: "Curate launch catalog",
	reason: "Publish the initial supported model set",
	baseRevision: 12,
	effectiveAt: null,
	idempotencyKey: "catalog-launch-2026-07-22",
};

describe("catalog change-set contracts", () => {
	it("accepts a versioned provider policy operation", () => {
		const result = catalogChangeSetInputSchema.safeParse({
			...baseChangeSet,
			operations: [
				{
					version: 1,
					type: "provider.set_policy",
					providerId: "openai",
					expectedUpdatedAt: null,
					patch: { visible: true, enabled: true, lifecycle: "active" },
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it("rejects unknown operation versions and fields", () => {
		const wrongVersion = catalogChangeSetInputSchema.safeParse({
			...baseChangeSet,
			operations: [
				{
					version: 2,
					type: "provider.set_policy",
					providerId: "openai",
					expectedUpdatedAt: null,
					patch: {},
				},
			],
		});
		const unknownField = catalogChangeSetInputSchema.safeParse({
			...baseChangeSet,
			operations: [
				{
					version: 1,
					type: "provider.set_policy",
					providerId: "openai",
					expectedUpdatedAt: null,
					patch: {},
					plaintextCredential: "must-never-be-accepted",
				},
			],
		});

		expect(wrongVersion.success).toBe(false);
		expect(unknownField.success).toBe(false);
	});
});

describe("fixed price contracts", () => {
	it("accepts explicit zero and per-resolution decimal strings", () => {
		expect(
			fixedPricesV1Schema.safeParse({
				version: 1,
				request: "0",
				perSecondByResolution: { "1280x720": "0.0125" },
			}).success,
		).toBe(true);
	});

	it("rejects negative, non-decimal, and unknown price keys", () => {
		expect(
			fixedPricesV1Schema.safeParse({ version: 1, request: "-0.1" }).success,
		).toBe(false);
		expect(
			fixedPricesV1Schema.safeParse({ version: 1, request: "free" }).success,
		).toBe(false);
		expect(
			fixedPricesV1Schema.safeParse({ version: 1, mysteryUnit: "1" }).success,
		).toBe(false);
	});
});

describe("source authority contracts", () => {
	it("accepts a V2 fixed price policy and keeps V1 parseable", () => {
		const operations = (fixedPrices: Record<string, unknown>) => [
			{
				version: 1,
				type: "mapping.set_price_policy",
				mappingId: "mapping-1",
				expectedUpdatedAt: null,
				policy: {
					mode: "fixed",
					currency: "USD",
					fixedPrices,
					allowNegativeMargin: false,
				},
			},
		];
		expect(
			catalogChangeSetInputSchema.safeParse({
				...baseChangeSet,
				operations: operations({
					version: 2,
					inputPerMillionTokens: "2",
					cacheReadPerMillionTokens: "0.2",
					audioInputPerMillionTokens: "8",
				}),
			}).success,
		).toBe(true);
		expect(
			catalogChangeSetInputSchema.safeParse({
				...baseChangeSet,
				operations: operations({ version: 1, inputPerMillionTokens: "2" }),
			}).success,
		).toBe(true);
		// The independent fields are a V2 concept; V1 stays frozen.
		expect(
			fixedPricesV1Schema.safeParse({
				version: 1,
				cacheReadPerMillionTokens: "0.2",
			}).success,
		).toBe(false);
		expect(
			fixedPricesV2Schema.safeParse({
				version: 2,
				cacheReadPerMillionTokens: "0.2",
			}).success,
		).toBe(true);
	});

	it("excludes compliance attestations from provider overrides", () => {
		expect(
			providerSourceOverridePatchSchema.safeParse({ dataPolicy: {} }).success,
		).toBe(false);
		expect(
			providerSourceOverridePatchSchema.safeParse({ headquarters: "US" })
				.success,
		).toBe(false);
		expect(
			providerSourceOverridePatchSchema.safeParse({ priority: 5 }).success,
		).toBe(true);
	});

	it("accepts mirror-unit prices with negative exponents in overrides", () => {
		expect(
			mappingSourceOverridePatchSchema.safeParse({ inputPrice: "1.4e-6" })
				.success,
		).toBe(true);
		expect(
			mappingSourceOverridePatchSchema.safeParse({ inputPrice: "-1e-6" })
				.success,
		).toBe(false);
		expect(mappingSourceOverridePatchSchema.safeParse({}).success).toBe(false);
		// externalId has exactly one override path: the mapping policy.
		expect(
			mappingSourceOverridePatchSchema.safeParse({ externalId: "other" })
				.success,
		).toBe(false);
	});

	it("constrains created entity ids and protocols to data-definable values", () => {
		const base = {
			name: "Acme Relay",
			description: "",
			protocol: "openai-chat",
		};
		expect(
			providerCreateSchema.safeParse({ ...base, providerId: "acme-relay" })
				.success,
		).toBe(true);
		expect(
			providerCreateSchema.safeParse({ ...base, providerId: "Acme/Relay" })
				.success,
		).toBe(false);
		expect(
			providerCreateSchema.safeParse({ ...base, providerId: "acme:relay" })
				.success,
		).toBe(false);
		expect(
			providerCreateSchema.safeParse({
				...base,
				providerId: "acme-video",
				protocol: "provider-specific",
			}).success,
		).toBe(false);
	});
});
