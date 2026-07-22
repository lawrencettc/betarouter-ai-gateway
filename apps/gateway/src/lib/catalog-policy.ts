import { HTTPException } from "hono/http-exception";

import {
	evaluateCatalogRequest,
	getEffectiveCatalogSnapshot,
	readCatalogFeatureFlags,
} from "@llmgateway/catalog";
import { logger } from "@llmgateway/logger";

import type {
	CatalogRequestDecision,
	CatalogRequestInput,
} from "@llmgateway/catalog";
import type { ProviderModelMapping } from "@llmgateway/models";

interface EnforceCatalogRequestOptions {
	setHeader?: (name: string, value: string) => void;
}

export async function enforceCatalogRequest(
	input: CatalogRequestInput,
	options: EnforceCatalogRequestOptions = {},
): Promise<Extract<CatalogRequestDecision, { allowed: true }> | null> {
	if (input.modelId === "auto" || input.modelId === "custom") {
		return null;
	}
	const flags = readCatalogFeatureFlags();
	if (!flags.routingEnabled && !flags.shadowRead) {
		return null;
	}
	const snapshot = await getEffectiveCatalogSnapshot();
	const decision = evaluateCatalogRequest(snapshot, input);
	if (flags.shadowRead) {
		logger.info("Catalog routing decision", {
			mode: flags.routingEnabled ? "enforce" : "shadow",
			revision: snapshot.revision,
			modelId: input.modelId,
			providerId: input.providerId,
			region: input.region,
			allowed: decision.allowed,
			...(decision.allowed
				? { mappingIds: decision.mappingIds }
				: { code: decision.code, status: decision.status }),
		});
	}
	if (!flags.routingEnabled) {
		return null;
	}
	if (!decision.allowed) {
		const body = {
			error: {
				code: decision.code,
				message:
					decision.code === "model_retired"
						? "The requested model has been retired"
						: decision.code === "model_temporarily_unavailable"
							? "The requested model is temporarily unavailable"
							: "The requested model is not available",
				retryable: decision.retryable,
				replacementModelId: decision.replacementModelId,
				retireAt: decision.retireAt,
			},
		};
		throw new HTTPException(decision.status, {
			res: new Response(JSON.stringify(body), {
				status: decision.status,
				headers: {
					"content-type": "application/json",
					...(decision.retryable ? { "retry-after": "60" } : {}),
				},
			}),
		});
	}
	if (decision.deprecated) {
		options.setHeader?.("Deprecation", "true");
		if (decision.retireAt) {
			options.setHeader?.("Sunset", new Date(decision.retireAt).toUTCString());
		}
		if (decision.replacementModelId) {
			options.setHeader?.(
				"BetaRouter-Replacement-Model",
				decision.replacementModelId,
			);
		}
	}
	return decision;
}

export function filterProviderMappingsByCatalog(
	providers: ProviderModelMapping[],
	decision: Extract<CatalogRequestDecision, { allowed: true }> | null,
): ProviderModelMapping[] {
	if (!decision) {
		return providers;
	}
	return decision.mappings.flatMap((mapping) => {
		const provider = providers.find(
			(candidate) =>
				candidate.providerId === mapping.providerId &&
				(candidate.region === undefined ||
					(candidate.region ?? null) === mapping.region),
		);
		return provider
			? [
					{
						...provider,
						region: mapping.region ?? undefined,
						externalId: mapping.externalId,
					},
				]
			: [];
	});
}
