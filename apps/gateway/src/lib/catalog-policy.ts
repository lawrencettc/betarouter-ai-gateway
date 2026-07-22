import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import {
	evaluateCatalogRequest,
	getEffectiveCatalogSnapshot,
	readCatalogFeatureFlags,
} from "@llmgateway/catalog";
import { logger } from "@llmgateway/logger";

import type {
	CatalogRequestDecision,
	CatalogRequestInput,
	EffectiveMapping,
} from "@llmgateway/catalog";
import type { ProviderModelMapping } from "@llmgateway/models";

interface EnforceCatalogRequestOptions {
	setHeader?: (name: string, value: string) => void;
}

function perUnit(value: string | undefined): string | undefined {
	return value === undefined
		? undefined
		: new Decimal(value).div(1_000_000).toString();
}

function applyCatalogCustomerPrices(
	provider: ProviderModelMapping,
	mapping: EffectiveMapping,
): ProviderModelMapping {
	const prices = mapping.customerPrices;
	const priceMultiplier =
		mapping.pricingMode === "markup"
			? new Decimal(1).plus(new Decimal(mapping.markupBps ?? 0).div(10_000))
			: null;
	const pricingTiers = provider.pricingTiers?.map((tier) => {
		if (mapping.pricingMode === "source_cost" || !mapping.pricingMode) {
			return tier;
		}
		if (mapping.pricingMode === "markup" && priceMultiplier) {
			return {
				...tier,
				inputPrice: new Decimal(tier.inputPrice)
					.mul(priceMultiplier)
					.toString(),
				outputPrice: new Decimal(tier.outputPrice)
					.mul(priceMultiplier)
					.toString(),
				cachedInputPrice:
					tier.cachedInputPrice === undefined
						? undefined
						: new Decimal(tier.cachedInputPrice)
								.mul(priceMultiplier)
								.toString(),
				cacheReadInputPrice:
					tier.cacheReadInputPrice === undefined
						? undefined
						: new Decimal(tier.cacheReadInputPrice)
								.mul(priceMultiplier)
								.toString(),
				cacheWriteInputPrice:
					tier.cacheWriteInputPrice === undefined
						? undefined
						: new Decimal(tier.cacheWriteInputPrice)
								.mul(priceMultiplier)
								.toString(),
				cacheWriteInputPrice1h:
					tier.cacheWriteInputPrice1h === undefined
						? undefined
						: new Decimal(tier.cacheWriteInputPrice1h)
								.mul(priceMultiplier)
								.toString(),
			};
		}
		return {
			...tier,
			...(perUnit(prices.input) !== undefined && {
				inputPrice: perUnit(prices.input)!,
			}),
			...(perUnit(prices.output) !== undefined && {
				outputPrice: perUnit(prices.output)!,
			}),
			cachedInputPrice: perUnit(prices.cachedInput),
			cacheReadInputPrice: perUnit(prices.cacheRead),
			cacheWriteInputPrice: perUnit(prices.cacheWrite),
			cacheWriteInputPrice1h: perUnit(prices.cacheWrite1h),
		};
	});
	return {
		...provider,
		externalId: mapping.externalId,
		region: mapping.region ?? undefined,
		inputPrice: perUnit(prices.input),
		outputPrice: perUnit(prices.output),
		cachedInputPrice: perUnit(prices.cachedInput),
		cacheReadInputPrice: perUnit(prices.cacheRead),
		cacheWriteInputPrice: perUnit(prices.cacheWrite),
		cacheWriteInputPrice1h: perUnit(prices.cacheWrite1h),
		imageInputPrice: perUnit(prices.imageInput),
		imageOutputPrice: perUnit(prices.imageOutput),
		inputAudioPrice: perUnit(prices.audioInput),
		cachedImageInputPrice: perUnit(prices.cachedImageInput),
		cachedInputAudioPrice: perUnit(prices.cachedAudioInput),
		outputAudioPrice: perUnit(prices.audioOutput),
		inputCharacterPrice: perUnit(prices.inputCharacters),
		requestPrice: prices.request,
		webSearchPrice: prices.webSearch,
		ocrPagePrice: prices.ocrPage,
		perSecondPrice: Object.fromEntries(
			Object.entries(prices).flatMap(([unit, value]) =>
				unit.startsWith("second:") && value !== undefined
					? [[unit.slice("second:".length), value]]
					: [],
			),
		),
		pricingTiers,
	};
}

export async function enforceCatalogRequest(
	input: CatalogRequestInput,
	options: EnforceCatalogRequestOptions = {},
): Promise<Extract<CatalogRequestDecision, { allowed: true }> | null> {
	if (input.modelId === "auto" || input.modelId === "custom") {
		return null;
	}
	const flags = readCatalogFeatureFlags();
	if (!flags.routingEnabled && !flags.shadowRead) {
		return null;
	}
	const snapshot = await getEffectiveCatalogSnapshot();
	const decision = evaluateCatalogRequest(snapshot, input);
	if (flags.shadowRead) {
		logger.info("Catalog routing decision", {
			mode: flags.routingEnabled ? "enforce" : "shadow",
			revision: snapshot.revision,
			modelId: input.modelId,
			providerId: input.providerId,
			region: input.region,
			allowed: decision.allowed,
			...(decision.allowed
				? { mappingIds: decision.mappingIds }
				: { code: decision.code, status: decision.status }),
		});
	}
	if (!flags.routingEnabled) {
		return null;
	}
	if (!decision.allowed) {
		const body = {
			error: {
				code: decision.code,
				message:
					decision.code === "model_retired"
						? "The requested model has been retired"
						: decision.code === "model_temporarily_unavailable"
							? "The requested model is temporarily unavailable"
							: "The requested model is not available",
				retryable: decision.retryable,
				replacementModelId: decision.replacementModelId,
				retireAt: decision.retireAt,
			},
		};
		throw new HTTPException(decision.status, {
			res: new Response(JSON.stringify(body), {
				status: decision.status,
				headers: {
					"content-type": "application/json",
					...(decision.retryable ? { "retry-after": "60" } : {}),
				},
			}),
		});
	}
	if (decision.deprecated) {
		options.setHeader?.("Deprecation", "true");
		if (decision.retireAt) {
			options.setHeader?.("Sunset", new Date(decision.retireAt).toUTCString());
		}
		if (decision.replacementModelId) {
			options.setHeader?.(
				"BetaRouter-Replacement-Model",
				decision.replacementModelId,
			);
		}
	}
	return decision;
}

export function filterProviderMappingsByCatalog(
	providers: ProviderModelMapping[],
	decision: Extract<CatalogRequestDecision, { allowed: true }> | null,
): ProviderModelMapping[] {
	if (!decision) {
		return providers;
	}
	return decision.mappings.flatMap((mapping) => {
		const provider = providers.find(
			(candidate) =>
				candidate.providerId === mapping.providerId &&
				(candidate.region === undefined ||
					(candidate.region ?? null) === mapping.region),
		);
		return provider ? [applyCatalogCustomerPrices(provider, mapping)] : [];
	});
}

export function findCatalogMappingForProvider(
	decision: Extract<CatalogRequestDecision, { allowed: true }> | null,
	providerId: string | undefined,
	region?: string | null,
): EffectiveMapping | null {
	if (!decision) {
		return null;
	}
	if (!providerId) {
		return null;
	}
	return (
		decision.mappings.find(
			(mapping) =>
				mapping.providerId === providerId &&
				(region === undefined || mapping.region === region),
		) ?? null
	);
}
