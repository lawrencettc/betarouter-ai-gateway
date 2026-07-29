import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonPortkey } from "@/components/landing/comparison-portkey";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const portkeyFaqs: CompareFaqItem[] = [
	{
		question: "Is betarouter a good Portkey alternative?",
		answer:
			"Yes. betarouter offers automatic provider routing and fallback, real-time cost and latency analytics, and transparent per-token pricing with no markup — all through one OpenAI-compatible endpoint.",
	},
	{
		question: "How does pricing compare to Portkey?",
		answer:
			"Pay per token at provider rates with a flat 5% platform fee on credits, or bring your own provider keys and pay providers directly for free. There are no per-seat or request-volume tiers.",
	},
	{
		question: "Can I migrate from Portkey without changing my code?",
		answer:
			"Yes. betarouter exposes an OpenAI-compatible API, so you switch by changing the base URL and API key. You get 200+ models across 40+ providers behind that single endpoint.",
	},
	{
		question: "Does betarouter support image and video generation?",
		answer:
			"Yes. Image and video generation are available through the same unified API, alongside chat, embeddings, and tool calling.",
	},
];

export default function ComparePortkeyPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking for a Portkey Alternative?",
						description:
							"Compare betarouter's automatic provider routing, real-time analytics, and transparent pricing against Portkey's gateway and LLMOps suite.",
						badges: [
							"Automatic Routing",
							"Real-time Analytics",
							"Image & Video Gen",
							"Transparent Pricing",
						],
						cta: {
							primary: {
								text: "Start for Free",
								href: "/signup",
							},
							secondary: {
								text: "View Documentation",
								href: "https://docs.betarouter.com",
								external: true,
							},
						},
					}}
				/>
				<ComparisonPortkey />
				<CompareFaq
					heading="betarouter vs Portkey"
					description="Common questions about switching from Portkey to betarouter."
					faqs={portkeyFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "betarouter vs Portkey — The Portkey Alternative",
		description:
			"Compare automatic routing, image and video generation, and transparent pricing vs Portkey's gateway and LLMOps suite.",
		alternates: { canonical: "/compare/portkey" },
		openGraph: {
			title: "betarouter vs Portkey — Feature Comparison",
			description:
				"Automatic routing and transparent pricing vs Portkey's gateway and LLMOps suite.",
			type: "website",
			url: "https://betarouter.com/compare/portkey",
		},
		twitter: {
			card: "summary_large_image",
			title: "betarouter vs Portkey — Feature Comparison",
			description:
				"Automatic routing and transparent pricing vs Portkey's gateway and LLMOps suite.",
		},
	};
}
