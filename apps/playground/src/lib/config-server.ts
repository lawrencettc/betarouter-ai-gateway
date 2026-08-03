export interface AppConfig {
	hosted: boolean;
	apiUrl: string;
	apiBackendUrl: string;
	discordUrl: string;
	twitterUrl: string;
	docsUrl: string;
	adminUrl: string;
	posthogKey?: string;
	posthogHost?: string;
	stripePublishableKey?: string;
	githubAuth: boolean;
	googleAuth: boolean;
}

export function getConfig(): AppConfig {
	const apiUrl = process.env.API_URL ?? "http://localhost:4002";
	return {
		hosted: process.env.HOSTED === "true",
		apiUrl,
		apiBackendUrl: process.env.API_BACKEND_URL ?? apiUrl,
		discordUrl: process.env.DISCORD_URL ?? "https://betarouter.com/discord",
		twitterUrl: process.env.TWITTER_URL ?? "https://x.com/betarouterco",
		docsUrl: process.env.DOCS_URL ?? "http://localhost:3005",
		adminUrl: process.env.ADMIN_URL ?? "http://localhost:3006",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
		githubAuth: !!process.env.GITHUB_CLIENT_ID,
		googleAuth: !!process.env.GOOGLE_CLIENT_ID,
	};
}
