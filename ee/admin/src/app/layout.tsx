import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";

import { AdminShell } from "@/components/admin-shell";
import { getConfig } from "@/lib/config-server";
import { Providers } from "@/lib/providers";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const geistSans = Inter({
	variable: "--font-geist-sans",
	subsets: ["latin"],
	display: "swap",
});

const geistMono = JetBrains_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
	variable: "--font-bricolage",
	subsets: ["latin"],
	weight: ["600", "700", "800"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://admin.betarouter.com"),
	title: "betarouter admin",
	description: "Admin dashboard for betarouter.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	robots: {
		index: false,
		follow: false,
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} antialiased`}
			>
				<Providers config={config}>
					<AdminShell>{children}</AdminShell>
				</Providers>
			</body>
		</html>
	);
}
