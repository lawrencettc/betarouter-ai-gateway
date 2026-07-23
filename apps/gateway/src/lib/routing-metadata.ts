import type { RoutingMetadata } from "@betarouter/actions";

export function getNoFallbackRoutingMetadata(
	noFallback: boolean,
	xNoFallbackHeaderSet: boolean,
): Partial<RoutingMetadata> {
	return {
		...(noFallback ? { noFallback: true } : {}),
		...(xNoFallbackHeaderSet ? { xNoFallbackHeaderSet: true } : {}),
	};
}
