ALTER TABLE IF EXISTS "carts" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);--> statement-breakpoint
ALTER TABLE IF EXISTS "payments" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);
