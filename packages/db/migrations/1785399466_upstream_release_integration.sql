CREATE TABLE "lounge_point_event" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_survey_response" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"model_id" text NOT NULL,
	"value_score" integer NOT NULL,
	"quality_score" integer NOT NULL,
	"speed_score" integer NOT NULL,
	"would_recommend" boolean NOT NULL,
	"primary_use_case" text NOT NULL,
	"comment" text,
	"request_count" integer NOT NULL,
	"dev_plan_tier" text NOT NULL,
	"reward_tier" text,
	CONSTRAINT "model_survey_response_quarter_check" CHECK ("quarter" >= 1 AND "quarter" <= 4),
	CONSTRAINT "model_survey_response_value_score_check" CHECK ("value_score" >= 1 AND "value_score" <= 5),
	CONSTRAINT "model_survey_response_quality_score_check" CHECK ("quality_score" >= 1 AND "quality_score" <= 5),
	CONSTRAINT "model_survey_response_speed_score_check" CHECK ("speed_score" >= 1 AND "speed_score" <= 5)
);
--> statement-breakpoint
CREATE TABLE "playground_realtime_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"voice" text,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"transcript" jsonb NOT NULL,
	"usage" jsonb
);
--> statement-breakpoint
CREATE TABLE "realtime_session" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"requested_model" text NOT NULL,
	"used_model" text NOT NULL,
	"used_model_mapping" text,
	"used_provider" text NOT NULL,
	"mode" text NOT NULL,
	"used_mode" text NOT NULL,
	"upstream_session_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"close_reason" text,
	"response_count" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"bytes_in" integer DEFAULT 0 NOT NULL,
	"bytes_out" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"last_activity_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "refund_feedback" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"comments" text
);
--> statement-breakpoint
CREATE TABLE "user_iam_rule" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_organization_id" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_value" json NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_key" DROP CONSTRAINT "provider_key_organization_id_name_unique";--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "api_origin" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "realtime_session_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "realtime_usage_key" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "billing_cost" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "audio_output_tokens" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "audio_output_cost" real;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "realtime_usage" jsonb;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "input_audio_hour_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_source_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "compliance_attestation" jsonb;--> statement-breakpoint
-- Build the four large-table indexes below (the two "log" indexes here and the
-- two *_provider_stats_v2_idx ones further down) out of band BEFORE deploying
-- this migration, otherwise the migrator scans "log" /
-- "model_provider_mapping_history" while holding a lock — and the worker
-- writes to the history table every minute:
--
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "log_realtime_session_usage_key_unique"
--     ON "log" ("realtime_session_id","realtime_usage_key") WHERE realtime_usage_key IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "log_realtime_unsettled_organization_id_idx"
--     ON "log" ("organization_id") WHERE realtime_session_id IS NOT NULL AND processed_at IS NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "model_provider_mapping_history_provider_stats_v2_idx"
--     ON "model_provider_mapping_history" ("minute_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_hourly_provider_stats_v2_idx"
--     ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--
-- Run those with psql (autocommit) — CONCURRENTLY cannot run in a transaction —
-- then check pg_index.indisvalid: a failed concurrent build leaves an INVALID
-- index that must be dropped with DROP INDEX CONCURRENTLY before retrying.
--
-- IF NOT EXISTS then makes the creates a no-op there, while small databases
-- (dev, CI, fresh installs) just build them inline. The old *_provider_stats_idx
-- indexes are dropped last so reads keep a usable index throughout.
CREATE UNIQUE INDEX IF NOT EXISTS "log_realtime_session_usage_key_unique" ON "log" ("realtime_session_id","realtime_usage_key") WHERE realtime_usage_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_realtime_unsettled_organization_id_idx" ON "log" ("organization_id") WHERE realtime_session_id IS NOT NULL AND processed_at IS NULL;--> statement-breakpoint
CREATE INDEX "lounge_point_event_user_id_idx" ON "lounge_point_event" ("user_id");--> statement-breakpoint
CREATE INDEX "lounge_point_event_user_id_created_at_idx" ON "lounge_point_event" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_provider_stats_v2_idx" ON "model_provider_mapping_history" ("minute_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_provider_stats_v2_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE UNIQUE INDEX "model_survey_response_user_model_period_unique" ON "model_survey_response" ("user_id","model_id","year","quarter");--> statement-breakpoint
CREATE UNIQUE INDEX "model_survey_response_org_period_reward_unique" ON "model_survey_response" ("organization_id","year","quarter") WHERE "reward_tier" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "model_survey_response_year_model_idx" ON "model_survey_response" ("year","model_id");--> statement-breakpoint
CREATE INDEX "model_survey_response_organization_id_idx" ON "model_survey_response" ("organization_id");--> statement-breakpoint
CREATE INDEX "playground_realtime_history_user_id_idx" ON "playground_realtime_history" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_key_organization_id_name_unique" ON "provider_key" ("organization_id","name") WHERE status <> 'deleted';--> statement-breakpoint
CREATE INDEX "realtime_session_organization_id_created_at_idx" ON "realtime_session" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "realtime_session_project_id_created_at_idx" ON "realtime_session" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "realtime_session_api_key_id_created_at_idx" ON "realtime_session" ("api_key_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_feedback_transaction_id_unique" ON "refund_feedback" ("transaction_id");--> statement-breakpoint
CREATE INDEX "refund_feedback_organization_id_idx" ON "refund_feedback" ("organization_id");--> statement-breakpoint
CREATE INDEX "refund_feedback_created_at_idx" ON "refund_feedback" ("created_at");--> statement-breakpoint
CREATE INDEX "user_iam_rule_user_organization_id_idx" ON "user_iam_rule" ("user_organization_id");--> statement-breakpoint
CREATE INDEX "user_iam_rule_user_organization_id_status_idx" ON "user_iam_rule" ("user_organization_id","status");--> statement-breakpoint
ALTER TABLE "lounge_point_event" ADD CONSTRAINT "lounge_point_event_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_survey_response" ADD CONSTRAINT "model_survey_response_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_survey_response" ADD CONSTRAINT "model_survey_response_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "playground_realtime_history" ADD CONSTRAINT "playground_realtime_history_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "playground_realtime_history" ADD CONSTRAINT "playground_realtime_history_6gba5Xye7cwi_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "realtime_session" ADD CONSTRAINT "realtime_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "realtime_session" ADD CONSTRAINT "realtime_session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "realtime_session" ADD CONSTRAINT "realtime_session_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refund_feedback" ADD CONSTRAINT "refund_feedback_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refund_feedback" ADD CONSTRAINT "refund_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refund_feedback" ADD CONSTRAINT "refund_feedback_transaction_id_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_iam_rule" ADD CONSTRAINT "user_iam_rule_user_organization_id_user_organization_id_fkey" FOREIGN KEY ("user_organization_id") REFERENCES "user_organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_attestation_custom_only" CHECK ("compliance_attestation" IS NULL OR "provider" = 'custom');--> statement-breakpoint
DROP INDEX IF EXISTS "model_provider_mapping_history_provider_stats_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mpm_history_hourly_provider_stats_idx";--> statement-breakpoint
-- Data retention is no longer offered on DevPass or Chat: those products never
-- store request/response payloads, and the setting has been removed from their
-- dashboards. Force every existing DevPass/Chat org to metadata-only. Regular
-- PAYG/dashboard organizations (kind = 'default') keep whatever they configured.
UPDATE "organization"
SET "retention_level" = 'none'
WHERE "kind" IN ('devpass', 'chat')
	AND "retention_level" <> 'none';