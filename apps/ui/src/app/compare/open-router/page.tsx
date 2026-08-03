import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { Comparison } from "@/components/landing/comparison";
import Footer from "@/components/landing/footer";

import { MARKETING_STATS } from "@betarouter/shared";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const openRouterFaqs: CompareFaqItem[] = [
	{
		question: "How is betarouter different from OpenRouter?",
		answer:
			"betarouter adds deeper real-time cost and latency analytics for every request, free Bring Your Own Keys, and flexible enterprise add-ons such as dedicated infrastructure and custom SLAs.",
	},
	{
		question: "How does pricing compare to OpenRouter?",
		answer: `Use pay-as-you-go credits with a flat 5% platform fee, or bring your own provider keys and pay providers directly for free. Token pricing matches provider rates with no markup, and optional full data retention is billed at ${MARKETING_STATS.dataStoragePrice}.`,
	},
	{
		question: "Which models and providers are supported?",
		answer:
			"200+ models across 40+ providers — including GPT, Claude, Gemini, Llama, and Mistral — with new releases typically added within 48 hours of launch.",
	},
	{
		question: "Can I switch from OpenRouter easily?",
		answer:
			"Yes. betarouter is OpenAI-compatible, so you migrate by swapping the base URL and API key — no code rewrite required.",
	},
];

export default function CompareOpenRouterPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare />
				<Comparison />
				<CompareFaq
					heading="betarouter vs OpenRouter"
					description="Common questions about switching from OpenRouter to betarouter."
					faqs={openRouterFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "betarouter vs OpenRouter — Feature Comparison",
		description:
			"Compare routing, analytics, and cost optimization vs OpenRouter. See why teams choose a unified API gateway for production LLMs.",
		alternates: { canonical: "/compare/open-router" },
		openGraph: {
			title: "betarouter vs OpenRouter — Feature Comparison",
			description:
				"Compare routing, analytics, and cost optimization vs OpenRouter. See why teams choose a unified API gateway for production LLMs.",
			type: "website",
			url: "https://betarouter.com/compare/open-router",
		},
		twitter: {
			card: "summary_large_image",
			title: "betarouter vs OpenRouter — Feature Comparison",
			description:
				"Compare routing, analytics, and cost optimization vs OpenRouter for production LLMs.",
		},
	};
}
