import { describe, expect, test } from "vitest";

import manifest from "@/app/manifest";

import { BRAND } from "./brand";
import { comparisons, US } from "./comparisons";

describe("playground brand", () => {
	test("brand constants carry the betarouter identity", () => {
		expect(BRAND.name).toBe("Playground");
		expect(BRAND.fullName).toBe("betarouter Playground");
		expect(BRAND.publisher).toBe("betarouter");
		expect(BRAND.tagline).toBe("Every frontier model. One plan.");
		expect(BRAND.url).toBe("https://chat.betarouter.com");
	});

	test("web manifest uses the betarouter lockup", () => {
		const m = manifest();
		expect(m.name).toBe(BRAND.fullName);
		expect(m.short_name).toBe(BRAND.name);
	});

	test("comparison pages present the product as betarouter Chat", () => {
		expect(US.name).toBe("betarouter Chat");
		for (const comparison of comparisons) {
			expect(comparison.metaTitle).toContain("betarouter");
		}
	});

	test("no comparison copy uses a foreign product name", () => {
		const serialized = JSON.stringify(comparisons);
		expect(serialized).not.toContain("Lounge");
		expect(serialized).not.toContain("llmgateway");
	});
});
