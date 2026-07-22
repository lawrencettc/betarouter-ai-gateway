export interface CatalogFeatureFlags {
	shadowRead: boolean;
	discoveryEnabled: boolean;
	routingEnabled: boolean;
	breakerMode: "off" | "observe" | "enforce";
}

function enabled(value: string | undefined): boolean {
	return value === "true" || value === "1";
}

export function readCatalogFeatureFlags(
	env: NodeJS.ProcessEnv = process.env,
): CatalogFeatureFlags {
	const rawBreakerMode = env.PLATFORM_CATALOG_BREAKER_MODE;
	const breakerMode = new Set(["observe", "enforce"]).has(rawBreakerMode ?? "")
		? (rawBreakerMode as "observe" | "enforce")
		: "off";
	return {
		shadowRead: enabled(env.PLATFORM_CATALOG_SHADOW_READ),
		discoveryEnabled: enabled(env.PLATFORM_CATALOG_DISCOVERY_ENABLED),
		routingEnabled: enabled(env.PLATFORM_CATALOG_ROUTING_ENABLED),
		breakerMode,
	};
}
