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
	| "minimal-moderations";

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
 * whose output is image without text. Likewise text+audio chat models (the
 * native-audio / realtime deployments) stay on minimal-chat; minimal-speech
 * is only for text-to-speech models whose output is audio without text.
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
