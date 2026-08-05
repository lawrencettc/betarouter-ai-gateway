ALTER TABLE "model" ADD COLUMN "source" text DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "pricing_tiers" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "service_tier_multipliers" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supported_tool_choices" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "reasoning_efforts" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "source" text DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "protocol" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "priority" double precision;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "content_filter" boolean;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "max_temperature" double precision;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "headquarters" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "data_policy" jsonb;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "service_tiers" jsonb;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "region_config" jsonb;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "terms_url" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "privacy_policy_url" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "status_page_url" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "api_key_instructions" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "model_card_badge" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "additional_links" jsonb;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "source" text DEFAULT 'static' NOT NULL;