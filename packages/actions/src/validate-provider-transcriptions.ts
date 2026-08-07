import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface TranscriptionsValidationTarget {
	externalId: string;
	region?: string | null;
}

// The gateway's transcription dispatch posts to {baseUrl}/v1/stt for every
// provider, so any deployment routed through the surface must serve that
// path; the probe mirrors it rather than per-provider endpoints.
const TRANSCRIPTION_PROBE_BASE_URLS: Record<string, string> = {
	xai: "https://api.x.ai",
};

// Duration-billed STT makes the probe cost proportional to the clip length,
// so it stays as short as an utterance can plausibly be. A synthesized tone
// rather than silence: some STT stacks reject clips they detect as empty.
const PROBE_SAMPLE_RATE = 8000;
const PROBE_DURATION_SECONDS = 0.5;
const PROBE_TONE_HZ = 440;

function buildProbeWav(): ArrayBuffer {
	const sampleCount = Math.floor(PROBE_SAMPLE_RATE * PROBE_DURATION_SECONDS);
	const dataSize = sampleCount * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	const writeAscii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) {
			view.setUint8(offset + i, text.charCodeAt(i));
		}
	};
	writeAscii(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(8, "WAVE");
	writeAscii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, PROBE_SAMPLE_RATE, true);
	view.setUint32(28, PROBE_SAMPLE_RATE * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(36, "data");
	view.setUint32(40, dataSize, true);
	for (let i = 0; i < sampleCount; i++) {
		const sample =
			Math.sin((2 * Math.PI * PROBE_TONE_HZ * i) / PROBE_SAMPLE_RATE) * 0.25;
		view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
	}
	return buffer;
}

/**
 * The `minimal-transcriptions` mapping-test probe: transcribe one synthesized
 * half-second WAV clip through the exact deployment the mapping routes to
 * (credential base URL + effective external id) and require a JSON success
 * body. The endpoint path and multipart shape mirror the gateway's
 * transcription dispatch (`apps/gateway/src/transcriptions/transcriptions.ts`)
 * — including NOT sending a `model` form field, which the gateway never
 * sends either, so a deployment that needs one cannot be served by the
 * surface and must fail the probe. Duration billing prices the run at
 * fractions of a cent (half a second of audio).
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: it verifies the credential, base URL, and external id address a live
 * speech-to-text API, without inspecting the transcript.
 */
export async function validateProviderTranscriptions(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: TranscriptionsValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ??
		TRANSCRIPTION_PROBE_BASE_URLS[provider] ??
		getProviderDefaultBaseUrl(provider) ??
		"https://api.x.ai";
	const endpoint = `${resolvedBaseUrl}/v1/stt`;

	const form = new FormData();
	form.append(
		"file",
		new Blob([buildProbeWav()], { type: "audio/wav" }),
		"probe.wav",
	);

	try {
		// No explicit Content-Type: fetch derives the multipart boundary from
		// the FormData body.
		const headers = getProviderHeaders(provider, token, {
			providerKeyOptions,
			skipEnvVars: true,
		});

		const response = await fetch(endpoint, {
			method: "POST",
			// SSRF: never follow redirects when probing a tenant-supplied baseUrl,
			// which could 3xx to an internal host (and would leak the token).
			redirect: "error",
			headers,
			body: form,
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
			logger.warn("Transcriptions probe returned error response", {
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
			logger.warn("Transcriptions probe returned non-JSON success body", {
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
		logger.error("Transcriptions probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
