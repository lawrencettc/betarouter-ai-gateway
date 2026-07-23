import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import platformProviders, {
	assertRevealRateLimit,
	toPlatformProviderCredentialResponse,
} from "./platform-providers.js";

import type { Variables } from "@/auth/config.js";
import type { ServerTypes } from "@/vars.js";
import type { platformProviderCredential } from "@betarouter/db";

const cacheMocks = vi.hoisted(() => ({
	counts: new Map<string, number>(),
	incr: vi.fn(async (key: string) => {
		const count = (cacheMocks.counts.get(key) ?? 0) + 1;
		cacheMocks.counts.set(key, count);
		return count;
	}),
	expire: vi.fn(async () => true),
}));

vi.mock("@betarouter/cache", () => ({
	redisClient: {
		incr: cacheMocks.incr,
		expire: cacheMocks.expire,
	},
}));

function testApp(user?: Variables["user"], session?: Variables["session"]) {
	const app = new OpenAPIHono<ServerTypes>();
	app.use("/*", async (c, next) => {
		c.set("user", user ?? null);
		c.set("session", session ?? null);
		await next();
	});
	app.route("/", platformProviders);
	return app;
}

describe("platform provider route security", () => {
	const originalAdminEmails = process.env.ADMIN_EMAILS;
	const originalPlatformAdminIds = process.env.PLATFORM_ADMIN_USER_IDS;
	const originalAdminUrl = process.env.ADMIN_URL;

	beforeEach(() => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		process.env.PLATFORM_ADMIN_USER_IDS = "trusted-user";
		process.env.ADMIN_URL = "https://admin.betarouter.com";
		cacheMocks.counts.clear();
		cacheMocks.incr.mockClear();
		cacheMocks.expire.mockClear();
	});

	afterEach(() => {
		for (const [key, value] of [
			["ADMIN_EMAILS", originalAdminEmails],
			["PLATFORM_ADMIN_USER_IDS", originalPlatformAdminIds],
			["ADMIN_URL", originalAdminUrl],
		] as const) {
			if (value === undefined) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = value;
			}
		}
	});

	it("denies an email-allowlisted user whose immutable ID is not allowed", async () => {
		const app = testApp({
			id: "attacker-user",
			email: "admin@example.com",
		} as Variables["user"]);

		const response = await app.request("/");

		expect(response.status).toBe(403);
	});

	it("denies reveal requests from a different browser origin", async () => {
		const app = testApp(
			{
				id: "trusted-user",
				email: "admin@example.com",
			} as Variables["user"],
			{ createdAt: new Date() } as Variables["session"],
		);

		const response = await app.request("/credential-1/reveal", {
			method: "POST",
			headers: { Origin: "https://evil.example.com" },
		});

		expect(response.status).toBe(403);
		expect(cacheMocks.incr).not.toHaveBeenCalled();
	});

	it("requires a recent sign-in before revealing a credential", async () => {
		const app = testApp(
			{
				id: "trusted-user",
				email: "admin@example.com",
			} as Variables["user"],
			{
				createdAt: new Date(Date.now() - 960_000),
			} as Variables["session"],
		);

		const response = await app.request("/credential-1/reveal", {
			method: "POST",
			headers: { Origin: "https://admin.betarouter.com" },
		});

		expect(response.status).toBe(403);
		expect(cacheMocks.incr).not.toHaveBeenCalled();
	});

	it("blocks the sixth reveal attempt for one credential", async () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			await expect(
				assertRevealRateLimit("trusted-user", "credential-1"),
			).resolves.toBeUndefined();
		}

		await expect(
			assertRevealRateLimit("trusted-user", "credential-1"),
		).rejects.toMatchObject({ status: 429 });
	});

	it("redacts every secret-bearing storage field from mutation responses", () => {
		const credential = {
			id: "credential-1",
			createdAt: new Date(),
			createdBy: "trusted-user",
			updatedAt: new Date(),
			updatedBy: "trusted-user",
			deletedAt: null,
			provider: "openai",
			name: "Primary",
			baseUrl: null,
			options: null,
			priority: 100,
			status: "active",
			encryptedToken: "ciphertext-secret",
			encryptionIv: "iv-secret",
			encryptionAuthTag: "tag-secret",
			encryptionKeyVersion: "v1",
			maskedToken: "sk-p••••last",
			tokenFingerprint: "fingerprint-secret",
			validationStatus: "valid",
			validationMessage: "Credential validated successfully",
			lastValidatedAt: new Date(),
			lastUsedAt: null,
			lastRevealedAt: null,
			lastRevealedBy: null,
		} satisfies typeof platformProviderCredential.$inferSelect;

		const serialized = JSON.stringify(
			toPlatformProviderCredentialResponse(credential),
		);

		expect(serialized).toContain("sk-p••••last");
		expect(serialized).not.toMatch(
			/ciphertext-secret|iv-secret|tag-secret|fingerprint-secret/,
		);
	});
});
