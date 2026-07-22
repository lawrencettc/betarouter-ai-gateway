import { beforeEach, describe, expect, it, vi } from "vitest";

import { aggregateCatalogHealth } from "./catalog-health.js";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	insertValues: vi.fn(),
	getBreakers: vi.fn(),
}));

vi.mock("@llmgateway/catalog", () => ({
	getCatalogBreakerStates: mocks.getBreakers,
}));

vi.mock("@llmgateway/db", () => ({
	db: {
		execute: mocks.execute,
		insert: () => ({ values: mocks.insertValues }),
	},
	log: {
		modelProviderMappingId: "mapping_id",
		catalogRevisionId: "catalog_revision_id",
		hasError: "has_error",
		internalErrorDetails: "internal_error_details",
		errorDetails: "error_details",
		duration: "duration",
		createdAt: "created_at",
	},
	platformMappingHealthSummary: {},
	sql: (strings: TemplateStringsArray) => strings.join("?"),
}));

vi.mock("@llmgateway/logger", () => ({
	logger: { warn: vi.fn() },
}));

describe("catalog health aggregation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.insertValues.mockResolvedValue(undefined);
	});

	it("persists traffic percentiles and current breaker state", async () => {
		mocks.execute.mockResolvedValue({
			rows: [
				{
					mapping_id: "mapping-1",
					catalog_revision: 12,
					request_count: "20",
					upstream_failure_count: "3",
					latency_p50_ms: "110",
					latency_p95_ms: "420",
					last_success_at: new Date("2026-07-22T12:00:00.000Z"),
				},
			],
		});
		mocks.getBreakers.mockResolvedValue({
			"mapping-1": {
				state: "open",
				openedAt: Date.parse("2026-07-22T11:59:00.000Z"),
				retryAt: Date.parse("2026-07-22T12:01:00.000Z"),
			},
		});

		await expect(aggregateCatalogHealth()).resolves.toBe(1);
		expect(mocks.getBreakers).toHaveBeenCalledWith({
			revision: 12,
			mappingIds: ["mapping-1"],
		});
		expect(mocks.insertValues).toHaveBeenCalledWith([
			expect.objectContaining({
				mappingId: "mapping-1",
				catalogRevision: 12,
				breakerState: "open",
				requestCount: 20,
				upstreamFailureCount: 3,
				latencyP50Ms: 110,
				latencyP95Ms: 420,
			}),
		]);
	});

	it("skips writes when there is no linked traffic", async () => {
		mocks.execute.mockResolvedValue({ rows: [] });

		await expect(aggregateCatalogHealth()).resolves.toBe(0);
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});
