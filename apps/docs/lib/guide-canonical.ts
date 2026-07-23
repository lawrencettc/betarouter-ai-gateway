// Guides are published on both hosts with the same content:
// docs.betarouter.com/guides/* and betarouter.com/guides/*. The marketing site
// is the primary copy (indexed, in its sitemap, receives the traffic), so
// shared guides canonicalize cross-domain to it instead of competing with it.
// Docs-only guides without a marketing-site counterpart stay self-canonical —
// add new docs-only guide slugs here, otherwise their canonical points at a
// 404 on the marketing site.
const docsOnlyGuideSlugs = new Set(["agent-skills", "cli"]);

export function marketingGuideCanonical(pageUrl: string): string | null {
	const match = /^\/guides\/([^/]+)$/.exec(pageUrl);
	if (!match || docsOnlyGuideSlugs.has(match[1])) {
		return null;
	}
	return `https://betarouter.com/guides/${match[1]}`;
}
