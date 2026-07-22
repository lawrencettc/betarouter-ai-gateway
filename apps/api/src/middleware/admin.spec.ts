import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import { isAdminEmail, isPlatformAdminUser } from "./admin.js";

describe("isAdminEmail", () => {
	const originalEnv = process.env.ADMIN_EMAILS;

	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.ADMIN_EMAILS = originalEnv;
		} else {
			delete process.env.ADMIN_EMAILS;
		}
	});

	test("returns false when email is null", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
		expect(isAdminEmail(null)).toBe(false);
	});

	test("returns false when email is undefined", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
		expect(isAdminEmail(undefined)).toBe(false);
	});

	test("returns false when email is empty string", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
		expect(isAdminEmail("")).toBe(false);
	});

	test("returns false when ADMIN_EMAILS is not set", () => {
		delete process.env.ADMIN_EMAILS;
		expect(isAdminEmail("admin@example.com")).toBe(false);
	});

	test("returns false when ADMIN_EMAILS is empty", () => {
		vi.stubEnv("ADMIN_EMAILS", "");
		expect(isAdminEmail("admin@example.com")).toBe(false);
	});

	test("returns true when email matches single admin email", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
		expect(isAdminEmail("admin@example.com")).toBe(true);
	});

	test("returns true when email matches one of multiple admin emails", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin1@example.com,admin2@example.com");
		expect(isAdminEmail("admin2@example.com")).toBe(true);
	});

	test("returns false when email does not match any admin email", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
		expect(isAdminEmail("user@example.com")).toBe(false);
	});

	test("is case insensitive for email comparison", () => {
		vi.stubEnv("ADMIN_EMAILS", "Admin@Example.com");
		expect(isAdminEmail("admin@example.com")).toBe(true);
		expect(isAdminEmail("ADMIN@EXAMPLE.COM")).toBe(true);
	});

	test("handles whitespace in ADMIN_EMAILS", () => {
		vi.stubEnv("ADMIN_EMAILS", " admin1@example.com , admin2@example.com ");
		expect(isAdminEmail("admin1@example.com")).toBe(true);
		expect(isAdminEmail("admin2@example.com")).toBe(true);
	});

	test("ignores empty entries in ADMIN_EMAILS", () => {
		vi.stubEnv("ADMIN_EMAILS", "admin@example.com,,other@example.com,");
		expect(isAdminEmail("admin@example.com")).toBe(true);
		expect(isAdminEmail("other@example.com")).toBe(true);
	});
});

describe("isPlatformAdminUser", () => {
	const originalAdminEmails = process.env.ADMIN_EMAILS;
	const originalPlatformAdminIds = process.env.PLATFORM_ADMIN_USER_IDS;

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

	test("requires both the email and immutable user ID allowlists", () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		process.env.PLATFORM_ADMIN_USER_IDS = "trusted-user";

		expect(
			isPlatformAdminUser({ id: "trusted-user", email: "admin@example.com" }),
		).toBe(true);
		expect(
			isPlatformAdminUser({ id: "attacker-user", email: "admin@example.com" }),
		).toBe(false);
		expect(
			isPlatformAdminUser({ id: "trusted-user", email: "other@example.com" }),
		).toBe(false);
	});

	test("fails closed when the immutable user ID allowlist is missing", () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		delete process.env.PLATFORM_ADMIN_USER_IDS;

		expect(
			isPlatformAdminUser({ id: "trusted-user", email: "admin@example.com" }),
		).toBe(false);
	});
});
