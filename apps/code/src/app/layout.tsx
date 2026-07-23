import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";

import { GoogleTag } from "@/components/google-tag";
import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
	display: "swap",
});

const geistMono = JetBrains_Mono({
	variable: "--font-mono",
	subsets: ["latin"],
	display: "swap",
});

const bricolage = Bricolage_Grotesque({
	variable: "--font-bricolage",
	subsets: ["latin"],
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://devpass.betarouter.com"),
	title: {
		default: "DevPass by betarouter - All-Access Dev Plans for AI Coding",
		template: "%s | DevPass by betarouter",
	},
	description:
		"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, Cline, and any OpenAI-compatible tool. 200+ models, one API key.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
	openGraph: {
		title: "DevPass by betarouter - All-Access Dev Plans for AI Coding",
		description:
			"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, Cline, and any OpenAI-compatible tool.",
		images: ["/opengraph.png?v=2"],
		type: "website",
		url: "https://devpass.betarouter.com",
		siteName: "DevPass by betarouter",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "DevPass by betarouter - All-Access Dev Plans for AI Coding",
		description:
			"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, and 200+ models.",
		images: ["/opengraph.png?v=2"],
		creator: "@betarouterco",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "DevPass by betarouter",
	url: "https://devpass.betarouter.com",
	description:
		"Fixed-price dev plans for AI-powered coding with Claude Code, Cursor, Cline, and any OpenAI-compatible tool. One subscription, every model.",
	publisher: {
		"@type": "Organization",
		name: "betarouter",
		url: "https://betarouter.com",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html
			lang="en"
			className={`${inter.variable} ${geistMono.variable} ${bricolage.variable}`}
			suppressHydrationWarning
		>
			<head>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(webSiteSchema),
					}}
				/>
			</head>
			<body className="antialiased">
				<GoogleTag
					googleTagId={config.googleTagId}
					googleAdsSignupConversion={config.googleAdsSignupConversion}
					googleAdsPurchaseConversion={config.googleAdsPurchaseConversion}
				/>
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
