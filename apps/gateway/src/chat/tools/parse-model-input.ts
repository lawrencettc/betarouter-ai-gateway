import { HTTPException } from "hono/http-exception";

import {
	type Model,
	models,
	type Provider,
	providers,
} from "@betarouter/models";

/**
 * Model/provider existence data derived from the catalog snapshot. When
 * provided (base reads enabled), parsing accepts models the snapshot knows
 * even when the static array does not — the catalog may be ahead of this
 * deploy or carry admin-created entries. Static knowledge always remains
 * valid: the union keeps parsing safe when the stored revision is older
 * than the running code.
 */
export interface CatalogParseContext {
	modelIds: ReadonlySet<string>;
	providerIdsByModel: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ParseModelInputResult {
	requestedModel: Model;
	requestedProvider: Provider | undefined;
	/**
	 * Platform provider defined outside the static catalogue (matched against
	 * the caller-supplied `platformProviderIds`). Mutually exclusive with
	 * `customProviderName` and `requestedProvider`; the model name is passed
	 * through unvalidated since the model catalogue for such providers lives in
	 * the database.
	 */
	platformProviderId: string | undefined;
	customProviderName: string | undefined;
	requestedRegion: string | undefined;
}

/**
 * Parses a model input string to resolve the model, provider, and custom provider name.
 *
 * Handles various input formats:
 * - "auto" or "custom" -> llmgateway provider
 * - "provider/model" -> specific provider and model
 * - "provider/model:region" -> specific provider, model, and region
 * - "platformProvider/model" -> database-defined platform provider (only when
 *   its id is passed via `platformProviderIds`)
 * - "customProvider/model" -> custom provider with any model name
 * - "model-id" -> model ID lookup
 *
 * @param platformProviderIds - Provider ids that exist outside the static
 *   catalogue (database-defined platform providers). Prefixes matching one of
 *   these are resolved as platform providers instead of tenant custom
 *   providers. Static catalogue providers always win over this list.
 * @param catalog - Catalog-derived existence data (read-path inversion).
 *   Extends, never narrows, what the static array accepts.
 *
 * @throws HTTPException if the model or provider is not supported
 */
export function parseModelInput(
	modelInput: string,
	platformProviderIds?: readonly string[],
	catalog?: CatalogParseContext,
): ParseModelInputResult {
	let requestedModel: Model = modelInput as Model;
	let requestedProvider: Provider | undefined;
	let platformProviderId: string | undefined;
	let customProviderName: string | undefined;
	let requestedRegion: string | undefined;

	// check if there is an exact model match
	if (modelInput === "auto" || modelInput === "custom") {
		requestedProvider = "llmgateway";
		requestedModel = modelInput as Model;
	} else if (modelInput.includes("/")) {
		const split = modelInput.split("/");
		const providerCandidate = split[0];

		// Check if the provider exists
		const knownProvider = providers.find((p) => p.id === providerCandidate);
		if (knownProvider) {
			requestedProvider = providerCandidate as Provider;
		} else if (platformProviderIds?.includes(providerCandidate)) {
			// Platform provider defined only in the database — first-class, not a
			// tenant custom provider.
			platformProviderId = providerCandidate;
		} else {
			// This might be a custom provider name - we'll validate against the database later
			// For now, assume it's a potential custom provider
			customProviderName = providerCandidate;
			requestedProvider = "custom";
		}
		// Handle model names with multiple slashes (e.g. together.ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo)
		let modelName = split.slice(1).join("/");

		// Parse optional region suffix (e.g. "qwen-plus:cn-beijing")
		if (modelName.includes(":")) {
			const colonIdx = modelName.lastIndexOf(":");
			requestedRegion = modelName.slice(colonIdx + 1);
			modelName = modelName.slice(0, colonIdx);
		}

		// For custom and database-defined platform providers, we don't need to
		// validate the model name against the static catalogue: custom providers
		// accept any OpenAI-compatible model name, and platform provider models
		// are defined in the database.
		if (requestedProvider === "custom" || platformProviderId) {
			requestedModel = modelName as Model;
		} else {
			// First try to find by base model name with matching provider
			let modelDef = models.find(
				(m) =>
					m.id === modelName &&
					m.providers.some((p) => p.providerId === requestedProvider),
			);

			// Fall back to matching by catalog id only
			modelDef ??= models.find((m) => m.id === modelName);

			const catalogHasPair = (modelId: string) =>
				catalog?.providerIdsByModel
					.get(modelId)
					?.has(requestedProvider as string) === true;

			if (!modelDef) {
				if (!catalogHasPair(modelName)) {
					throw new HTTPException(400, {
						message: `Requested model ${modelName} not supported`,
					});
				}
				// Known to the catalog snapshot only; the model name is already
				// the canonical catalog id there.
				requestedModel = modelName as Model;
			} else if (
				!modelDef.providers.some((p) => p.providerId === requestedProvider) &&
				!catalogHasPair(modelDef.id)
			) {
				throw new HTTPException(400, {
					message: `Provider ${requestedProvider} does not support model ${modelName}`,
				});
			} else {
				// Use the canonical catalog id, never the upstream externalId: two
				// catalog entries (e.g. a free and a paid sibling) can share the same
				// externalId, so collapsing to externalId here would let downstream
				// resolution pick the wrong entry. The upstream externalId is derived
				// separately from the selected provider mapping at request time.
				requestedModel = modelDef.id as Model;
			}
		}
	} else if (
		models.find((m) => m.id === modelInput) ||
		catalog?.modelIds.has(modelInput)
	) {
		requestedModel = modelInput as Model;
	} else {
		throw new HTTPException(400, {
			message: `Requested model ${modelInput} not supported`,
		});
	}

	if (
		requestedProvider &&
		requestedProvider !== "custom" &&
		!providers.find((p) => p.id === requestedProvider)
	) {
		throw new HTTPException(400, {
			message: `Requested provider ${requestedProvider} not supported`,
		});
	}

	return {
		requestedModel,
		requestedProvider,
		platformProviderId,
		customProviderName,
		requestedRegion,
	};
}
