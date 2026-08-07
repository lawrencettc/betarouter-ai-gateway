import { deflateSync } from "node:zlib";

import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface OcrValidationTarget {
	externalId: string;
	region?: string | null;
}

// The gateway's OCR dispatch posts JSON to {baseUrl}/v1/ocr for every
// provider (Mistral's document shape), so any deployment routed through the
// surface must serve that path; the probe mirrors it.
const OCR_PROBE_BASE_URLS: Record<string, string> = {
	mistral: "https://api.mistral.ai",
};

const PROBE_IMAGE_WIDTH = 96;
const PROBE_IMAGE_HEIGHT = 32;

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = crc ^ byte;
		for (let bit = 0; bit < 8; bit++) {
			const lsb = crc & 1;
			crc = crc >>> 1;
			if (lsb) {
				crc = crc ^ 0xedb88320;
			}
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(12 + data.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) {
		chunk[4 + i] = type.charCodeAt(i);
	}
	chunk.set(data, 8);
	view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
	return chunk;
}

/**
 * A tiny grayscale PNG (border frame plus vertical bars on white) built in
 * code so the probe ships no binary asset. OCR of the pattern legitimately
 * yields little or no text — the probe validates reachability, not output.
 */
function buildProbePngDataUrl(): string {
	const ihdr = new Uint8Array(13);
	const ihdrView = new DataView(ihdr.buffer);
	ihdrView.setUint32(0, PROBE_IMAGE_WIDTH);
	ihdrView.setUint32(4, PROBE_IMAGE_HEIGHT);
	ihdr[8] = 8;

	// One filter byte (0 = none) before each row of grayscale pixels.
	const raw = new Uint8Array(PROBE_IMAGE_HEIGHT * (PROBE_IMAGE_WIDTH + 1));
	let pos = 0;
	for (let y = 0; y < PROBE_IMAGE_HEIGHT; y++) {
		raw[pos] = 0;
		pos++;
		for (let x = 0; x < PROBE_IMAGE_WIDTH; x++) {
			const inFrame =
				x < 4 ||
				x >= PROBE_IMAGE_WIDTH - 4 ||
				y < 4 ||
				y >= PROBE_IMAGE_HEIGHT - 4;
			const inBar = x % 16 < 6 && y >= 10 && y < 22;
			raw[pos] = inFrame || inBar ? 0 : 255;
			pos++;
		}
	}

	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
		pngChunk("IEND", new Uint8Array(0)),
	]);
	return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * The `minimal-ocr` mapping-test probe: run OCR over one synthesized
 * single-page PNG through the exact deployment the mapping routes to
 * (credential base URL + effective external id) and require a JSON success
 * body. The endpoint path and payload shape mirror the gateway's OCR
 * dispatch (`apps/gateway/src/ocr/ocr.ts`): JSON POST to `/v1/ocr` with the
 * model id and an inline `image_url` document. Page billing prices the run
 * at one page (Mistral: $0.004).
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: it verifies the credential, base URL, and external id address a live
 * OCR API, without inspecting the extracted markdown.
 */
export async function validateProviderOcr(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	providerKeyOptions: ProviderKeyOptions | undefined,
	target: OcrValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const resolvedBaseUrl =
		baseUrl ??
		OCR_PROBE_BASE_URLS[provider] ??
		getProviderDefaultBaseUrl(provider) ??
		"https://api.mistral.ai";
	const endpoint = `${resolvedBaseUrl}/v1/ocr`;

	const payload = {
		model: target.externalId,
		document: {
			type: "image_url",
			image_url: buildProbePngDataUrl(),
		},
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
			logger.warn("OCR probe returned error response", {
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
			logger.warn("OCR probe returned non-JSON success body", {
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
		logger.error("OCR probe failed with exception", {
			provider,
			externalId: target.externalId,
			error: errorMessage,
		});
		return { valid: false, error: errorMessage };
	}
}
