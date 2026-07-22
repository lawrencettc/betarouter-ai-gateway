import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import platformCatalog, {
	matchesCatalogSearch,
	serializeMappingPricePolicy,
} from "./platform-catalog.js";

import type { Variables } from "@/auth/config.js";
import type { ServerTypes } from "@/vars.js";

function testApp(user?: Variables["user"]) {
	const app = new OpenAPIHono<ServerTypes>();
	app.use("/*", async (c, next) => {
		c.set("user", user ?? null);
		c.set("session", null);
		await next();
	});
	app.route("/", platformCatalog);
	return app;
}

describe("platform catalog route security", () => {
	const originalAdminEmails = process.env.ADMIN_EMAILS;
	const originalPlatformAdminIds = process.env.PLATFORM_ADMIN_USER_IDS;

	beforeEach(() => {
		process.env.ADMIN_EMAILS = "operator@example.com";
		process.env.PLATFORM_ADMIN_USER_IDS = "trusted-operator";
	});

	afterEach(() => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		if (originalPlatformAdminIds === undefined) {
			delete process.env.PLATFORM_ADMIN_USER_IDS;
		} else {
			process.env.PLATFORM_ADMIN_USER_IDS = originalPlatformAdminIds;
		}
	});

	it("rejects anonymous catalog reads", async () => {
		const response = await testApp().request("/summary");
		expect(response.status).toBe(403);
	});

	it("rejects anonymous source refresh attempts", async () => {
		const response = await testApp().request("/source/refresh", {
			method: "POST",
		});
		expect(response.status).toBe(403);
	});

	it("rejects an allowlisted email whose immutable user ID is not trusted", async () => {
		const response = await testApp({
			id: "different-user",
			email: "operator@example.com",
		} as Variables["user"]).request("/change-sets/preview", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(403);
	});
});

describe("platform catalog search", () => {
	it("matches mappings by canonical model, provider, and external ID", () => {
		const mapping = {
			id: "opaque-mapping-id",
			providerId: "openai",
			modelId: "gpt-5.5",
			externalId: "relay/gpt-5.5",
		};

		expect(matchesCatalogSearch(mapping, "gpt-5.5")).toBe(true);
		expect(matchesCatalogSearch(mapping, "openai")).toBe(true);
		expect(matchesCatalogSearch(mapping, "relay/gpt-5.5")).toBe(true);
		expect(matchesCatalogSearch(mapping, "anthropic")).toBe(false);
	});
});

describe("platform catalog price policy serialization", () => {
	it("serializes source-cost and markup policies without foreign fields", () => {
		const updatedAt = new Date("2026-07-22T14:00:00.000Z");
		const common = {
			mappingId: "mapping-policy",
			currency: "USD" as const,
			fixedPrices: null,
			allowNegativeMargin: false,
			negativeMarginReason: null,
			updatedAt,
			updatedBy: "operator",
		};

		expect(
			serializeMappingPricePolicy({
				...common,
				mode: "source_cost",
				markupBps: null,
			}),
		).toEqual({
			mode: "source_cost",
			currency: "USD",
			allowNegativeMargin: false,
		});

		expect(
			serializeMappingPricePolicy({
				...common,
				mode: "markup",
				markupBps: 2500,
			}),
		).toEqual({
			mode: "markup",
			currency: "USD",
			markupBps: 2500,
			allowNegativeMargin: false,
		});
	});

	it("omits markup-only fields from a fixed price policy", () => {
		const updatedAt = new Date("2026-07-22T14:00:00.000Z");

		expect(
			serializeMappingPricePolicy({
				mappingId: "mapping-fixed",
				currency: "USD",
				mode: "fixed",
				markupBps: null,
				fixedPrices: {
					version: 1,
					inputPerMillionTokens: "5",
					outputPerMillionTokens: "30",
				},
				allowNegativeMargin: false,
				negativeMarginReason: null,
				updatedAt,
				updatedBy: "operator",
			}),
		).toEqual({
			mode: "fixed",
			currency: "USD",
			fixedPrices: {
				version: 1,
				inputPerMillionTokens: "5",
				outputPerMillionTokens: "30",
			},
			allowNegativeMargin: false,
		});
	});
});
