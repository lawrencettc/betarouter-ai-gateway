ALTER TABLE "platform_mapping_policy" ADD COLUMN "source_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "platform_model_policy" ADD COLUMN "source_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "platform_provider_policy" ADD COLUMN "source_overrides" jsonb;