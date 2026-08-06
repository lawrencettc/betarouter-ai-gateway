ALTER TABLE "model_provider_mapping" ADD COLUMN "embeddings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "image_generations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "video_generations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "speech_generations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "transcriptions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "realtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "realtime_transcription" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "ocr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "rerank" boolean DEFAULT false NOT NULL;