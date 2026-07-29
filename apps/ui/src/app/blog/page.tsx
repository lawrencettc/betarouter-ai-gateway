import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

export default function BlogPage() {
	return (
		<>
			<HeroRSC navbarOnly />
			<main className="flex min-h-[70vh] items-center bg-background px-4 pb-20 pt-32 text-foreground sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center">
					<p className="mb-4 text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
						betarouter Blog
					</p>
					<h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
						Original stories are coming soon.
					</h1>
					<p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
						We are preparing practical guides, product updates, and operating
						notes written specifically for betarouter.
					</p>
					<div className="mt-8 flex flex-wrap justify-center gap-3">
						<Link
							href="/models"
							className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
						>
							Explore models
						</Link>
						<Link
							href="/"
							className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
						>
							Back to betarouter
						</Link>
					</div>
				</div>
			</main>
			<Footer />
		</>
	);
}

export async function generateMetadata() {
	return {
		title: "Blog — Coming Soon",
		description:
			"Original betarouter guides, product updates, and operating notes are coming soon.",
		alternates: { canonical: "/blog" },
		robots: {
			index: false,
			follow: true,
		},
		openGraph: {
			title: "betarouter Blog — Coming Soon",
			description:
				"Original betarouter guides, product updates, and operating notes are coming soon.",
			type: "website",
			url: "https://betarouter.com/blog",
		},
		twitter: {
			card: "summary_large_image",
			title: "betarouter Blog — Coming Soon",
			description:
				"Original betarouter guides, product updates, and operating notes are coming soon.",
		},
	};
}
