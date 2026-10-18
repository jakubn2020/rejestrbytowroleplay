CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" text
);
