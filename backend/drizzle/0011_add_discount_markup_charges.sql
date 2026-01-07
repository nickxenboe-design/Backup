ALTER TABLE IF EXISTS "carts" ADD COLUMN IF NOT EXISTS "discount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE IF EXISTS "carts" ADD COLUMN IF NOT EXISTS "markup" numeric(10, 2);--> statement-breakpoint
ALTER TABLE IF EXISTS "carts" ADD COLUMN IF NOT EXISTS "charges" numeric(10, 2);
