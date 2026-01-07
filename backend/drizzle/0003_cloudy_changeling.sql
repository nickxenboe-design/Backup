CREATE TABLE IF NOT EXISTS "cities" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"country" text,
	"region" text,
	"latitude" numeric(10, 6),
	"longitude" numeric(10, 6)
);
