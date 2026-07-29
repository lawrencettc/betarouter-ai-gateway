import { EnterpriseCapabilities } from "@/components/enterprise/capabilities";
import { ContactFormEnterprise } from "@/components/enterprise/contact";
import { FeaturesEnterprise } from "@/components/enterprise/features";
import { HeroEnterprise } from "@/components/enterprise/hero";
import { InfrastructureAsCodeEnterprise } from "@/components/enterprise/iac";
import { PricingEnterprise } from "@/components/enterprise/pricing";
import { ProcurementEnterprise } from "@/components/enterprise/procurement";
import { ProductShowcase } from "@/components/enterprise/product-showcase";
import { SecurityEnterprise } from "@/components/enterprise/security";
import { SupportEnterprise } from "@/components/enterprise/support";
import { TrustBarEnterprise } from "@/components/enterprise/trust-bar";
import { UptimeVisualization } from "@/components/enterprise/uptime";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { Testimonials } from "@/components/landing/testimonials";
import { fetchServerData } from "@/lib/server-api";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Enterprise betarouter – SSO, Audit Logs & Guardrails",
	description:
		"LLM infrastructure with SAML SSO, audit logs, prompt-injection guardrails, per-project routing, and white-label chat for regulated teams.",
	alternates: { canonical: "/enterprise" },
	openGraph: {
		title: "Enterprise betarouter",
		description:
			"SAML SSO, audit logs, guardrails, per-project routing, and white-label chat for regulated teams putting LLMs in production.",
		type: "website",
		url: "https://betarouter.com/enterprise",
	},
	twitter: {
		card: "summary_large_image",
		title: "Enterprise betarouter",
		description:
			"SAML SSO, audit logs, guardrails, per-project routing, and white-label chat for regulated teams.",
	},
};

export const revalidate = 300;

interface PublicAppsResponse {
	totalTokens: number;
	totalRequests: number;
}

export default async function EnterprisePage() {
	const stats = await fetchServerData<PublicAppsResponse>(
		"GET",
		"/public/apps",
		{ params: { query: { limit: "1" } } },
	);

	return (
		<div>
			<HeroRSC navbarOnly />
			<HeroEnterprise
				totalTokens={stats?.totalTokens}
				totalRequests={stats?.totalRequests}
			/>
			<TrustBarEnterprise />
			<SecurityEnterprise />
			<SupportEnterprise />
			<EnterpriseCapabilities />
			<UptimeVisualization />
			<FeaturesEnterprise />
			<ProductShowcase />
			<Testimonials />
			<PricingEnterprise />
			<InfrastructureAsCodeEnterprise />
			<ProcurementEnterprise />
			<ContactFormEnterprise />
			<Footer />
		</div>
	);
}
