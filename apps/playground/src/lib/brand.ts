/**
 * Playground brand constants — the single source of truth for the product
 * name. Analytics identifiers (PostHog `app: "chat"`, `playground_*` events)
 * and billing ids (chat plan tiers, Stripe products) deliberately keep their
 * original names and must not be derived from these strings.
 */
export const BRAND = {
	/** Product noun, used in running prose: "the Playground adds GPT". */
	name: "Playground",
	/** Display form for hero moments. */
	displayName: "The Playground",
	/** Formal lockup for metadata, OG and legal surfaces. */
	fullName: "betarouter Playground",
	/** Parent brand. */
	publisher: "betarouter",
	tagline: "Every frontier model. One plan.",
	url: "https://chat.betarouter.com",
} as const;
