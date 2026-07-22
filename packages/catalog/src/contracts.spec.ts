import { describe, expect, it } from "vitest";

import {
	catalogChangeSetInputSchema,
	fixedPricesV1Schema,
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
