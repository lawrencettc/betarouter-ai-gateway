CREATE TABLE "platform_catalog_change_set" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"base_revision" bigint,
	"operations" jsonb NOT NULL,
	"impact_snapshot" jsonb,
	"effective_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_revision" bigint,
	"inverse_of" text,
	"error_code" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_catalog_revision" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_catalog_revision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_set_id" text NOT NULL,
	"applied_by" text NOT NULL,
	"checksum" text NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_mapping_health_summary" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mapping_id" text NOT NULL,
	"catalog_revision" bigint,
	"breaker_state" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"upstream_failure_count" integer DEFAULT 0 NOT NULL,
	"latency_p_50_ms" integer,
	"latency_p_95_ms" integer,
	"last_success_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"retry_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_mapping_policy" (
	"mapping_id" text PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"external_id_override" text,
	"context_size_limit" integer,
	"max_output_limit" integer,
	"disabled_capabilities" jsonb DEFAULT '[]' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"breaker_enabled" boolean DEFAULT true NOT NULL,
	"required_test_revision" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_mapping_policy_context_size_check" CHECK ("context_size_limit" IS NULL OR "context_size_limit" > 0),
	CONSTRAINT "platform_mapping_policy_max_output_check" CHECK ("max_output_limit" IS NULL OR "max_output_limit" > 0),
	CONSTRAINT "platform_mapping_policy_weight_check" CHECK ("weight" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "platform_mapping_price_policy" (
	"mapping_id" text PRIMARY KEY,
	"currency" text DEFAULT 'USD' NOT NULL,
	"mode" text NOT NULL,
	"markup_bps" integer,
	"fixed_prices" jsonb,
	"allow_negative_margin" boolean DEFAULT false NOT NULL,
	"negative_margin_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_mapping_price_policy_markup_check" CHECK ("markup_bps" IS NULL OR "markup_bps" BETWEEN -10000 AND 100000),
	CONSTRAINT "platform_mapping_price_policy_mode_value_check" CHECK (("mode" <> 'markup' OR "markup_bps" IS NOT NULL) AND ("mode" <> 'fixed' OR "fixed_prices" IS NOT NULL)),
	CONSTRAINT "platform_mapping_price_policy_negative_margin_check" CHECK ("allow_negative_margin" = false OR NULLIF(BTRIM("negative_margin_reason"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "platform_mapping_test_run" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"mapping_id" text NOT NULL,
	"credential_id" text,
	"catalog_revision" bigint,
	"status" text DEFAULT 'running' NOT NULL,
	"test_profile" text NOT NULL,
	"latency_ms" integer,
	"upstream_status" integer,
	"error_class" text,
	"sanitized_message" text,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_model_policy" (
	"model_id" text PRIMARY KEY,
	"visible" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_direct" boolean DEFAULT false NOT NULL,
	"display_name_override" text,
	"description_override" text,
	"aliases_override" jsonb,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"deprecated_at" timestamp with time zone,
	"retire_at" timestamp with time zone,
	"replacement_model_id" text,
	"retirement_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_model_policy_replacement_check" CHECK ("replacement_model_id" IS NULL OR "replacement_model_id" <> "model_id"),
	CONSTRAINT "platform_model_policy_lifecycle_dates_check" CHECK ("retire_at" IS NULL OR "deprecated_at" IS NULL OR "retire_at" > "deprecated_at")
);
--> statement-breakpoint
CREATE TABLE "platform_provider_policy" (
	"provider_id" text PRIMARY KEY,
	"visible" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_name_override" text,
	"description_override" text,
	"website_override" text,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"deprecated_at" timestamp with time zone,
	"retire_at" timestamp with time zone,
	"replacement_provider_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_provider_policy_lifecycle_dates_check" CHECK ("retire_at" IS NULL OR "deprecated_at" IS NULL OR "retire_at" > "deprecated_at")
);
--> statement-breakpoint
ALTER TABLE "platform_audit_log" DROP CONSTRAINT "platform_audit_log_15Y5ZyW9mO0x_fkey";--> statement-breakpoint
DROP INDEX "account_user_id_idx";--> statement-breakpoint
DROP INDEX "platform_provider_credential_active_fingerprint_unique";--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "model_provider_mapping_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "catalog_revision_id" bigint;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "model_provider_mapping_id" text;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "catalog_revision_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_catalog_change_set_idempotency_key_unique" ON "platform_catalog_change_set" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "platform_catalog_change_set_state_effective_at_idx" ON "platform_catalog_change_set" ("state","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_catalog_revision_change_set_id_unique" ON "platform_catalog_revision" ("change_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_catalog_revision_checksum_unique" ON "platform_catalog_revision" ("checksum");--> statement-breakpoint
CREATE INDEX "platform_mapping_health_summary_mapping_created_at_idx" ON "platform_mapping_health_summary" ("mapping_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_mapping_policy_enabled_priority_idx" ON "platform_mapping_policy" ("enabled","priority");--> statement-breakpoint
CREATE INDEX "platform_mapping_test_run_mapping_created_at_idx" ON "platform_mapping_test_run" ("mapping_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_model_policy_visible_enabled_idx" ON "platform_model_policy" ("visible","enabled");--> statement-breakpoint
CREATE INDEX "platform_provider_policy_visible_enabled_idx" ON "platform_provider_policy" ("visible","enabled");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_provider_credential_active_fingerprint_unique" ON "platform_provider_credential" ("token_fingerprint") WHERE "status" <> 'deleted';--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_model_provider_mapping_id_model_provider_mapping_id_fkey" FOREIGN KEY ("model_provider_mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_catalog_revision_id_platform_catalog_revision_id_fkey" FOREIGN KEY ("catalog_revision_id") REFERENCES "platform_catalog_revision"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "platform_catalog_change_set" ADD CONSTRAINT "platform_catalog_change_set_EByU555E9lzX_fkey" FOREIGN KEY ("base_revision") REFERENCES "platform_catalog_revision"("id");--> statement-breakpoint
ALTER TABLE "platform_catalog_change_set" ADD CONSTRAINT "platform_catalog_change_set_BeIaQXhZ9ly9_fkey" FOREIGN KEY ("applied_revision") REFERENCES "platform_catalog_revision"("id");--> statement-breakpoint
ALTER TABLE "platform_catalog_change_set" ADD CONSTRAINT "platform_catalog_change_set_Cpnl2u5LqnBo_fkey" FOREIGN KEY ("inverse_of") REFERENCES "platform_catalog_change_set"("id");--> statement-breakpoint
ALTER TABLE "platform_catalog_revision" ADD CONSTRAINT "platform_catalog_revision_xUfMSaP5uiPv_fkey" FOREIGN KEY ("change_set_id") REFERENCES "platform_catalog_change_set"("id");--> statement-breakpoint
ALTER TABLE "platform_mapping_health_summary" ADD CONSTRAINT "platform_mapping_health_summary_3PPb8IWP5652_fkey" FOREIGN KEY ("mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_mapping_health_summary" ADD CONSTRAINT "platform_mapping_health_summary_7TDrcrdnhfK8_fkey" FOREIGN KEY ("catalog_revision") REFERENCES "platform_catalog_revision"("id");--> statement-breakpoint
ALTER TABLE "platform_mapping_policy" ADD CONSTRAINT "platform_mapping_policy_sjHAqocVBJq9_fkey" FOREIGN KEY ("mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_mapping_price_policy" ADD CONSTRAINT "platform_mapping_price_policy_n6vrukmbMn6b_fkey" FOREIGN KEY ("mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_mapping_test_run" ADD CONSTRAINT "platform_mapping_test_run_FLp6YVTZGDtb_fkey" FOREIGN KEY ("mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_mapping_test_run" ADD CONSTRAINT "platform_mapping_test_run_RlZ24kV0qK3R_fkey" FOREIGN KEY ("credential_id") REFERENCES "platform_provider_credential"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "platform_mapping_test_run" ADD CONSTRAINT "platform_mapping_test_run_2dGZAmJelgbz_fkey" FOREIGN KEY ("catalog_revision") REFERENCES "platform_catalog_revision"("id");--> statement-breakpoint
ALTER TABLE "platform_model_policy" ADD CONSTRAINT "platform_model_policy_model_id_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_model_policy" ADD CONSTRAINT "platform_model_policy_replacement_model_id_model_id_fkey" FOREIGN KEY ("replacement_model_id") REFERENCES "model"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "platform_provider_policy" ADD CONSTRAINT "platform_provider_policy_provider_id_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_provider_policy" ADD CONSTRAINT "platform_provider_policy_KzgdY2NgsBKP_fkey" FOREIGN KEY ("replacement_provider_id") REFERENCES "provider"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_hSFrcdoaXLZP_fkey" FOREIGN KEY ("model_provider_mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_catalog_revision_id_platform_catalog_revision_id_fkey" FOREIGN KEY ("catalog_revision_id") REFERENCES "platform_catalog_revision"("id") ON DELETE SET NULL;