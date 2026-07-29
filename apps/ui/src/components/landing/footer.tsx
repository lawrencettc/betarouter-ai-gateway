"use client";
import Link from "next/link";

import Newsletter from "@/components/landing/newsletter";
import { useAppConfig } from "@/lib/config";

import { providers as providerDefinitions } from "@betarouter/models";

export default function Footer() {
	const config = useAppConfig();
	const filteredProviders = providerDefinitions.filter(
		(p) => p.name !== "betarouter",
	);

	return (
		<footer className="relative py-12 bg-background">
			{/* Gradient separator */}
			<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

			<div className="container mx-auto px-4">
				<Newsletter />

				<div className="flex flex-col md:flex-row md:justify-between md:items-start">
					<div className="mb-8 md:mb-0 md:w-48 md:shrink-0">
						<a
							href="https://status.betarouter.com/"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
						>
							<span className="relative flex h-2 w-2">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
								<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
							</span>
							All systems operational
						</a>
					</div>

					<div className="w-full md:w-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8 text-muted-foreground">
						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Product
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href="#features"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Features
									</a>
								</li>
								<li>
									<Link
										href="/models"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Models
									</Link>
								</li>
								<li>
									<Link
										href="/providers"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Providers
									</Link>
								</li>
								<li>
									<Link
										href="/add-provider"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Add Provider
									</Link>
								</li>
								<li>
									<a
										href={config.playgroundUrl}
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										rel="noopener"
										target="_blank"
									>
										Chat Playground
									</a>
								</li>
								<li>
									<Link
										href="/changelog"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Changelog
									</Link>
								</li>
								<li>
									<a
										href="https://betapass.betarouter.com"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										BetaPass
									</a>
								</li>
								<li>
									<Link
										href="/models/compare"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Compare Models
									</Link>
								</li>
								<li>
									<Link
										href="/enterprise"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Enterprise
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Resources
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/apps"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Apps
									</Link>
								</li>
								<li>
									<Link
										href="/templates"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Templates
									</Link>
								</li>
								<li>
									<Link
										href="/agents"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Agents
									</Link>
								</li>
								<li>
									<Link
										href="/mcp"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										MCP Server
									</Link>
								</li>
								<li>
									<Link
										href="/use-cases"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Use Cases
									</Link>
								</li>
								<li>
									<a
										href={config.docsUrl ?? ""}
										target="_blank"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Documentation
									</a>
								</li>
								<li>
									<Link
										href="/integrations"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Integrations
									</Link>
								</li>
								<li>
									<Link
										href="/guides"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Guides
									</Link>
								</li>
								<li>
									<Link
										href="/brand"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Brand Assets
									</Link>
								</li>
								<li>
									<Link
										href="/token-cost-calculator"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Token Cost Calculator
									</Link>
								</li>
								<li>
									<Link
										href="/copilot-cost-calculator"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Copilot Cost Calculator
									</Link>
								</li>
								<li>
									<Link
										href="/referrals"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Referral Program
									</Link>
								</li>
								<li>
									<a
										href="mailto:contact@betarouter.com"
										target="_blank"
										rel="noreferrer noopener"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Contact Us
									</a>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Legal
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/legal/terms"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Terms
									</Link>
								</li>
								<li>
									<Link
										href="/legal/privacy"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Privacy Policy
									</Link>
								</li>
								<li>
									<Link
										href="/legal/privacy"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										GDPR
									</Link>
								</li>
								<li>
									<a
										href="https://status.betarouter.com/"
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Status
									</a>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Compare
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/compare/github-copilot"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										GitHub Copilot
									</Link>
								</li>
								<li>
									<Link
										href="/compare/open-router"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										OpenRouter
									</Link>
								</li>
								<li>
									<Link
										href="/compare/litellm"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										LiteLLM
									</Link>
								</li>
								<li>
									<Link
										href="/compare/portkey"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Portkey
									</Link>
								</li>
								<li>
									<Link
										href="/compare/aws-bedrock"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										AWS Bedrock
									</Link>
								</li>
								<li>
									<Link
										href="/compare/azure-ai-foundry"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Azure AI Foundry
									</Link>
								</li>
								<li>
									<Link
										href="/migration"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Migration Guides
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Models
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/models/text"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Text Generation
									</Link>
								</li>
								<li>
									<Link
										href="/models/text-to-image"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Text to Image
									</Link>
								</li>
								<li>
									<Link
										href="/models/image-to-image"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Image to Image
									</Link>
								</li>
								<li>
									<Link
										href="/models/video"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Video Generation
									</Link>
								</li>
								<li>
									<Link
										href="/models/embeddings"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Embeddings
									</Link>
								</li>
								<li>
									<Link
										href="/models/vision"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Vision
									</Link>
								</li>
								<li>
									<Link
										href="/models/reasoning"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Reasoning
									</Link>
								</li>
								<li>
									<Link
										href="/models/tools"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Tool Calling
									</Link>
								</li>
								<li>
									<Link
										href="/models/web-search"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Web Search
									</Link>
								</li>
								<li>
									<Link
										href="/models/discounted"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Discounted
									</Link>
								</li>
								<li>
									<Link
										href="/models/roleplay"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Best for Roleplay
									</Link>
								</li>
								<li>
									<Link
										href="/models/coding"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Best for Coding
									</Link>
								</li>
								<li>
									<Link
										href="/models/creative-writing"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Best for Creative Writing
									</Link>
								</li>
								<li>
									<Link
										href="/models/translation"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Best for Translation
									</Link>
								</li>
								<li>
									<Link
										href="/models/math"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Best for Math
									</Link>
								</li>
								<li>
									<Link
										href="/models/long-context"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Long Context
									</Link>
								</li>
								<li>
									<Link
										href="/models/cheapest"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Cheapest
									</Link>
								</li>
								<li>
									<Link
										href="/models/open-source"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Open Source
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Providers
							</h3>
							<ul className="space-y-2">
								{filteredProviders.map((provider) => (
									<li key={provider.id}>
										<Link
											href={`/providers/${provider.id}`}
											className="text-sm hover:underline underline-offset-4 hover:text-foreground"
											prefetch={true}
										>
											{provider.name}
										</Link>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>

				{/* Bottom bar */}
				<div className="border-t border-border/50 pt-8 mt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						&copy; {new Date().getFullYear()} betarouter. All rights reserved.
					</p>
				</div>
			</div>
		</footer>
	);
}
