ALTER TABLE "payments" ADD COLUMN "cost_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "discount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "markup" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "charges" numeric(10, 2);