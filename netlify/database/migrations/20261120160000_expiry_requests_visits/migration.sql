CREATE TABLE "expiry_requests" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"requested_by" text NOT NULL,
	"practitioner_id" integer NOT NULL,
	"person_name" text NOT NULL,
	"pwz" text NOT NULL,
	"mode" text NOT NULL,
	"amount" integer,
	"unit" text,
	"proof" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "visit_stats" (
	"id" text PRIMARY KEY,
	"day" text NOT NULL,
	"path" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_uniques" (
	"id" text PRIMARY KEY,
	"day" text NOT NULL
);
