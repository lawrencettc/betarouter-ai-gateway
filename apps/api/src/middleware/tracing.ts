import { createTracingMiddleware } from "@betarouter/instrumentation";

export const tracingMiddleware = createTracingMiddleware({
	serviceName: "llmgateway-api",
});
