CREATE TABLE IF NOT EXISTS "account_removal_requests" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"requested_by" text NOT NULL,
	"target_email" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"note" text
);
