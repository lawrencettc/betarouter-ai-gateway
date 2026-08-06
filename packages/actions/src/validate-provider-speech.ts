import { logger } from "@betarouter/logger";
import { ELEVENLABS_VOICE_IDS } from "@betarouter/models";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface SpeechValidationTarget {
	externalId: string;
	region?: string | null;
	/** From the mapping when known; the probe synthesizes with the first one. */
	supportedVoices?: readonly string[];
}

// Character-billed TTS models charge per input character, so the probe text
// stays as short as a real utterance can be.
const PROBE_TEXT = "Hi.";

// Speech provider base URLs the gateway's speech dispatch uses; the actions
// endpoint helper does not know all of these because some are speech-only.
const SPEECH_PROBE_BASE_URLS: Record<string, string> = {
	"google-ai-studio": "https://generativelanguage.googleapis.com",
	"google-vertex": "https://aiplatform.googleapis.com",
	openai: "https://api.openai.com",
	elevenlabs: "https://api.elevenlabs.io",
	alibaba: "https://dashscope-intl.aliyuncs.com",
};

function probeVoice(
	provider: ProviderId | string,
	target: SpeechValidationTarget,
): string {
	const fromMapping = target.supportedVoices?.[0];
	if (fromMapping) {
		return fromMapping;
	}
	if (provider === "openai") {
		return "alloy";
	}
	if (provider === "alibaba") {
		return "Cherry";
	}
	return "Kore";
}

/**
 * The `minimal-speech` mapping-test probe: synthesize one minimal (three
 * character) utterance through the exact deployment the mapping routes to
 * (credential base URL + effective external id) and require a success
 * response whose body is plausibly audio. Endpoint paths and payload shapes
 * mirror the gateway's speech dispatch (`apps/gateway/src/speech/speech.ts`),
 * because a chat-shaped probe cannot validate a text-to-speech deployment.
 * Character-billed models make this the cheapest probe of any modality —
 * fractions of a cent per run.
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: it verifies the credential, base URL, and external id address a live
 * speech API, without inspecting the synthesized audio.
 */
export async function validateProviderSpeech(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: SpeechValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ??
		SPEECH_PROBE_BASE_URLS[provider] ??
		getProviderDefaultBaseUrl(provider) ??
		"https://api.openai.com";
	const voice = probeVoice(provider, target);

	// Google's generateContent and Alibaba's DashScope answer JSON; OpenAI,
	// ElevenLabs, and OpenAI-shaped relays return the encoded audio directly.
	let expectsJson = false;
	let endpoint: string;
	let payload: Record<string, unknown>;
	if (provider === "google-ai-studio" || provider === "google-vertex") {
		expectsJson = true;
		const speechPayload = {
			contents: [{ role: "user", parts: [{ text: PROBE_TEXT }] }],
			generationConfig: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
				},
			},
		};
		if (provider === "google-vertex") {
			// Mirrors the gateway's Vertex speech dispatch with an API-key
			// credential; OAuth resolution is a gateway runtime concern the probe
			// does not replicate.
			if (providerKeyOptions?.google_vertex_token_type === "oauth") {
				return {
					valid: false,
					error:
						"OAuth-based Google Vertex credentials are not supported by the speech probe; use an API-key credential",
				};
			}
			const projectId = providerKeyOptions?.google_vertex_project_id;
			if (!projectId) {
				return {
					valid: false,
					error:
						"Google Vertex speech probes require google_vertex_project_id on the credential options",
				};
			}
			const region = target.region ?? "global";
			const vertexBaseUrl = baseUrl ?? SPEECH_PROBE_BASE_URLS["google-vertex"];
			endpoint = `${vertexBaseUrl}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${target.externalId}:generateContent?key=${encodeURIComponent(token)}`;
		} else {
			endpoint = `${resolvedBaseUrl}/v1beta/models/${target.externalId}:generateContent?key=${encodeURIComponent(token)}`;
		}
		payload = speechPayload;
	} else if (provider === "elevenlabs") {
		// ElevenLabs addresses the voice in the URL path; resolve the friendly
		// name to the upstream id like the gateway does, accepting raw ids too.
		const voiceId = ELEVENLABS_VOICE_IDS[voice] ?? voice;
		endpoint = `${resolvedBaseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
		payload = { text: PROBE_TEXT, model_id: target.externalId };
	} else if (provider === "alibaba") {
		expectsJson = true;
		endpoint = `${resolvedBaseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`;
		payload = {
			model: target.externalId,
			input: {
				text: PROBE_TEXT,
				voice,
				format: "wav",
				sample_rate: 24000,
			},
		};
	} else {
		// Expect the OpenAI speech API shape from anything else, including
		// admin-created relays.
		endpoint = `${resolvedBaseUrl}/v1/audio/speech`;
		payload = {
			model: target.externalId,
			input: PROBE_TEXT,
			voice,
			response_format: "mp3",
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
			logger.warn("Speech probe returned error response", {
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
		if (expectsJson) {
			const responseText = await response.text();
			try {
				JSON.parse(responseText);
			} catch {
				logger.warn("Speech probe returned non-JSON success body", {
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
		}

		// Binary passthrough providers: the success body is the encoded audio,
		// so the frontend-catcher is the content type instead of JSON parsing.
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.startsWith("text/")) {
			logger.warn("Speech probe returned a text success body", {
				provider,
				externalId: target.externalId,
				statusCode: response.status,
				contentType,
			});
			return {
				valid: false,
				error:
					"Upstream returned a text response (an HTML page, not audio) — check that the base URL points at the provider's API host",
				statusCode: response.status,
			};
		}
		return { valid: true };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		logger.error("Speech probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
