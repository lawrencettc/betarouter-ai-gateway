import { SamplingDecision } from "@opentelemetry/sdk-trace-base";

import type { Attributes, Context, SpanKind, Link } from "@opentelemetry/api";
import type { Sampler, SamplingResult } from "@opentelemetry/sdk-trace-base";

export class HeaderBasedForceSampler implements Sampler {
	private fallbackSampler: Sampler;

	public constructor(fallbackSampler: Sampler) {
		this.fallbackSampler = fallbackSampler;
	}

	public shouldSample(
		context: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		links: Link[],
	): SamplingResult {
		// Check if force-trace header is present in the attributes
		// The header should be set as an attribute by the middleware
		if (attributes && attributes["http.header.x-force-trace"]) {
			const forceTrace = attributes["http.header.x-force-trace"];
			if (forceTrace === "true" || forceTrace === "1") {
				return {
					decision: SamplingDecision.RECORD_AND_SAMPLED,
					attributes: {
						...attributes,
						"sampling.forced": true,
					},
				};
			}
		}

		// Fall back to the configured sampler
		return this.fallbackSampler.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);
	}

	public toString(): string {
		return `HeaderBasedForceSampler{fallback=${this.fallbackSampler.toString()}}`;
	}
}
