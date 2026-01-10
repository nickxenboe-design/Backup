ALTER TABLE IF EXISTS "carts" ADD COLUMN IF NOT EXISTS "round_diff" numeric(10, 2);--> statement-breakpoint
ALTER TABLE IF EXISTS "payments" ADD COLUMN IF NOT EXISTS "round_diff" numeric(10, 2);
