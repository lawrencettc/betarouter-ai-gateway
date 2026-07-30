CREATE TABLE "platform_audit_log" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text,
	"success" boolean NOT NULL,
	"request_id" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "platform_provider_credential" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" timestamp,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"options" jsonb,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"encrypted_token" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"encryption_auth_tag" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"masked_token" text NOT NULL,
	"token_fingerprint" text NOT NULL,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"validation_message" text,
	"last_validated_at" timestamp,
	"last_used_at" timestamp,
	"last_revealed_at" timestamp,
	"last_revealed_by" text
);
--> statement-breakpoint
CREATE INDEX "platform_audit_log_user_created_at_idx" ON "platform_audit_log" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_log_resource_created_at_idx" ON "platform_audit_log" ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_log_action_idx" ON "platform_audit_log" ("action");--> statement-breakpoint
CREATE INDEX "platform_provider_credential_provider_status_priority_idx" ON "platform_provider_credential" ("provider","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_provider_credential_active_fingerprint_unique" ON "platform_provider_credential" ("token_fingerprint") WHERE "status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_provider_credential_active_name_unique" ON "platform_provider_credential" ("provider","name") WHERE "status" <> 'deleted';--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "platform_provider_credential_id" text;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_15Y5ZyW9mO0x_fkey" FOREIGN KEY ("resource_id") REFERENCES "platform_provider_credential"("id");--> statement-breakpoint
