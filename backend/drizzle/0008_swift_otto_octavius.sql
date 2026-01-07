CREATE TABLE IF NOT EXISTS "carts" (
	"id" serial PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"firestore_cart_id" text,
	"status" text,
	"currency" text,
	"origin" text,
	"destination" text,
	"depart_at" text,
	"arrive_at" text,
	"return_origin" text,
	"return_destination" text,
	"return_depart_at" text,
	"return_arrive_at" text,
	"passenger_count" integer,
	"purchaser" jsonb,
	"passengers" jsonb,
	"busbud_response" jsonb,
	"cost_price" numeric(10, 2),
	"retail_price" numeric(10, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_cart_id_unique" UNIQUE("cart_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "hold_pdf_base64" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_pdf_base64" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_zip_base64" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "hold_pdf_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_pdf_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_zip_updated_at" timestamp with time zone;