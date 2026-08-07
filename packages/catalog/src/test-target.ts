import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonical);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonical(item)]),
		);
	}
	return value;
}

export type CatalogMappingTestProfileName =
	| "minimal-chat"
	| "minimal-embeddings"
	| "minimal-images"
	| "minimal-videos"
	| "minimal-speech"
	| "minimal-transcriptions"
	| "minimal-ocr"
	| "minimal-rerank"
	| "minimal-moderations"
	| "minimal-realtime";

/**
 * Which probe profile a model's output modalities call for, shared by the
 * test-run route (which probe to send) and the resolver's expected-profile
 * computation (which passed run satisfies the test gate) — the two MUST agree
 * or passed tests can never unlock routing. Null means no probe profile
 * exists for the modality yet: the launch boundary keeps such mappings
 * disabled and the test console refuses to run them.
 *
 * The checks are ordered: a model already routable under an earlier profile
 * must KEEP that profile, because changing an activated mapping's expected
 * profile invalidates its passed test runs and instantly de-routes it. In
 * particular, text+image chat models (e.g. the Gemini image previews) serve
 * chat traffic and stay on minimal-chat; minimal-images is only for models
 * whose output is image without text. Likewise a text+audio chat model
 * served over HTTP chat completions would stay on minimal-chat;
 * minimal-speech is only for text-to-speech models whose output is audio
 * without text. Realtime deployments also declare text+audio output but are
 * never HTTP-servable, so they are diverted to minimal-realtime by
 * `catalogMappingProfileForMapping` BEFORE this output-based fallback — use
 * that function wherever the mapping's modality flags are available.
 */
export function catalogMappingProfileForOutputs(
	output: readonly string[],
): CatalogMappingTestProfileName | null {
	if (output.includes("text")) {
		return "minimal-chat";
	}
	if (output.includes("embedding")) {
		return "minimal-embeddings";
	}
	if (output.includes("image")) {
		return "minimal-images";
	}
	if (output.includes("video")) {
		return "minimal-videos";
	}
	if (output.includes("audio")) {
		return "minimal-speech";
	}
	if (output.includes("transcription")) {
		return "minimal-transcriptions";
	}
	if (output.includes("ocr")) {
		return "minimal-ocr";
	}
	if (output.includes("rerank")) {
		return "minimal-rerank";
	}
	if (output.includes("moderation")) {
		return "minimal-moderations";
	}
	return null;
}

export interface CatalogMappingModalityFlags {
	realtime?: boolean | null;
	realtimeTranscription?: boolean | null;
}

/**
 * Whether a mapping is exempt from the mapping-test gate entirely.
 *
 * Recorded reason (plan-admin-catalog-authority Phase 7 allows exempting a
 * modality "with a recorded reason"): realtime-transcription mappings have no
 * standalone deployment to probe and no credential of their own to bind. The
 * ASR model runs INSIDE a host realtime session — the gateway configures it
 * via `session.update` on the session's existing WebSocket, authenticated by
 * the host realtime mapping's credential (see
 * `apps/gateway/src/realtime/preflight.ts`, which resolves one upstream
 * credential per session from the realtime match, never from the ASR match).
 * A probe would have to open a session on some OTHER mapping's deployment,
 * coupling this mapping's activation to a deployment it does not route to.
 * Exempt mappings still require prices and an operator enable to become
 * routable; only the passed-test requirement is waived.
 */
export function isCatalogMappingTestExempt(
	mapping: CatalogMappingModalityFlags,
): boolean {
	return mapping.realtimeTranscription === true && mapping.realtime !== true;
}

/**
 * Mapping-aware probe-profile derivation. Realtime mappings are keyed on
 * their modality FLAG, not their output modalities: they declare
 * `["text", "audio"]` output (truthful for /v1/models and the UI), but the
 * deployment only answers the realtime WebSocket protocol, so the
 * output-derived minimal-chat probe could never pass and the mapping could
 * never activate. Test-exempt mappings return null — the console refuses to
 * run them and the resolver waives the test gate instead.
 */
export function catalogMappingProfileForMapping(
	output: readonly string[],
	mapping: CatalogMappingModalityFlags,
): CatalogMappingTestProfileName | null {
	if (mapping.realtime === true) {
		return "minimal-realtime";
	}
	if (isCatalogMappingTestExempt(mapping)) {
		return null;
	}
	return catalogMappingProfileForOutputs(output);
}

export interface CatalogMappingTestTarget {
	mappingId: string;
	providerId: string;
	region?: string | null;
	externalId: string;
	contextSizeLimit?: number | null;
	maxOutputLimit?: number | null;
	disabledCapabilities?: string[];
	credentialId: string;
	credentialFingerprint: string;
	baseUrl?: string | null;
	credentialOptions?: unknown;
	profile?: string;
}

export interface CatalogCredentialConfigurationTarget {
	credentialId: string;
	credentialFingerprint: string;
	baseUrl?: string | null;
	credentialOptions?: unknown;
}

export function catalogCredentialConfigurationProfile(
	input: CatalogCredentialConfigurationTarget,
): string {
	return `sha256:${createHash("sha256")
		.update(
			JSON.stringify(
				canonical({
					version: 1,
					credentialId: input.credentialId,
					credentialFingerprint: input.credentialFingerprint,
					baseUrl: input.baseUrl ?? null,
					credentialOptions: input.credentialOptions ?? null,
				}),
			),
		)
		.digest("hex")}`;
}

export function catalogMappingTestProfile(
	input: CatalogMappingTestTarget,
): string {
	const profile = input.profile ?? "minimal-chat";
	const payload = canonical({
		version: 1,
		mappingId: input.mappingId,
		providerId: input.providerId,
		region: input.region ?? null,
		externalId: input.externalId,
		contextSizeLimit: input.contextSizeLimit ?? null,
		maxOutputLimit: input.maxOutputLimit ?? null,
		disabledCapabilities: [...(input.disabledCapabilities ?? [])].sort(),
		credentialId: input.credentialId,
		credentialFingerprint: input.credentialFingerprint,
		baseUrl: input.baseUrl ?? null,
		credentialOptions: input.credentialOptions ?? null,
		profile,
	});
	return `${profile}@sha256:${createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex")}`;
}
