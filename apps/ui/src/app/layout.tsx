import { Inter, JetBrains_Mono, Bricolage_Grotesque } from "next/font/google";

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
	// globals.css maps the Tailwind token: --font-mono: var(--font-geist-mono).
	// Registering the font under --font-mono directly would leave that theme
	// mapping dangling and every `font-mono` element falls back to sans.
	variable: "--font-geist-mono",
	subsets: ["latin"],
	display: "swap",
});

const plusJakarta = Bricolage_Grotesque({
	variable: "--font-display",
	subsets: ["latin"],
	weight: ["300", "400", "500", "600", "700", "800"],
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://betarouter.com"),
	title: {
		default: "betarouter - Unified API for Multiple LLM Providers",
		template: "%s | betarouter",
	},
	description:
		"Route, manage, and analyze LLM requests across OpenAI, Anthropic, Google, and 40+ providers through one unified API.",
	authors: [{ name: "betarouter" }],
	creator: "betarouter",
	publisher: "betarouter",
	icons: {
		icon: [
			{ url: "/favicon/favicon.ico?v=1", sizes: "any" },
			{
				url: "/favicon/favicon-16x16.png?v=1",
				sizes: "16x16",
				type: "image/png",
			},
			{
				url: "/favicon/favicon-32x32.png?v=1",
				sizes: "32x32",
				type: "image/png",
			},
		],
		apple: [{ url: "/favicon/apple-touch-icon.png?v=1", sizes: "180x180" }],
	},
	manifest: "/favicon/site.webmanifest?v=1",
	alternates: {
		canonical: "./",
	},
	openGraph: {
		title: "betarouter - Unified API for Multiple LLM Providers",
		description:
			"Route, manage, and analyze LLM requests across OpenAI, Anthropic, Google, and 40+ providers through one unified API.",
		images: ["/opengraph.png?v=4"],
		type: "website",
		url: "https://betarouter.com",
		siteName: "betarouter",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "betarouter - Unified API for Multiple LLM Providers",
		description:
			"Route, manage, and analyze LLM requests across 40+ providers through one unified API.",
		images: ["/opengraph.png?v=4"],
		creator: "@betarouterco",
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
};

const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "betarouter",
	url: "https://betarouter.com",
	logo: {
		"@type": "ImageObject",
		url: "https://betarouter.com/favicon/android-chrome-512x512.png",
		width: 512,
		height: 512,
	},
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	sameAs: ["https://x.com/betarouterco"],
	contactPoint: {
		"@type": "ContactPoint",
		email: "contact@betarouter.com",
		contactType: "customer support",
	},
};

const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "betarouter",
	url: "https://betarouter.com",
	potentialAction: {
		"@type": "SearchAction",
		target: {
			"@type": "EntryPoint",
			urlTemplate: "https://betarouter.com/models?search={search_term_string}",
		},
		"query-input": "required name=search_term_string",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html
			lang="en"
			className={`${inter.variable} ${geistMono.variable} ${plusJakarta.variable}`}
			suppressHydrationWarning
		>
			<head>
				<link rel="preconnect" href="https://platform-api.betarouter.com" />
				<link rel="preconnect" href="https://docs.betarouter.com" />
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(organizationSchema),
					}}
				/>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(websiteSchema),
					}}
				/>
			</head>
			<body className="min-h-screen antialiased">
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
