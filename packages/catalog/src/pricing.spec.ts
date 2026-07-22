import { describe, expect, it } from "vitest";

import { resolveMappingPrice } from "./pricing.js";

describe("resolveMappingPrice", () => {
	it("applies basis-point markup using decimal arithmetic", () => {
		const result = resolveMappingPrice({
			sourcePrices: { input: "1.25", output: "5" },
			policy: { mode: "markup", markupBps: 2000 },
		});

		expect(result.customerPrices).toEqual({ input: "1.5", output: "6" });
		expect(result.margin).toEqual({ input: "0.25", output: "1" });
		expect(result.ready).toBe(true);
	});

	it("requires every source billing unit in fixed mode", () => {
		const result = resolveMappingPrice({
			sourcePrices: { input: "1", output: "2" },
			policy: { mode: "fixed", fixedPrices: { input: "1.5" } },
		});

		expect(result.ready).toBe(false);
		expect(result.missingUnits).toEqual(["output"]);
	});

	it("blocks negative margin unless an audited override is configured", () => {
		const blocked = resolveMappingPrice({
			sourcePrices: { request: "1" },
			policy: { mode: "fixed", fixedPrices: { request: "0.5" } },
		});
		const allowed = resolveMappingPrice({
			sourcePrices: { request: "1" },
			policy: {
				mode: "fixed",
				fixedPrices: { request: "0.5" },
				allowNegativeMargin: true,
				negativeMarginReason: "Launch promotion",
			},
		});

		expect(blocked.ready).toBe(false);
		expect(blocked.negativeMarginUnits).toEqual(["request"]);
		expect(allowed.ready).toBe(true);
	});
});
