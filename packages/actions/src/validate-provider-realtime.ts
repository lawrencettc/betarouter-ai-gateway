import { WebSocket } from "ws";

import { logger } from "@betarouter/logger";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";

import type { ProviderKeyOptions } from "@betarouter/db";
import type { ProviderId, ProviderValidationResult } from "@betarouter/models";

export interface RealtimeValidationTarget {
	externalId: string;
	region?: string | null;
}

const GEMINI_LIVE_PATH =
	"/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const PROBE_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

interface ProbeShape {
	url: string;
	headers: Record<string, string>;
	/**
	 * Message to send once the socket opens (Gemini's setup handshake); the
	 * OpenAI protocol needs nothing — the model travels in the URL.
	 */
	openingMessage?: string;
	/** Returns a verdict once a server message settles the probe, else null. */
	classify: (message: unknown) => { valid: boolean; error?: string } | null;
}

/**
 * Endpoint, credential header, and handshake shape per provider protocol,
 * mirroring the gateway's realtime dispatch
 * (`apps/gateway/src/realtime/connect-upstream.ts` and the session setup in
 * `gemini-session.ts`): credentials travel in headers, never the query
 * string, and the success signal is the same first server event the gateway
 * itself waits for (`session.created` / `setupComplete`).
 */
function resolveProbeShape(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	target: RealtimeValidationTarget,
): ProbeShape {
	if (provider === "google-ai-studio") {
		const resolvedBaseUrl =
			baseUrl ??
			getProviderDefaultBaseUrl(provider) ??
			"https://generativelanguage.googleapis.com";
		return {
			url: `${resolvedBaseUrl.replace(/^http/, "ws")}${GEMINI_LIVE_PATH}`,
			headers: { "x-goog-api-key": token },
			// Speech-to-speech sessions on the gateway always request AUDIO
			// output, so the probe setup does too.
			openingMessage: JSON.stringify({
				setup: {
					model: `models/${target.externalId}`,
					generationConfig: { responseModalities: ["AUDIO"] },
				},
			}),
			classify: (message) => {
				if (typeof message !== "object" || message === null) {
					return null;
				}
				if ("setupComplete" in message) {
					return { valid: true };
				}
				if ("error" in message) {
					const error = (message as { error?: { message?: string } }).error;
					return {
						valid: false,
						error: error?.message ?? "Upstream rejected the setup message",
					};
				}
				return null;
			},
		};
	}
	const resolvedBaseUrl =
		baseUrl ?? getProviderDefaultBaseUrl(provider) ?? "https://api.openai.com";
	return {
		url: `${resolvedBaseUrl.replace(/^http/, "ws")}/v1/realtime?model=${encodeURIComponent(target.externalId)}`,
		headers: { Authorization: `Bearer ${token}` },
		classify: (message) => {
			if (typeof message !== "object" || message === null) {
				return null;
			}
			const event = message as { type?: string; error?: { message?: string } };
			if (event.type === "session.created") {
				return { valid: true };
			}
			if (event.type === "error") {
				return {
					valid: false,
					error: event.error?.message ?? "Upstream rejected the session",
				};
			}
			return null;
		},
	};
}

/**
 * The `minimal-realtime` mapping-test probe: open the provider's realtime
 * WebSocket for the exact deployment the mapping routes to (credential base
 * URL + effective external id) and wait for the protocol's session-ready
 * event — `session.created` on the OpenAI protocol, `setupComplete` after a
 * setup message on Gemini Live. The socket is closed immediately after the
 * verdict, before any audio or text turn, so the probe generates no tokens
 * and costs nothing.
 *
 * This is a reachability and deployment-shape gate, not an output-quality
 * gate: it verifies the credential, base URL, and external id address a live
 * realtime deployment. Realtime-transcription (ASR) mappings are NOT probed
 * by this or any profile — see `isCatalogMappingTestExempt` in
 * `@betarouter/catalog` for the recorded exemption.
 */
export async function validateProviderRealtime(
	provider: ProviderId | string,
	token: string,
	baseUrl: string | undefined,
	skipValidation: boolean,
	// The realtime dispatch authenticates with bare headers (see
	// `resolveProbeShape`); provider-key options never shape the connection.
	_providerKeyOptions: ProviderKeyOptions | undefined,
	target: RealtimeValidationTarget,
): Promise<ProviderValidationResult> {
	if (skipValidation) {
		return { valid: true };
	}

	const shape = resolveProbeShape(provider, token, baseUrl, target);

	return await new Promise<ProviderValidationResult>((resolve) => {
		// SSRF: `ws` does not follow redirects unless `followRedirects` is set,
		// so a probed base URL cannot 3xx the token to another host.
		const socket = new WebSocket(shape.url, {
			headers: shape.headers,
			handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
		});
		let settled = false;

		const settle = (result: ProviderValidationResult) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(deadline);
			socket.removeAllListeners();
			socket.on("error", () => {});
			if (
				socket.readyState === WebSocket.OPEN ||
				socket.readyState === WebSocket.CONNECTING
			) {
				socket.terminate();
			}
			if (!result.valid) {
				logger.warn("Realtime probe failed", {
					provider,
					externalId: target.externalId,
					error: result.error,
					statusCode: result.statusCode,
				});
			}
			resolve(result);
		};

		const deadline = setTimeout(() => {
			settle({
				valid: false,
				error: `Upstream did not confirm the realtime session within ${PROBE_TIMEOUT_MS / 1000}s`,
			});
		}, PROBE_TIMEOUT_MS);

		socket.on("open", () => {
			if (shape.openingMessage) {
				socket.send(shape.openingMessage);
			}
		});
		socket.on("message", (data) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(data.toString());
			} catch {
				return;
			}
			const verdict = shape.classify(parsed);
			if (verdict) {
				settle(
					verdict.valid
						? { valid: true }
						: { valid: false, error: verdict.error },
				);
			}
		});
		socket.on("unexpected-response", (_request, response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () => {
				const body = Buffer.concat(chunks).toString();
				let errorMessage = `Upstream rejected the realtime connection (status ${response.statusCode ?? "unknown"})`;
				try {
					const errorJson = JSON.parse(body);
					if (errorJson.error?.message) {
						errorMessage = errorJson.error.message;
					} else if (errorJson.message) {
						errorMessage = errorJson.message;
					}
				} catch {}
				settle({
					valid: false,
					error: errorMessage,
					statusCode: response.statusCode,
				});
			});
			response.on("error", () => {
				settle({
					valid: false,
					error: `Upstream rejected the realtime connection (status ${response.statusCode ?? "unknown"})`,
					statusCode: response.statusCode,
				});
			});
		});
		socket.on("close", (code, reason) => {
			settle({
				valid: false,
				error:
					reason.toString() ||
					`Upstream closed the realtime connection before confirming the session (code ${code})`,
			});
		});
		socket.on("error", (error) => {
			settle({ valid: false, error: error.message });
		});
	});
}
