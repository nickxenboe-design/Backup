CREATE TABLE IF NOT EXISTS "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'carts'
			AND column_name = 'firestore_cart_id'
	) AND NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'carts'
			AND column_name = 'busbud_cart_id'
	) THEN
		ALTER TABLE "carts" RENAME COLUMN "firestore_cart_id" TO "busbud_cart_id";
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "booked_by" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_id" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_uuid" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'agents_branch_id_branches_id_fk'
	) THEN
		ALTER TABLE "agents" ADD CONSTRAINT "agents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;