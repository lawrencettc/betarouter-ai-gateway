import { applyDueCatalogChangeSets } from "@llmgateway/catalog";
import { db, platformAuditLog } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

export async function runCatalogSchedulerPass(now = new Date()): Promise<void> {
	const results = await applyDueCatalogChangeSets({
		actorId: "system:catalog-scheduler",
		now,
	});
	for (const result of results) {
		if (result.alreadyApplied) {
			continue;
		}
		const success = !result.error;
		try {
			await db.insert(platformAuditLog).values({
				userId: "system:catalog-scheduler",
				action: "platform_catalog.apply",
				resourceId: result.changeSetId,
				success,
				metadata: {
					catalogRevision: result.catalogRevision || null,
					affectedEntityIds: result.affectedEntities,
					cacheInvalidation: result.cacheInvalidation,
					error: result.error ?? null,
					scheduled: true,
				},
			});
		} catch (error) {
			logger.error(
				"Failed to audit a scheduled catalog apply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
