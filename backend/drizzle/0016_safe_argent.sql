ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "booked_by" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_id" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_uuid" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);