DROP INDEX "platform_catalog_revision_checksum_unique";--> statement-breakpoint
CREATE INDEX "platform_catalog_revision_checksum_idx" ON "platform_catalog_revision" ("checksum");