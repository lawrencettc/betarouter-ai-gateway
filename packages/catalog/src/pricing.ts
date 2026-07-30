import { Decimal } from "decimal.js";

export type PriceUnit =
	| "input"
	| "output"
	| "cachedInput"
	| "cacheRead"
	| "cacheWrite"
	| "cacheWrite1h"
	| "imageInput"
	| "imageOutput"
	| "request"
	| "webSearch"
	| "audioOutput"
	| "audioInput"
	| "cachedImageInput"
	| "cachedAudioInput"
	| "ocrPage"
	| "inputCharacters"
	// Flat USD per hour of input audio (not a per-token rate): how
	// speech-to-text mappings are billed. Kept as its own unit so a fixed
	// price policy that omits it makes the mapping not-ready instead of
	// silently falling back to the source cost.
	| "audioHour"
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

export interface SourceMappingPriceFields {
	inputPrice?: string | null;
	outputPrice?: string | null;
	cachedInputPrice?: string | null;
	cacheReadInputPrice?: string | null;
	cacheWriteInputPrice?: string | null;
	cacheWriteInputPrice1h?: string | null;
	imageInputPrice?: string | null;
	imageOutputPrice?: string | null;
	inputAudioPrice?: string | null;
	cachedImageInputPrice?: string | null;
	cachedInputAudioPrice?: string | null;
	requestPrice?: string | null;
	webSearchPrice?: string | null;
	outputAudioPrice?: string | null;
	ocrPagePrice?: string | null;
	inputCharacterPrice?: string | null;
	inputAudioHourPrice?: string | null;
	perSecondPrice?: Record<string, string> | null;
}

export interface FixedPricesV1Input {
	version: 1;
	inputPerMillionTokens?: string;
	outputPerMillionTokens?: string;
	cachedInputPerMillionTokens?: string;
	cacheWritePerMillionTokens?: string;
	cacheWrite1hPerMillionTokens?: string;
	imageInput?: string;
	imageOutput?: string;
	request?: string;
	webSearch?: string;
	audioOutputPerMillionTokens?: string;
	ocrPage?: string;
	inputPerMillionCharacters?: string;
	audioHour?: string;
	perSecondByResolution?: Record<string, string>;
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

function perMillion(value: string | null | undefined): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	try {
		return new Decimal(value).mul(1_000_000).toString();
	} catch {
		return value;
	}
}

export function sourceMappingPricesToPriceMap(
	mapping: SourceMappingPriceFields,
): PriceMap {
	return {
		...(perMillion(mapping.inputPrice) !== undefined && {
			input: perMillion(mapping.inputPrice),
		}),
		...(perMillion(mapping.outputPrice) !== undefined && {
			output: perMillion(mapping.outputPrice),
		}),
		...(perMillion(mapping.cachedInputPrice) !== undefined && {
			cachedInput: perMillion(mapping.cachedInputPrice),
		}),
		...(perMillion(mapping.cacheReadInputPrice) !== undefined && {
			cacheRead: perMillion(mapping.cacheReadInputPrice),
		}),
		...(perMillion(mapping.cacheWriteInputPrice) !== undefined && {
			cacheWrite: perMillion(mapping.cacheWriteInputPrice),
		}),
		...(perMillion(mapping.cacheWriteInputPrice1h) !== undefined && {
			cacheWrite1h: perMillion(mapping.cacheWriteInputPrice1h),
		}),
		...(perMillion(mapping.imageInputPrice) !== undefined && {
			imageInput: perMillion(mapping.imageInputPrice),
		}),
		...(perMillion(mapping.imageOutputPrice) !== undefined && {
			imageOutput: perMillion(mapping.imageOutputPrice),
		}),
		...(mapping.requestPrice !== null &&
			mapping.requestPrice !== undefined && {
				request: mapping.requestPrice,
			}),
		...(mapping.webSearchPrice !== null &&
			mapping.webSearchPrice !== undefined && {
				webSearch: mapping.webSearchPrice,
			}),
		...(perMillion(mapping.outputAudioPrice) !== undefined && {
			audioOutput: perMillion(mapping.outputAudioPrice),
		}),
		...(perMillion(mapping.inputAudioPrice) !== undefined && {
			audioInput: perMillion(mapping.inputAudioPrice),
		}),
		...(perMillion(mapping.cachedImageInputPrice) !== undefined && {
			cachedImageInput: perMillion(mapping.cachedImageInputPrice),
		}),
		...(perMillion(mapping.cachedInputAudioPrice) !== undefined && {
			cachedAudioInput: perMillion(mapping.cachedInputAudioPrice),
		}),
		...(mapping.ocrPagePrice !== null &&
			mapping.ocrPagePrice !== undefined && {
				ocrPage: mapping.ocrPagePrice,
			}),
		...(perMillion(mapping.inputCharacterPrice) !== undefined && {
			inputCharacters: perMillion(mapping.inputCharacterPrice),
		}),
		...(mapping.inputAudioHourPrice !== null &&
			mapping.inputAudioHourPrice !== undefined && {
				audioHour: mapping.inputAudioHourPrice,
			}),
		...Object.fromEntries(
			Object.entries(mapping.perSecondPrice ?? {}).map(([key, value]) => [
				`second:${key}`,
				value,
			]),
		),
	};
}

export function fixedPricesV1ToPriceMap(fixed: FixedPricesV1Input): PriceMap {
	return {
		...(fixed.inputPerMillionTokens !== undefined && {
			input: fixed.inputPerMillionTokens,
			audioInput: fixed.inputPerMillionTokens,
		}),
		...(fixed.outputPerMillionTokens !== undefined && {
			output: fixed.outputPerMillionTokens,
		}),
		...(fixed.cachedInputPerMillionTokens !== undefined && {
			cachedInput: fixed.cachedInputPerMillionTokens,
			cacheRead: fixed.cachedInputPerMillionTokens,
			cachedImageInput: fixed.cachedInputPerMillionTokens,
			cachedAudioInput: fixed.cachedInputPerMillionTokens,
		}),
		...(fixed.cacheWritePerMillionTokens !== undefined && {
			cacheWrite: fixed.cacheWritePerMillionTokens,
		}),
		...(fixed.cacheWrite1hPerMillionTokens !== undefined && {
			cacheWrite1h: fixed.cacheWrite1hPerMillionTokens,
		}),
		...(fixed.imageInput !== undefined && { imageInput: fixed.imageInput }),
		...(fixed.imageOutput !== undefined && { imageOutput: fixed.imageOutput }),
		...(fixed.request !== undefined && { request: fixed.request }),
		...(fixed.webSearch !== undefined && { webSearch: fixed.webSearch }),
		...(fixed.audioOutputPerMillionTokens !== undefined && {
			audioOutput: fixed.audioOutputPerMillionTokens,
		}),
		...(fixed.ocrPage !== undefined && { ocrPage: fixed.ocrPage }),
		...(fixed.inputPerMillionCharacters !== undefined && {
			inputCharacters: fixed.inputPerMillionCharacters,
		}),
		...(fixed.audioHour !== undefined && { audioHour: fixed.audioHour }),
		...Object.fromEntries(
			Object.entries(fixed.perSecondByResolution ?? {}).map(([key, value]) => [
				`second:${key}`,
				value,
			]),
		),
	};
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
			sourceEntries.length > 0 &&
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
