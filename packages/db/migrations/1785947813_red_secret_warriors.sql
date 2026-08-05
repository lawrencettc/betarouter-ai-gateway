CREATE TABLE "platform_catalog_review_entry" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_key" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text,
	"drift_values" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text,
	CONSTRAINT "platform_catalog_review_entry_kind_check" CHECK ("kind" IN ('override_drift', 'entity_added', 'entity_retired')),
	CONSTRAINT "platform_catalog_review_entry_entity_type_check" CHECK ("entity_type" IN ('provider', 'model', 'mapping')),
	CONSTRAINT "platform_catalog_review_entry_status_check" CHECK ("status" IN ('open', 'resolved')),
	CONSTRAINT "platform_catalog_review_entry_resolution_check" CHECK ("resolution" IS NULL OR "resolution" IN ('baseline', 'override_kept', 'override_cleared', 'acknowledged', 'superseded')),
	CONSTRAINT "platform_catalog_review_entry_resolved_state_check" CHECK (("status" = 'open' AND "resolved_at" IS NULL AND "resolution" IS NULL) OR ("status" = 'resolved' AND "resolved_at" IS NOT NULL AND "resolution" IS NOT NULL)),
	CONSTRAINT "platform_catalog_review_entry_field_check" CHECK (("kind" = 'override_drift') = ("field" IS NOT NULL)),
	CONSTRAINT "platform_catalog_review_entry_drift_values_check" CHECK (("kind" = 'override_drift') = ("drift_values" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_catalog_review_entry_open_key_unique" ON "platform_catalog_review_entry" ("entry_key") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "platform_catalog_review_entry_status_kind_idx" ON "platform_catalog_review_entry" ("status","kind");--> statement-breakpoint
CREATE INDEX "platform_catalog_review_entry_key_idx" ON "platform_catalog_review_entry" ("entry_key");