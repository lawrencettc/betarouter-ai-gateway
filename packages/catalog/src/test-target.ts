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

export function catalogMappingTestProfile(
	input: CatalogMappingTestTarget,
): string {
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
		profile: input.profile ?? "minimal",
	});
	return `minimal@sha256:${createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex")}`;
}
