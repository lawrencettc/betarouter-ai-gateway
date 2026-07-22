import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import platformCatalog from "./platform-catalog.js";

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
