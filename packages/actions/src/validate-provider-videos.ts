import { logger } from "@betarouter/logger";
import { getAvalancheJobsApiBaseUrl } from "@betarouter/shared";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface VideosValidationTarget {
	externalId: string;
	region?: string | null;
	/** From the model definition; the probe attaches a tiny input frame. */
	imageInputRequired?: boolean;
	/** Shortest allowed duration, from the mapping when known. */
	supportedVideoDurationsSeconds?: readonly number[];
}

const PROBE_PROMPT = "A plain blue circle on a white background, static shot";

// 1x1 transparent PNG for imageInputRequired models (e.g. image-to-video
// deployments that reject prompt-only requests).
const PROBE_FRAME_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Video provider base URLs the gateway's video dispatch uses; the actions
// endpoint helper does not know all of these because most are video-only.
const VIDEO_PROBE_BASE_URLS: Record<string, string> = {
	openai: "https://api.openai.com",
	xai: "https://api.x.ai",
	atlascloud: "https://api.atlascloud.ai",
	bytedance: "https://ark.ap-southeast.bytepluses.com/api/v3",
	minimax: "https://api.minimax.io",
	alibaba: "https://dashscope-intl.aliyuncs.com",
};

function probeDurationSeconds(target: VideosValidationTarget): number {
	const durations = target.supportedVideoDurationsSeconds;
	if (durations && durations.length > 0) {
		return Math.min(...durations);
	}
	return 4;
}

/**
 * The `minimal-videos` mapping-test probe: submit one minimal, cheapest
 * text-to-video generation to the exact deployment the mapping routes to
 * (credential base URL + effective external id) and require the job to be
 * ACCEPTED — a 2xx JSON acknowledgement. The probe never polls or downloads
 * the result: acceptance already proves the credential, base URL, and
 * external id address a live video API that recognizes the model. The
 * accepted generation still runs upstream and is billed by the provider —
 * dollars-order cost per probe run rather than the images probe's cents,
 * one-time per mapping + credential fingerprint, and the output is
 * discarded. Endpoint paths and payload shapes mirror the gateway's video
 * dispatch (`apps/gateway/src/videos/videos.ts` create functions), minus
 * every optional input mode a probe does not need.
 */
export async function validateProviderVideos(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: VideosValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ??
		VIDEO_PROBE_BASE_URLS[provider] ??
		getProviderDefaultBaseUrl(provider) ??
		"https://api.openai.com";
	const durationSeconds = probeDurationSeconds(target);

	let endpoint: string;
	let payload: Record<string, unknown>;
	const extraHeaders: Record<string, string> = {};
	if (provider === "google-vertex") {
		// Mirrors the gateway's veo dispatch: predictLongRunning with an
		// API-key credential; acceptance is the returned operation name. No
		// storageUri — the probe never fetches the result.
		if (providerKeyOptions?.google_vertex_token_type === "oauth") {
			return {
				valid: false,
				error:
					"OAuth-based Google Vertex credentials are not supported by the videos probe; use an API-key credential",
			};
		}
		const projectId = providerKeyOptions?.google_vertex_project_id;
		if (!projectId) {
			return {
				valid: false,
				error:
					"Google Vertex video probes require google_vertex_project_id on the credential options",
			};
		}
		const region = target.region ?? "global";
		const vertexBaseUrl = baseUrl ?? "https://aiplatform.googleapis.com";
		endpoint = `${vertexBaseUrl}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${target.externalId}:predictLongRunning?key=${encodeURIComponent(token)}`;
		payload = {
			instances: [{ prompt: PROBE_PROMPT }],
			parameters: {
				aspectRatio: "16:9",
				durationSeconds,
				generateAudio: false,
				resolution: "720p",
				sampleCount: 1,
			},
		};
	} else if (provider === "avalanche") {
		// Avalanche serves video through a separate jobs API on the same host.
		endpoint = `${getAvalancheJobsApiBaseUrl(resolvedBaseUrl)}/createTask`;
		payload = {
			model: target.externalId,
			prompt: PROBE_PROMPT,
			aspect_ratio: "16:9",
			n_frames: String(durationSeconds),
		};
	} else if (provider === "xai") {
		endpoint = `${resolvedBaseUrl}/v1/videos/generations`;
		payload = {
			model: target.externalId,
			prompt: PROBE_PROMPT,
			duration: durationSeconds,
			...(target.imageInputRequired
				? { image: { url: PROBE_FRAME_DATA_URL } }
				: {}),
		};
	} else if (provider === "minimax") {
		endpoint = `${resolvedBaseUrl}/v1/video_generation`;
		payload = {
			model: target.externalId,
			prompt: PROBE_PROMPT,
			duration: durationSeconds,
		};
	} else if (provider === "bytedance") {
		// The ByteDance base URL already ends in /api/v3.
		endpoint = `${resolvedBaseUrl}/contents/generations/tasks`;
		payload = {
			model: target.externalId,
			content: [{ type: "text", text: PROBE_PROMPT }],
		};
	} else if (provider === "alibaba") {
		endpoint = `${resolvedBaseUrl}/api/v1/services/aigc/video-generation/video-synthesis`;
		payload = {
			model: target.externalId,
			input: { prompt: PROBE_PROMPT },
			parameters: { duration: durationSeconds },
		};
		extraHeaders["X-DashScope-Async"] = "enable";
	} else if (provider === "atlascloud") {
		endpoint = `${resolvedBaseUrl}/api/v1/model/generateVideo`;
		payload = {
			model: target.externalId,
			prompt: PROBE_PROMPT,
			duration: durationSeconds,
		};
	} else {
		// Expect the OpenAI videos API shape from anything else, including
		// admin-created relays.
		endpoint = `${resolvedBaseUrl}/v1/videos`;
		payload = {
			model: target.externalId,
			prompt: PROBE_PROMPT,
			seconds: String(durationSeconds),
		};
	}

	try {
		const headers = getProviderHeaders(provider, token, {
			providerKeyOptions,
			skipEnvVars: true,
		});
		headers["Content-Type"] = "application/json";
		Object.assign(headers, extraHeaders);

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
			logger.warn("Videos probe returned error response", {
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
		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText);
		} catch {
			logger.warn("Videos probe returned non-JSON success body", {
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

		// MiniMax wraps failures in a 200 with a non-zero base_resp status.
		if (provider === "minimax") {
			const baseResp = (parsed as Record<string, unknown>)?.base_resp as
				{ status_code?: number; status_msg?: string } | undefined;
			if (baseResp && baseResp.status_code !== 0) {
				return {
					valid: false,
					error: `MiniMax video API error: ${baseResp.status_msg ?? "unknown error"} (code ${baseResp.status_code})`,
					statusCode: response.status,
				};
			}
		}
		return { valid: true };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		logger.error("Videos probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
