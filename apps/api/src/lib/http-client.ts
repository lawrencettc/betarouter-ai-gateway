import { createHttpClient } from "@betarouter/shared";

export const httpClient = createHttpClient({
	tracerName: "llmgateway-api",
	clientName: "api-http-client",
});

export type { HttpClientOptions } from "@betarouter/shared";
