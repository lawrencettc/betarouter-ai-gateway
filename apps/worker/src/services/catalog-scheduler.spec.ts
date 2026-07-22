import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCatalogSchedulerPass } from "./catalog-scheduler.js";

const mocks = vi.hoisted(() => ({
	applyDue: vi.fn(),
	auditValues: vi.fn(),
}));

vi.mock("@llmgateway/catalog", () => ({
	applyDueCatalogChangeSets: mocks.applyDue,
}));

vi.mock("@llmgateway/db", () => ({
	db: { insert: () => ({ values: mocks.auditValues }) },
	platformAuditLog: {},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: { error: vi.fn() },
}));

describe("catalog scheduler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.auditValues.mockResolvedValue(undefined);
	});

	it("applies every due change set and audits the resulting revision", async () => {
		const now = new Date("2026-07-22T12:00:00.000Z");
		mocks.applyDue.mockResolvedValue([
			{
				changeSetId: "change-1",
				catalogRevision: 8,
				affectedEntities: ["model-1"],
				cacheInvalidation: "published",
			},
		]);

		await runCatalogSchedulerPass(now);

		expect(mocks.applyDue).toHaveBeenCalledWith({
			actorId: "system:catalog-scheduler",
			now,
		});
		expect(mocks.auditValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "platform_catalog.apply",
				resourceId: "change-1",
				success: true,
				metadata: expect.objectContaining({
					catalogRevision: 8,
					scheduled: true,
				}),
			}),
		);
	});

	it("records a failed stale schedule without hiding later results", async () => {
		mocks.applyDue.mockResolvedValue([
			{
				changeSetId: "stale-change",
				catalogRevision: 0,
				affectedEntities: [],
				cacheInvalidation: "failed",
				error: "Catalog change set base revision is stale",
			},
		]);

		await runCatalogSchedulerPass();

		expect(mocks.auditValues).toHaveBeenCalledWith(
			expect.objectContaining({
				resourceId: "stale-change",
				success: false,
				metadata: expect.objectContaining({
					error: "Catalog change set base revision is stale",
				}),
			}),
		);
	});
});
