import { Inter, JetBrains_Mono, Bricolage_Grotesque } from "next/font/google";

import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";
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
	weight: ["300", "400", "500", "600", "700", "800"],
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://chat.betarouter.com"),
	title: {
		default: "AI Playground — Chat with 200+ Models (GPT, Claude, Gemini)",
		template: "%s | betarouter Playground",
	},
	description:
		"Test and compare 200+ AI models from one account. Chat with GPT, Claude, and Gemini, generate images and video, and run multi-model group chats.",
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
		title: `${BRAND.fullName} — Chat with 200+ AI Models (GPT, Claude, Gemini)`,
		description:
			"Test and compare 200+ AI models from one account. Chat, generate images and videos, and run multi-model group chats — pay-as-you-go.",
		images: ["/opengraph.png?v=4"],
		type: "website",
		url: "https://chat.betarouter.com",
		siteName: "betarouter Playground",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: `${BRAND.fullName} — Chat with 200+ AI Models (GPT, Claude, Gemini)`,
		description:
			"Test and compare 200+ AI models from one account. Chat, generate images and videos, and run multi-model group chats — pay-as-you-go.",
		images: ["/opengraph.png?v=4"],
		creator: "@betarouterco",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "betarouter Playground",
	url: "https://chat.betarouter.com",
	description:
		"Chat with 200+ AI models, generate images and videos, and run multi-model group chats.",
	publisher: {
		"@type": "Organization",
		name: "betarouter",
		url: "https://betarouter.com",
	},
};

const softwareApplicationSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "betarouter Playground",
	url: "https://chat.betarouter.com",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	description:
		"Chat with 200+ AI models including GPT, Claude, and Gemini, plus image and video generation — one plan, every frontier model.",
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
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(softwareApplicationSchema),
					}}
				/>
			</head>
			<body className="antialiased">
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
