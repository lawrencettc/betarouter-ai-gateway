import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonVercel } from "@/components/landing/comparison-vercel";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const vercelFaqs: CompareFaqItem[] = [
	{
		question: "Is betarouter a good Vercel AI Gateway alternative?",
		answer:
			"Yes. Both pass provider token rates through with zero markup and offer automatic failover and caching. The difference is portability: betarouter isn't tied to a Vercel team account or deploy target, and works with any language or framework.",
	},
	{
		question: "Does it work with the Vercel AI SDK?",
		answer:
			"Yes. betarouter is OpenAI-compatible, so it plugs straight into the AI SDK's OpenAI-compatible provider — you keep using `generateText` and `streamText`, just pointed at betarouter instead of the default gateway.",
	},
	{
		question: "How does pricing compare to Vercel AI Gateway?",
		answer:
			"Both charge no markup on tokens. betarouter adds a flat 5% platform fee on credits, or 0% when you bring your own provider keys — and there are no team-seat or governance add-ons gated behind a higher plan.",
	},
	{
		question: "What can betarouter do that Vercel AI Gateway doesn't?",
		answer:
			"Generate images and video through the same API, use built-in guardrails (PII, prompt injection, secrets) without a paid add-on, and route through any provider — not just the ones on Vercel's list.",
	},
];

export default function CompareVercelPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "The Portable Vercel AI Gateway Alternative",
						description:
							"Compare betarouter's portable platform — with zero token markup, image and video generation, and built-in guardrails — against Vercel AI Gateway's managed, AI SDK-native service.",
						badges: [
							"Zero Token Markup",
							"No Lock-In",
							"Image & Video Gen",
							"Built-in Guardrails",
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
				<ComparisonVercel />
				<CompareFaq
					heading="betarouter vs Vercel AI Gateway"
					description="Common questions about choosing betarouter over Vercel AI Gateway."
					faqs={vercelFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "betarouter vs Vercel AI Gateway — The Alternative",
		description:
			"Compare portable routing with zero token markup and guardrails vs Vercel AI Gateway's managed AI SDK service.",
		alternates: {
			canonical: "/compare/vercel-ai-gateway",
		},
		openGraph: {
			title: "betarouter vs Vercel AI Gateway — Feature Comparison",
			description:
				"Portable platform with zero token markup vs Vercel AI Gateway's managed service.",
			type: "website",
			url: "https://betarouter.com/compare/vercel-ai-gateway",
		},
		twitter: {
			card: "summary_large_image",
			title: "betarouter vs Vercel AI Gateway — Feature Comparison",
			description:
				"Portable platform with zero token markup vs Vercel AI Gateway's managed service.",
		},
	};
}
