CREATE INDEX IF NOT EXISTS "log_model_provider_mapping_id_idx" ON "log" ("model_provider_mapping_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_catalog_revision_id_idx" ON "log" ("catalog_revision_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_job_model_provider_mapping_id_idx" ON "video_job" ("model_provider_mapping_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_job_catalog_revision_id_idx" ON "video_job" ("catalog_revision_id");