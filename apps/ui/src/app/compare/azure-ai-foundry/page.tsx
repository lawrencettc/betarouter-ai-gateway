import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonAzureFoundry } from "@/components/landing/comparison-azure-foundry";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const foundryFaqs: CompareFaqItem[] = [
	{
		question: "Is betarouter a good Azure AI Foundry alternative?",
		answer:
			"Yes — if you want frontier models without committing to one cloud. betarouter puts 200+ models from 40+ providers behind a single OpenAI-compatible API, with automatic routing, failover, caching, and per-request cost analytics. There are no deployments or TPM quotas to manage.",
	},
	{
		question: "Can I keep using Azure with betarouter?",
		answer:
			"Yes. Azure OpenAI and Azure AI Foundry are built-in betarouter providers. Bring your Azure credentials and route your Azure traffic through the gateway with 0% markup — you keep your Microsoft agreements and compliance posture while gaining cross-provider failover, caching, and unified analytics on top.",
	},
	{
		question: "Doesn't Foundry already have OpenAI and Claude models?",
		answer:
			"It does — Foundry hosts OpenAI's models and Anthropic's Claude family, among a large Azure-hosted catalog. But everything runs inside Azure: there's no Google Gemini and no fast independent hosts like Groq or Cerebras, and each model needs a deployment with quota. betarouter routes across all of them, including Azure itself, from one API with no provisioning.",
	},
	{
		question: "How does pricing compare to Azure AI Foundry?",
		answer:
			"Foundry bills model rates through your Azure subscription, with provisioned-throughput (PTU) reservations for guaranteed capacity. betarouter charges the same provider rates with a flat 5% platform fee on credits — or 0% when you bring your own provider keys, including Azure credentials.",
	},
	{
		question: "How hard is it to migrate from Azure AI Foundry to betarouter?",
		answer:
			"Minimal effort. betarouter exposes an OpenAI-compatible API, so most apps switch by changing the base URL and API key. There are no resources to create, models to deploy, or regional quotas to plan — sign up, create a key, and every supported model is available immediately.",
	},
];

export default function CompareAzureFoundryPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking Beyond Azure AI Foundry?",
						description:
							"Foundry gives you the models Azure hosts — after you create resources, deployments, and quotas. betarouter gives you every major lab and cloud — including Azure itself — behind one OpenAI-compatible API. No provisioning required.",
						badges: [
							"Cloud-Neutral",
							"Zero Token Markup",
							"No Deployments or Quotas",
							"Azure Built In",
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
				<ComparisonAzureFoundry />
				<CompareFaq
					heading="betarouter vs Azure AI Foundry"
					description="Common questions about using betarouter alongside or instead of Azure AI Foundry."
					faqs={foundryFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "betarouter vs Azure AI Foundry — The Cloud-Neutral Alternative",
		description:
			"Compare 40+ providers behind one OpenAI-compatible API vs Azure AI Foundry. Keep Azure with 0% markup plus failover, caching, and cost analytics.",
		alternates: { canonical: "/compare/azure-ai-foundry" },
		openGraph: {
			title: "betarouter vs Azure AI Foundry — Feature Comparison",
			description:
				"Cloud-neutral gateway vs Azure AI Foundry. Route to Azure and 40+ providers from one API with failover and analytics.",
			type: "website",
			url: "https://betarouter.com/compare/azure-ai-foundry",
		},
		twitter: {
			card: "summary_large_image",
			title: "betarouter vs Azure AI Foundry — Feature Comparison",
			description:
				"Cloud-neutral gateway vs Azure AI Foundry. Route to Azure and 40+ providers from one API.",
		},
	};
}
