ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entry_revisions" (
	"id" serial PRIMARY KEY,
	"entry_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"summary" text NOT NULL,
	"before" text NOT NULL
);
