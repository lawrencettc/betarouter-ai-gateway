import { resolveGatewayModelDefinition } from "@/lib/model-resolution.js";
import { validateModelOutput } from "@/lib/validate-model-output.js";

import type { CatalogModelResolutionContext } from "@/lib/model-resolution.js";
import type { ModelDefinition } from "@betarouter/models";

/**
 * Resolve the model definition an images request addresses, through the
 * shared gateway resolver (static by default, catalog-first under BASE_READ,
 * dual-resolve divergence logging under SHADOW_READ) — the images surface's
 * slice of the read-path inversion. Splits an optional "<provider>/<model>"
 * prefix like the chat and embeddings surfaces so a pinned provider prefers
 * a definition carrying that provider. Returns null for unknown models.
 *
 * Catalog request ENFORCEMENT is intentionally absent here: this surface
 * re-dispatches through /v1/chat/completions (see forwardToChatCompletions
 * in images.ts), and that hop enforces the catalog decision under the chat
 * operation. There is no separate "images" operation or per-modality routing
 * flag — the per-mapping activation gate (minimal-images probe) is what
 * admits an image-only model to routing.
 */
export function findImageModelDefinition(
	modelId: string,
	context: CatalogModelResolutionContext,
): { modelDef: ModelDefinition; modelKey: string } | null {
	let requestedProvider: string | undefined;
	let modelKey = modelId;
	const slashIdx = modelId.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = modelId.slice(0, slashIdx);
		modelKey = modelId.slice(slashIdx + 1);
	}
	const modelDef = resolveGatewayModelDefinition(
		modelKey,
		context,
		requestedProvider,
	);
	return modelDef ? { modelDef, modelKey } : null;
}

// Reject non-image models up front. Image generation forwards to
// /v1/chat/completions (which accepts text and image models), so without this
// guard a text-only model would be forwarded and produce a chat completion the
// images endpoint can't turn into an image. Unknown models are left to the chat
// handler to reject as "model not found".
export function assertImageModel(
	model: string,
	context: CatalogModelResolutionContext,
): void {
	const slashIdx = model.indexOf("/");
	const modelKey = slashIdx > 0 ? model.slice(slashIdx + 1) : model;
	if (modelKey === "auto" || modelKey === "custom") {
		return;
	}
	const match = findImageModelDefinition(model, context);
	if (match) {
		validateModelOutput(match.modelDef, match.modelKey, ["image"]);
	}
}
