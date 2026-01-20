ALTER TABLE "cities" ALTER COLUMN "country_code2" SET DATA TYPE varchar(3);--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "city_lat" SET DATA TYPE numeric(10, 7);--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "city_lon" SET DATA TYPE numeric(10, 7);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "booked_by" text;--> statement-breakpoint
ALTER TABLE "cities" DROP COLUMN IF EXISTS "country";