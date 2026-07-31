CREATE TABLE "promo_banner" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"brand_name" text NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"message" text NOT NULL,
	"link_path" text NOT NULL,
	"ends_at" timestamp NOT NULL
);
--> statement-breakpoint
INSERT INTO "promo_banner" ("id", "enabled", "brand_name", "discount_percent", "message", "link_path", "ends_at")
VALUES ('singleton', true, 'Runware', 30, 'open-source models', '/providers/runware', '2026-08-26 23:59:59')
ON CONFLICT ("id") DO NOTHING;
