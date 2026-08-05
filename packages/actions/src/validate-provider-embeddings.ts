import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface EmbeddingsValidationTarget {
	externalId: string;
	region?: string | null;
}

/**
 * The `minimal-embeddings` mapping-test probe: send one minimal,
 * non-sensitive embeddings request through the exact deployment the mapping
 * routes to (credential base URL + effective external id) and require a JSON
 * success body. This is the embeddings counterpart of `validateProviderKey`'s
 * minimal chat request — chat-shaped probes cannot validate embedding
 * deployments because the request shape and endpoint differ per provider.
 */
export async function validateProviderEmbeddings(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: EmbeddingsValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const probeInput = "Hello";
	const resolvedBaseUrl =
		baseUrl ?? getProviderDefaultBaseUrl(provider) ?? "https://api.openai.com";

	let endpoint: string;
	let payload: Record<string, unknown>;
	if (provider === "google-ai-studio") {
		endpoint = `${resolvedBaseUrl}/v1beta/models/${target.externalId}:embedContent?key=${encodeURIComponent(token)}`;
		payload = { content: { parts: [{ text: probeInput }] } };
	} else if (provider === "google-vertex") {
		if (providerKeyOptions?.google_vertex_token_type === "oauth") {
			return {
				valid: false,
				error:
					"OAuth-based Google Vertex credentials are not supported by the embeddings probe; use an API-key credential",
			};
		}
		const projectId = providerKeyOptions?.google_vertex_project_id;
		if (!projectId) {
			return {
				valid: false,
				error:
					"Google Vertex embeddings probes require google_vertex_project_id on the credential options",
			};
		}
		const region = target.region ?? "global";
		endpoint = `${resolvedBaseUrl}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${target.externalId}:predict?key=${encodeURIComponent(token)}`;
		payload = { instances: [{ content: probeInput }] };
	} else if (provider === "deepinfra") {
		// DeepInfra's base URL already ends in /v1/openai, so the embeddings
		// path is /embeddings (a /v1 prefix would double up and 404).
		endpoint = `${resolvedBaseUrl}/embeddings`;
		payload = { input: probeInput, model: target.externalId };
	} else {
		// Every other embeddings deployment is OpenAI-compatible, including
		// admin-created relays on the openai-chat protocol.
		endpoint = `${resolvedBaseUrl}/v1/embeddings`;
		payload = { input: probeInput, model: target.externalId };
	}

	try {
		const headers = getProviderHeaders(provider, token, {
			providerKeyOptions,
			skipEnvVars: true,
		});
		headers["Content-Type"] = "application/json";

		const response = await fetch(endpoint, {
			method: "POST",
			// SSRF: never follow redirects when probing a tenant-supplied baseUrl,
			// which could 3xx to an internal host (and would leak the token).
			redirect: "error",
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage = `${response.status} ${response.statusText}`;
			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message;
				} else if (errorJson.message) {
					errorMessage = errorJson.message;
				}
			} catch {}
			logger.warn("Embeddings probe returned error response", {
				provider,
				externalId: target.externalId,
				statusCode: response.status,
				error: errorMessage,
			});
			return {
				valid: false,
				error: errorMessage,
				statusCode: response.status,
			};
		}

		// A 2xx alone is not proof the probe reached a real API: a misconfigured
		// base URL can land on an HTML frontend that answers 200 to any POST.
		const responseText = await response.text();
		try {
			JSON.parse(responseText);
		} catch {
			logger.warn("Embeddings probe returned non-JSON success body", {
				provider,
				externalId: target.externalId,
				statusCode: response.status,
				bodyPreview: responseText.slice(0, 200),
			});
			return {
				valid: false,
				error:
					"Upstream returned a non-JSON response (an HTML page, not an API) — check that the base URL points at the provider's API host",
				statusCode: response.status,
			};
		}
		return { valid: true };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		logger.error("Embeddings probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
