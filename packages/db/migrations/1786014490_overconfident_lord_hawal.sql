ALTER TABLE "model" ADD COLUMN "max_video_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supported_video_sizes" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supported_video_durations_seconds" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supported_video_durations_seconds_image_to_video" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supports_video_audio" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supports_video_without_audio" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supported_voices" jsonb;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "content_filter_price" numeric;