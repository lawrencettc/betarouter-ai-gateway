import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface ModerationsValidationTarget {
	externalId: string;
	region?: string | null;
}

// One short benign sentence: OpenAI's moderation endpoint is free, so the
// probe corpus only needs to be small enough to classify instantly.
const PROBE_INPUT = "Hello there.";

/**
 * The `minimal-moderations` mapping-test probe: classify one benign sentence
 * through the exact deployment the mapping routes to (credential base URL +
 * effective external id) and require a JSON success body. Endpoint path and
 * payload shape mirror the gateway's moderations dispatch
 * (`apps/gateway/src/moderations/moderations.ts`): an OpenAI-compatible JSON
 * POST to `/v1/moderations` with `input` and `model`.
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: it verifies the credential, base URL, and external id address a live
 * moderation API, without inspecting the returned category flags.
 */
export async function validateProviderModerations(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: ModerationsValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ?? getProviderDefaultBaseUrl(provider) ?? "https://api.openai.com";
	const endpoint = `${resolvedBaseUrl}/v1/moderations`;
	const payload = {
		input: PROBE_INPUT,
		model: target.externalId,
	};

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
			logger.warn("Moderations probe returned error response", {
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
			logger.warn("Moderations probe returned non-JSON success body", {
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
		logger.error("Moderations probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
