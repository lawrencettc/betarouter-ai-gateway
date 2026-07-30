ALTER TABLE "model_provider_mapping" ADD COLUMN "cache_read_input_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "input_audio_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "cached_image_input_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "cached_input_audio_price" numeric;