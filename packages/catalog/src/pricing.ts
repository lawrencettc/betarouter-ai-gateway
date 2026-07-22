import { Decimal } from "decimal.js";

export type PriceUnit =
	| "input"
	| "output"
	| "cachedInput"
	| "cacheWrite"
	| "cacheWrite1h"
	| "imageInput"
	| "imageOutput"
	| "request"
	| "webSearch"
	| "audioOutput"
	| "ocrPage"
	| "inputCharacters"
	| `second:${string}`;

export type PriceMap = Partial<Record<PriceUnit, string>>;

interface PricePolicyBase {
	allowNegativeMargin?: boolean;
	negativeMarginReason?: string;
}

export type MappingPricePolicy =
	| (PricePolicyBase & { mode: "source_cost" })
	| (PricePolicyBase & { mode: "markup"; markupBps: number })
	| (PricePolicyBase & { mode: "fixed"; fixedPrices: PriceMap });

export interface ResolveMappingPriceInput {
	sourcePrices: PriceMap;
	policy: MappingPricePolicy;
}

export interface ResolvedMappingPrice {
	ready: boolean;
	customerPrices: PriceMap;
	margin: PriceMap;
	missingUnits: PriceUnit[];
	invalidUnits: PriceUnit[];
	negativeMarginUnits: PriceUnit[];
}

function decimal(value: string): Decimal | null {
	try {
		const parsed = new Decimal(value);
		return parsed.isFinite() && !parsed.isNegative() ? parsed : null;
	} catch {
		return null;
	}
}

export function resolveMappingPrice(
	input: ResolveMappingPriceInput,
): ResolvedMappingPrice {
	const sourceEntries = Object.entries(input.sourcePrices).sort(
		([left], [right]) => left.localeCompare(right),
	) as [PriceUnit, string][];
	const customerPrices: PriceMap = {};
	const margin: PriceMap = {};
	const missingUnits: PriceUnit[] = [];
	const invalidUnits: PriceUnit[] = [];
	const negativeMarginUnits: PriceUnit[] = [];

	for (const [unit, rawSource] of sourceEntries) {
		const source = decimal(rawSource);
		if (!source) {
			invalidUnits.push(unit);
			continue;
		}

		let customer: Decimal | null;
		switch (input.policy.mode) {
			case "source_cost":
				customer = source;
				break;
			case "markup":
				customer = source.mul(
					new Decimal(1).plus(new Decimal(input.policy.markupBps).div(10_000)),
				);
				break;
			case "fixed": {
				const fixed = input.policy.fixedPrices[unit];
				if (fixed === undefined) {
					missingUnits.push(unit);
					continue;
				}
				customer = decimal(fixed);
				break;
			}
		}

		if (!customer || customer.isNegative()) {
			invalidUnits.push(unit);
			continue;
		}

		const unitMargin = customer.minus(source);
		customerPrices[unit] = customer.toString();
		margin[unit] = unitMargin.toString();
		if (unitMargin.isNegative()) {
			negativeMarginUnits.push(unit);
		}
	}

	const negativeMarginAllowed =
		input.policy.allowNegativeMargin === true &&
		Boolean(input.policy.negativeMarginReason?.trim());

	return {
		ready:
			missingUnits.length === 0 &&
			invalidUnits.length === 0 &&
			(negativeMarginUnits.length === 0 || negativeMarginAllowed),
		customerPrices,
		margin,
		missingUnits,
		invalidUnits,
		negativeMarginUnits,
	};
}
