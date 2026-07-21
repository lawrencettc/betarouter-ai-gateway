import { SamplingDecision } from "@opentelemetry/sdk-trace-base";

import type { Attributes, Context, SpanKind, Link } from "@opentelemetry/api";
import type { Sampler, SamplingResult } from "@opentelemetry/sdk-trace-base";

// Error detection patterns (hoisted to avoid per-call allocation)
const ERROR_NAME_PATTERNS = [
	/error/i,
	/exception/i,
	/fail/i,
	/timeout/i,
	/abort/i,
];

export class ErrorAwareSampler implements Sampler {
	private normalSampler: Sampler;
	private errorSampler: Sampler;

	public constructor(normalSampler: Sampler, errorSampler: Sampler) {
		this.normalSampler = normalSampler;
		this.errorSampler = errorSampler;
	}

	public shouldSample(
		context: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		links: Link[],
	): SamplingResult {
		// Check if this span is likely to be an error span based on attributes
		// This is a heuristic approach since we can't know the final status at sampling time
		const isLikelyError = this.isLikelyErrorSpan(attributes, spanName);

		const sampler = isLikelyError ? this.errorSampler : this.normalSampler;
		const result = sampler.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);

		// Add metadata to indicate which sampling strategy was used
		if (result.decision === SamplingDecision.RECORD_AND_SAMPLED) {
			return {
				...result,
				attributes: {
					...result.attributes,
					"sampling.strategy": isLikelyError ? "error" : "normal",
				},
			};
		}

		return result;
	}

	private isLikelyErrorSpan(attributes: Attributes, spanName: string): boolean {
		// Check for HTTP error status codes
		const httpStatus = attributes["http.status_code"];
		if (httpStatus && typeof httpStatus === "number" && httpStatus >= 400) {
			return true;
		}

		// Check for likely error indicator set by middleware
		if (attributes["sampling.likely_error"]) {
			return true;
		}

		// Check for error-related span names
		return ERROR_NAME_PATTERNS.some((pattern) => pattern.test(spanName));
	}

	public toString(): string {
		return `ErrorAwareSampler{normal=${this.normalSampler.toString()}, error=${this.errorSampler.toString()}}`;
	}
}
