import { providers } from "@betarouter/models";

import type { ProviderDefinition } from "@betarouter/models";

/**
 * Clamp the requested temperature to the ceiling the selected provider accepts.
 * The OpenAI schema allows temperature up to 2, but providers such as zai reject
 * anything above 1 with a 400, so lower the value instead of failing the request.
 *
 * `providerDefinition` carries the catalog-resolved definition when the caller
 * has one (read-path inversion), so an operator-overridden `maxTemperature`
 * and admin-created providers' ceilings apply; without it the static array
 * serves the lookup.
 */
export function clampTemperature(
	temperature: number | undefined,
	providerId: string,
	providerDefinition?: ProviderDefinition,
): number | undefined {
	if (temperature === undefined) {
		return undefined;
	}
	const maxTemperature = (
		providerDefinition ?? providers.find((p) => p.id === providerId)
	)?.maxTemperature;
	if (maxTemperature === undefined || temperature <= maxTemperature) {
		return temperature;
	}
	return maxTemperature;
}
