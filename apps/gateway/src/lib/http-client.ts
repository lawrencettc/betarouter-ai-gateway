import { createHttpClient } from "@betarouter/shared";

export const httpClient = createHttpClient({
	tracerName: "llmgateway-gateway",
	clientName: "gateway-http-client",
});

export type { HttpClientOptions } from "@betarouter/shared";
