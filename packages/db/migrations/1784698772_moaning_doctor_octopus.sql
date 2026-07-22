ALTER TABLE "model_provider_mapping" ADD COLUMN "image_output_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "output_audio_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "input_character_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "ocr_page_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "per_second_price" jsonb;