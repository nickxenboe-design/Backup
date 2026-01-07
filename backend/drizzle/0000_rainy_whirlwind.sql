CREATE TABLE IF NOT EXISTS "cart_passenger_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"firestore_cart_id" text,
	"busbud_cart_id" text,
	"trip_id" text,
	"passenger_count" integer,
	"purchaser_first_name" varchar(128),
	"purchaser_last_name" varchar(128),
	"purchaser_email" varchar(256),
	"purchaser_phone" varchar(64),
	"opt_in_marketing" boolean,
	"passengers" jsonb NOT NULL,
	"purchaser" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer,
	"firestore_cart_id" text,
	"busbud_cart_id" text,
	"payment_ref" text,
	"amount" numeric(10, 2) NOT NULL,
	"method" varchar(64) NOT NULL,
	"status" varchar(64) NOT NULL,
	"currency" varchar(8),
	"transaction_ref" text NOT NULL,
	"raw_response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_transaction_ref_unique" UNIQUE("transaction_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_selections" (
	"id" serial PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"firestore_cart_id" text,
	"trip_id" text NOT NULL,
	"trip_type" varchar(32) NOT NULL,
	"is_round_trip" boolean DEFAULT false NOT NULL,
	"passenger_count" integer,
	"currency" varchar(8),
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
