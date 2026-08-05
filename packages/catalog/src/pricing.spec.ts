import { describe, expect, it } from "vitest";

import {
	fixedPricesToPriceMap,
	fixedPricesV1ToPriceMap,
	fixedPricesV2ToPriceMap,
	resolveMappingPrice,
	sourceMappingPricesToPriceMap,
} from "./pricing.js";

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

	it("normalizes token prices to per-million units and keeps unit prices", () => {
		expect(
			sourceMappingPricesToPriceMap({
				inputPrice: "0.00000125",
				requestPrice: "0.02",
				perSecondPrice: { hd: "0.1" },
			}),
		).toEqual({ input: "1.25", request: "0.02", "second:hd": "0.1" });
	});

	it("maps the versioned fixed-price contract into billing units", () => {
		expect(
			fixedPricesV1ToPriceMap({
				version: 1,
				inputPerMillionTokens: "2",
				ocrPage: "0.01",
			}),
		).toEqual({ input: "2", audioInput: "2", ocrPage: "0.01" });
	});

	it("requires at least one source billing unit", () => {
		expect(
			resolveMappingPrice({
				sourcePrices: {},
				policy: { mode: "source_cost" },
			}),
		).toMatchObject({ ready: false });
	});
});

describe("fixedPricesV2ToPriceMap", () => {
	it("keeps V1 aliasing when the independent fields are absent", () => {
		expect(
			fixedPricesV2ToPriceMap({
				version: 2,
				inputPerMillionTokens: "2",
				cachedInputPerMillionTokens: "0.5",
			}),
		).toEqual({
			input: "2",
			audioInput: "2",
			cachedInput: "0.5",
			cacheRead: "0.5",
			cachedImageInput: "0.5",
			cachedAudioInput: "0.5",
		});
	});

	it("prices aliased units independently when set", () => {
		expect(
			fixedPricesV2ToPriceMap({
				version: 2,
				inputPerMillionTokens: "2",
				cachedInputPerMillionTokens: "0.5",
				cacheReadPerMillionTokens: "0.2",
				cachedImageInputPerMillionTokens: "0.3",
				cachedAudioInputPerMillionTokens: "0.4",
				audioInputPerMillionTokens: "8",
			}),
		).toEqual({
			input: "2",
			audioInput: "8",
			cachedInput: "0.5",
			cacheRead: "0.2",
			cachedImageInput: "0.3",
			cachedAudioInput: "0.4",
		});
	});

	it("dispatches by version so stored V1 policies stay readable", () => {
		expect(
			fixedPricesToPriceMap({ version: 1, inputPerMillionTokens: "2" }),
		).toEqual(
			fixedPricesV1ToPriceMap({ version: 1, inputPerMillionTokens: "2" }),
		);
		expect(
			fixedPricesToPriceMap({
				version: 2,
				inputPerMillionTokens: "2",
				audioInputPerMillionTokens: "8",
			}),
		).toEqual({ input: "2", audioInput: "8" });
	});
});
