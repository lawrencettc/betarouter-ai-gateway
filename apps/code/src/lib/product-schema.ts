import { DEV_PLAN_PRICES } from "@betarouter/shared";

/**
 * Product + AggregateOffer JSON-LD for the three BetaPass plans, shared by the
 * landing and pricing pages so plan data stays in one place. `offerUrl` should
 * point at the page (or anchor) where the plans are visible.
 */
export function buildDevPassProductSchema(offerUrl: string) {
	return {
		"@context": "https://schema.org",
		"@type": "Product",
		name: "BetaPass by betarouter",
		description:
			"Flat-rate AI coding plans with access to 200+ models — Claude Opus 4.8, GPT-5.5, Gemini 3.1 Pro, GLM-4.7, and more. Works with Claude Code, OpenCode, Empryo, SoulForge, and any OpenAI-compatible tool.",
		brand: {
			"@type": "Brand",
			name: "betarouter",
		},
		offers: {
			"@type": "AggregateOffer",
			priceCurrency: "USD",
			lowPrice: DEV_PLAN_PRICES.lite,
			highPrice: DEV_PLAN_PRICES.max,
			offerCount: 3,
			offers: [
				{
					"@type": "Offer",
					name: "BetaPass Lite",
					price: DEV_PLAN_PRICES.lite,
					priceCurrency: "USD",
					url: offerUrl,
					availability: "https://schema.org/InStock",
					priceSpecification: {
						"@type": "UnitPriceSpecification",
						price: DEV_PLAN_PRICES.lite,
						priceCurrency: "USD",
						unitCode: "MON",
						referenceQuantity: {
							"@type": "QuantitativeValue",
							value: 1,
							unitCode: "MON",
						},
					},
				},
				{
					"@type": "Offer",
					name: "BetaPass Pro",
					price: DEV_PLAN_PRICES.pro,
					priceCurrency: "USD",
					url: offerUrl,
					availability: "https://schema.org/InStock",
					priceSpecification: {
						"@type": "UnitPriceSpecification",
						price: DEV_PLAN_PRICES.pro,
						priceCurrency: "USD",
						unitCode: "MON",
						referenceQuantity: {
							"@type": "QuantitativeValue",
							value: 1,
							unitCode: "MON",
						},
					},
				},
				{
					"@type": "Offer",
					name: "BetaPass Max",
					price: DEV_PLAN_PRICES.max,
					priceCurrency: "USD",
					url: offerUrl,
					availability: "https://schema.org/InStock",
					priceSpecification: {
						"@type": "UnitPriceSpecification",
						price: DEV_PLAN_PRICES.max,
						priceCurrency: "USD",
						unitCode: "MON",
						referenceQuantity: {
							"@type": "QuantitativeValue",
							value: 1,
							unitCode: "MON",
						},
					},
				},
			],
		},
	};
}
