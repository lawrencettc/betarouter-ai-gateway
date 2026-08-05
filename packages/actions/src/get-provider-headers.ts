import {
	getProviderProtocol,
	resolveVertexTokenType,
	type ProviderId,
	type ProviderProtocol,
	type VertexTokenType,
} from "@betarouter/models";

import type { ProviderKeyOptions } from "@betarouter/db";

export interface ProviderHeaderOptions {
	/**
	 * Enable web search beta header for Anthropic
	 */
	webSearchEnabled?: boolean;
	requestId?: string;
	providerKeyOptions?: ProviderKeyOptions;
	configIndex?: number;
	/**
	 * Skip env-var fallback when resolving the Vertex/Quartz token type, so
	 * header auth matches the endpoint in BYOK contexts. Must mirror the
	 * `skipEnvVars` passed to {@link getProviderEndpoint} for the same request.
	 */
	skipEnvVars?: boolean;
	/**
	 * Pre-resolved Vertex/Quartz token type. When set it takes precedence over
	 * `providerKeyOptions`/`skipEnvVars` resolution, so the caller can resolve
	 * the token type once and feed the identical value to both
	 * {@link getProviderEndpoint} and this function (avoids header auth and the
	 * `?key=` query param disagreeing).
	 */
	tokenType?: VertexTokenType;
	/**
	 * OpenAI-compatible processing tier selected by the caller via the
	 * `service_tier` request field. For Google Vertex AI, "flex" and "priority"
	 * are mapped to the `X-Vertex-AI-LLM-Shared-Request-Type` header (Flex /
	 * Priority PayGo). Other values and other providers ignore this.
	 */
	serviceTier?: string;
	/**
	 * Wire protocol for providers outside the static catalogue (database-defined
	 * providers). Ignored when the provider id has a declared protocol in code.
	 */
	protocol?: ProviderProtocol;
}

/**
 * Get the appropriate headers for a given provider API call. Auth headers are
 * selected by the provider's declared wire protocol; named providers with
 * deployment-specific auth (Vertex OAuth, Azure api-key, AWS bearer, ...)
 * keep id-keyed special cases ahead of the protocol defaults.
 */
export function getProviderHeaders(
	provider: ProviderId | string,
	token: string,
	options?: ProviderHeaderOptions,
): Record<string, string> {
	const requestIdHeader: Record<string, string> = {};
	if (options?.requestId) {
		requestIdHeader["x-request-id"] = options.requestId;
	}

	switch (provider) {
		case "google-vertex": {
			const vertexHeaders: Record<string, string> = { ...requestIdHeader };
			const tokenType =
				options?.tokenType ??
				resolveVertexTokenType(
					provider,
					options?.providerKeyOptions,
					options?.configIndex,
					options?.skipEnvVars,
				);
			if (tokenType === "oauth") {
				vertexHeaders.Authorization = `Bearer ${token}`;
			}
			// Map the OpenAI-compatible `service_tier` to Vertex's Flex / Priority
			// PayGo headers. Only "flex" and "priority" are valid; standard/default
			// requests omit them. Flex and Priority PayGo are served only on the
			// global endpoint (the gateway's default Vertex region).
			//
			// Two headers are required: `X-Vertex-AI-LLM-Shared-Request-Type`
			// selects the tier, and `X-Vertex-AI-LLM-Request-Type: shared` forces
			// the shared PayGo path. Without the latter, a project that has
			// Provisioned Throughput allocated consumes PT first and never reaches
			// the shared Flex/Priority tier, so the request is silently served (and
			// billed) as standard. An explicit service_tier request always wants the
			// shared tier, so we bypass PT unconditionally (no-op on projects
			// without PT).
			if (
				options?.serviceTier === "flex" ||
				options?.serviceTier === "priority"
			) {
				vertexHeaders["X-Vertex-AI-LLM-Request-Type"] = "shared";
				vertexHeaders["X-Vertex-AI-LLM-Shared-Request-Type"] =
					options.serviceTier;
			}
			return vertexHeaders;
		}
		case "vertex-anthropic":
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
		case "avalanche":
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
		case "aws-bedrock":
		case "aws-mantle":
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			};
		case "azure":
		case "azure-ai-foundry":
			return {
				...requestIdHeader,
				"api-key": token,
			};
		case "elevenlabs":
			return {
				...requestIdHeader,
				"xi-api-key": token,
			};
		default:
			break;
	}

	// Protocol-family default auth — any provider without an id-keyed special
	// case above (including database-defined providers) resolves here.
	switch (getProviderProtocol(provider) ?? options?.protocol) {
		case "anthropic-messages": {
			const betaFeatures = ["tools-2024-04-04", "prompt-caching-2024-07-31"];
			if (options?.webSearchEnabled) {
				betaFeatures.push("web-search-2025-03-05");
			}
			return {
				...requestIdHeader,
				"x-api-key": token,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": betaFeatures.join(","),
			};
		}
		case "google-generative":
			return requestIdHeader;
		case "openai-chat":
		default:
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
	}
}
