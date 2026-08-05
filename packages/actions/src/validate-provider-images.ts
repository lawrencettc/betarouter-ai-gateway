import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface ImagesValidationTarget {
	externalId: string;
	region?: string | null;
}

const PROBE_PROMPT = "A plain blue circle on a white background";

/**
 * The `minimal-images` mapping-test probe: send one minimal, non-sensitive
 * image generation request through the exact deployment the mapping routes
 * to (credential base URL + effective external id) and require a JSON
 * success body. Endpoint paths and payload shapes mirror the gateway's
 * per-provider image serving (`getProviderEndpoint` / `prepareRequestBody`
 * with `imageGenerations`), because a chat-shaped probe cannot validate an
 * image deployment. Unlike the embeddings probe, each run bills one real
 * (smallest/cheapest requestable) generation — the same trade the chat probe
 * makes with tokens, at cents instead of fractions of a cent.
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: a 2xx JSON body proves the credential, base URL, and external id
 * address a live image API; it does not inspect the returned image.
 */
export async function validateProviderImages(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: ImagesValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ?? getProviderDefaultBaseUrl(provider) ?? "https://api.openai.com";

	let endpoint: string;
	let payload: Record<string, unknown>;
	if (provider === "google-ai-studio" || provider === "google-vertex") {
		// Google image generation is served by text+image chat models
		// (minimal-chat territory) or Imagen's :predict shape, which this probe
		// does not implement. Image-only mappings on these providers stay
		// disabled until a probe shape exists.
		return {
			valid: false,
			error: `No image-generation probe shape exists for provider ${provider}; keep this mapping disabled`,
		};
	} else if (provider === "azure") {
		if (providerKeyOptions?.azure_deployment_type === "openai") {
			// Traditional deployment-based Azure: the external id is the
			// deployment name and gpt-image deployments need a preview
			// api-version.
			const apiVersion =
				providerKeyOptions.azure_api_version ?? "2025-04-01-preview";
			endpoint = `${resolvedBaseUrl}/openai/deployments/${target.externalId}/images/generations?api-version=${encodeURIComponent(apiVersion)}`;
			payload = { prompt: PROBE_PROMPT, n: 1, quality: "low" };
		} else {
			// Azure AI Foundry unified v1 endpoint requires the literal
			// "preview" api-version for image endpoints.
			endpoint = `${resolvedBaseUrl}/openai/v1/images/generations?api-version=preview`;
			payload = {
				model: target.externalId,
				prompt: PROBE_PROMPT,
				n: 1,
				quality: "low",
			};
		}
	} else if (provider === "openai") {
		// gpt-image models accept a quality knob; probe at the cheapest tier.
		endpoint = `${resolvedBaseUrl}/v1/images/generations`;
		payload = {
			model: target.externalId,
			prompt: PROBE_PROMPT,
			n: 1,
			quality: "low",
		};
	} else if (provider === "xai") {
		endpoint = `${resolvedBaseUrl}/v1/images/generations`;
		payload = { model: target.externalId, prompt: PROBE_PROMPT, n: 1 };
	} else if (provider === "zai") {
		endpoint = `${resolvedBaseUrl}/api/paas/v4/images/generations`;
		payload = { model: target.externalId, prompt: PROBE_PROMPT };
	} else if (provider === "bytedance") {
		// The ByteDance base URL already ends in /api/v3.
		endpoint = `${resolvedBaseUrl}/images/generations`;
		payload = { model: target.externalId, prompt: PROBE_PROMPT };
	} else if (provider === "alibaba") {
		endpoint = `${resolvedBaseUrl}/api/v1/services/aigc/multimodal-generation/generation`;
		payload = {
			model: target.externalId,
			input: {
				messages: [{ role: "user", content: [{ text: PROBE_PROMPT }] }],
			},
			parameters: { watermark: false, n: 1 },
		};
	} else if (provider === "reve") {
		// Reve addresses the model as `<name>@<version>` in the external id but
		// takes only the version in the request body.
		const versionSeparator = target.externalId.lastIndexOf("@");
		const version =
			versionSeparator > 0
				? target.externalId.slice(versionSeparator + 1)
				: "latest";
		endpoint = `${resolvedBaseUrl}/v1/image/create`;
		payload = { prompt: PROBE_PROMPT, version };
	} else {
		// Every other image deployment is expected to speak the OpenAI images
		// API, including admin-created relays on the openai-chat protocol.
		endpoint = `${resolvedBaseUrl}/v1/images/generations`;
		payload = { model: target.externalId, prompt: PROBE_PROMPT, n: 1 };
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
			logger.warn("Images probe returned error response", {
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
			logger.warn("Images probe returned non-JSON success body", {
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
		logger.error("Images probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
