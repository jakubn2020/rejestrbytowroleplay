ALTER TABLE "mfa_sessions" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "mfa_sessions" ADD COLUMN "ip" text;
--> statement-breakpoint
ALTER TABLE "mfa_sessions" ADD COLUMN "user_agent" text;
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"identity" text,
	"ip" text,
	"details" text,
	"is_alert" boolean DEFAULT false NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"contact" text,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" text,
	"handled_at" timestamp
);
