import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface RerankValidationTarget {
	externalId: string;
	region?: string | null;
}

// Token-billed rerank models charge on input tokens, so the probe corpus
// stays as small as a real rerank call can be: one query, two documents.
const PROBE_QUERY = "greeting";
const PROBE_DOCUMENTS = ["Hello there.", "Quarterly revenue report."];

/**
 * The `minimal-rerank` mapping-test probe: rerank two tiny documents against
 * a one-word query through the exact deployment the mapping routes to
 * (credential base URL + effective external id) and require a JSON success
 * body. Endpoint paths and payload shapes mirror the gateway's rerank
 * dispatch (`apps/gateway/src/rerank/rerank.ts`): DeepInfra uses its
 * inference endpoint with a `queries` array, everything else is assumed
 * Cohere-compatible at `/v1/rerank`. Token billing prices the run at a few
 * dozen input tokens — the cheapest probe of any modality.
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: it verifies the credential, base URL, and external id address a live
 * rerank API, without inspecting the relevance scores.
 */
export async function validateProviderRerank(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: RerankValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ?? getProviderDefaultBaseUrl(provider) ?? "https://api.openai.com";

	let endpoint: string;
	let payload: Record<string, unknown>;
	if (provider === "deepinfra") {
		// DeepInfra rerank uses the inference endpoint, a sibling of the
		// OpenAI-compatible surface its base URL points at — strip the
		// /v1/openai suffix exactly like the gateway does so the path doesn't
		// double up and 404.
		const inferenceBaseUrl = resolvedBaseUrl.replace(/\/v1\/openai\/?$/, "");
		endpoint = `${inferenceBaseUrl}/v1/inference/${target.externalId}`;
		payload = {
			queries: [PROBE_QUERY],
			documents: PROBE_DOCUMENTS,
		};
	} else {
		endpoint = `${resolvedBaseUrl}/v1/rerank`;
		payload = {
			model: target.externalId,
			query: PROBE_QUERY,
			documents: PROBE_DOCUMENTS,
		};
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
			logger.warn("Rerank probe returned error response", {
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
			logger.warn("Rerank probe returned non-JSON success body", {
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
		logger.error("Rerank probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
