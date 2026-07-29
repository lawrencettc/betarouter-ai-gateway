import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonLiteLLM } from "@/components/landing/comparison-litellm";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const liteLlmFaqs: CompareFaqItem[] = [
	{
		question: "What's the difference between betarouter and LiteLLM?",
		answer:
			"LiteLLM is a self-hosted proxy you run and operate yourself. betarouter is a production-ready managed gateway with a dashboard, real-time analytics, and automatic provider routing and fallback — so there's no infrastructure for you to run.",
	},
	{
		question: "Do I have to host it myself like LiteLLM?",
		answer:
			"No. betarouter is a fully managed gateway — sign up, grab an API key, and start routing. There is no proxy to deploy, patch, or scale.",
	},
	{
		question: "How does pricing work compared to LiteLLM?",
		answer:
			"Usage is pay-as-you-go with a flat 5% platform fee on credits, or free when you bring your own provider keys and pay providers directly.",
	},
	{
		question: "Does it provide analytics and routing out of the box?",
		answer:
			"Yes. Real-time cost and latency analytics, automatic provider routing and fallback, budgets and spend controls, and prompt caching are built in — no extra setup required.",
	},
	{
		question: "What are the best LiteLLM alternatives?",
		answer:
			"betarouter is the most complete LiteLLM alternative: a managed cloud gateway with zero markup on your own keys, built-in analytics, and automatic failover. Other options teams evaluate include OpenRouter (managed proxy), Bifrost (self-hosted Go proxy), and Portkey (enterprise governance).",
	},
];

export default function CompareLiteLLMPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Why Choose betarouter Over LiteLLM?",
						description:
							"Compare our production-ready managed gateway with advanced analytics, routing, and enterprise features against LiteLLM's self-hosted proxy solution.",
						badges: [
							"Managed Infrastructure",
							"Advanced Analytics",
							"Enterprise Support",
							"Production Ready",
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
				<ComparisonLiteLLM />
				<CompareFaq
					heading="betarouter vs LiteLLM"
					description="Common questions about choosing betarouter over LiteLLM."
					faqs={liteLlmFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "betarouter vs LiteLLM — Feature Comparison",
		description:
			"Compare managed infrastructure, analytics, and enterprise features vs LiteLLM's self-hosted proxy. See why teams pick a production-ready gateway.",
		alternates: { canonical: "/compare/litellm" },
		openGraph: {
			title: "betarouter vs LiteLLM — Feature Comparison",
			description:
				"Compare managed infrastructure, analytics, and enterprise features vs LiteLLM's self-hosted proxy.",
			type: "website",
			url: "https://betarouter.com/compare/litellm",
		},
		twitter: {
			card: "summary_large_image",
			title: "betarouter vs LiteLLM — Feature Comparison",
			description:
				"Compare managed infrastructure, analytics, and enterprise features vs LiteLLM's self-hosted proxy.",
		},
	};
}
