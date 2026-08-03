import { createRelativeLink } from "fumadocs-ui/mdx";
import {
	DocsPage,
	DocsBody,
	DocsDescription,
	DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import posthog from "posthog-js";

import { LLMCopyButton, ViewOptions } from "@/components/ai/page-actions";
import { EnterpriseCTA } from "@/components/enterprise-cta";
import { Feedback } from "@/components/feedback";
import { JsonLd } from "@/components/json-ld";
import { docsBaseUrl } from "@/lib/base-url";
import { marketingGuideCanonical } from "@/lib/guide-canonical";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

import type { Metadata } from "next";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
	const { slug = [] } = await params;

	const page = source.getPage(slug);

	if (!page) {
		notFound();
	}

	const path = page.url === "/" ? "" : page.url;
	const canonicalUrl =
		marketingGuideCanonical(page.url) ?? `${docsBaseUrl}${path}`;
	const image = ["/docs-og", ...slug, "image.png"].join("/");

	return {
		metadataBase: new URL(docsBaseUrl),
		title: page.data.title,
		description: page.data.description,
		alternates: {
			canonical: canonicalUrl,
		},
		openGraph: {
			title: page.data.title,
			description: page.data.description,
			url: canonicalUrl,
			images: image,
			type: "article",
			siteName: "betarouter Docs",
		},
		twitter: {
			card: "summary_large_image",
			title: page.data.title,
			description: page.data.description,
			images: image,
		},
	};
}

export default async function Page(props: {
	params: Promise<{ slug?: string[] }>;
}) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) {
		notFound();
	}

	const MDXContent = page.data.body;

	const path = page.url === "/" ? "" : page.url;
	const techArticleSchema = {
		"@context": "https://schema.org",
		"@type": "TechArticle",
		headline: page.data.title,
		description: page.data.description,
		url: marketingGuideCanonical(page.url) ?? `${docsBaseUrl}${path}`,
		author: {
			"@type": "Organization",
			name: "betarouter",
			url: "https://betarouter.com",
		},
		publisher: {
			"@type": "Organization",
			name: "betarouter",
			url: "https://betarouter.com",
		},
	};

	return (
		<DocsPage
			toc={page.data.toc}
			full={page.data.full}
			tableOfContent={{
				style: "clerk",
				footer: <EnterpriseCTA />,
			}}
		>
			<JsonLd data={techArticleSchema} />
			<nav
				aria-label="Page actions"
				className="flex flex-row gap-2 items-center border-b pt-2 pb-6"
			>
				<LLMCopyButton
					markdownUrl={
						page.url === "/" ? "/llms.mdx/index" : `/llms.mdx${page.url}`
					}
				/>
				<ViewOptions
					markdownUrl={
						page.url === "/" ? "/llms.mdx/index" : `/llms.mdx${page.url}`
					}
				/>
			</nav>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDXContent
					components={getMDXComponents({
						// this allows you to link to other pages with relative file paths
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
			<Feedback
				onRateAction={async (_url, feedback) => {
					"use server";
					posthog.capture("on_rate_docs", feedback);
					await Promise.resolve();
				}}
			/>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}
