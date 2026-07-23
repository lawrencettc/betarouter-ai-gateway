import { getCatalogBreakerStates } from "@betarouter/catalog";
import { db, log, platformMappingHealthSummary, sql } from "@betarouter/db";
import { logger } from "@betarouter/logger";

interface HealthAggregateRow extends Record<string, unknown> {
	mapping_id: string;
	catalog_revision: number;
	request_count: string;
	upstream_failure_count: string;
	latency_p50_ms: string | null;
	latency_p95_ms: string | null;
	last_success_at: Date | null;
}

export async function aggregateCatalogHealth(
	windowMinutes = 5,
): Promise<number> {
	const boundedWindow = Math.min(Math.max(Math.floor(windowMinutes), 1), 60);
	const rows = await db.execute<HealthAggregateRow>(sql`
		SELECT
			${log.modelProviderMappingId} AS mapping_id,
			${log.catalogRevisionId} AS catalog_revision,
			COUNT(*)::text AS request_count,
			COUNT(*) FILTER (
				WHERE ${log.hasError} IS TRUE
				AND (
				COALESCE(
					NULLIF(${log.internalErrorDetails}->>'statusCode', '')::integer,
					NULLIF(${log.errorDetails}->>'statusCode', '')::integer,
					500
				) NOT BETWEEN 400 AND 499
				OR COALESCE(
					NULLIF(${log.internalErrorDetails}->>'statusCode', '')::integer,
					NULLIF(${log.errorDetails}->>'statusCode', '')::integer,
					0
				) = 429
				)
			)::text AS upstream_failure_count,
			ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${log.duration}))::text AS latency_p50_ms,
			ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY ${log.duration}))::text AS latency_p95_ms,
			MAX(${log.createdAt}) FILTER (WHERE ${log.hasError} IS NOT TRUE) AS last_success_at
		FROM ${log}
		WHERE ${log.createdAt} >= NOW() - (${boundedWindow} * INTERVAL '1 minute')
			AND ${log.modelProviderMappingId} IS NOT NULL
			AND ${log.catalogRevisionId} IS NOT NULL
		GROUP BY ${log.modelProviderMappingId}, ${log.catalogRevisionId}
	`);

	const aggregates = rows.rows;
	if (aggregates.length === 0) {
		return 0;
	}
	const byRevision = new Map<number, string[]>();
	for (const row of aggregates) {
		const mappingIds = byRevision.get(row.catalog_revision) ?? [];
		mappingIds.push(row.mapping_id);
		byRevision.set(row.catalog_revision, mappingIds);
	}
	const breakers = new Map<
		number,
		Awaited<ReturnType<typeof getCatalogBreakerStates>>
	>();
	for (const [revision, mappingIds] of byRevision) {
		try {
			breakers.set(
				revision,
				await getCatalogBreakerStates({ revision, mappingIds }),
			);
		} catch (error) {
			logger.warn("Catalog breaker state unavailable during health rollup", {
				revision,
				error: error instanceof Error ? error.message : String(error),
			});
			breakers.set(revision, {});
		}
	}

	await db.insert(platformMappingHealthSummary).values(
		aggregates.map((row) => {
			const breaker = breakers.get(row.catalog_revision)?.[row.mapping_id];
			return {
				mappingId: row.mapping_id,
				catalogRevision: row.catalog_revision,
				breakerState: breaker?.state ?? "closed",
				requestCount: Number(row.request_count),
				upstreamFailureCount: Number(row.upstream_failure_count),
				latencyP50Ms: row.latency_p50_ms ? Number(row.latency_p50_ms) : null,
				latencyP95Ms: row.latency_p95_ms ? Number(row.latency_p95_ms) : null,
				lastSuccessAt: row.last_success_at,
				openedAt: breaker?.openedAt ? new Date(breaker.openedAt) : null,
				retryAt: breaker?.retryAt ? new Date(breaker.retryAt) : null,
			};
		}),
	);
	return aggregates.length;
}
