ALTER TABLE "practitioners" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "deleted_at" timestamp;
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooldowns" (
	"identity" text PRIMARY KEY,
	"last_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_attempts" (
	"id" serial PRIMARY KEY,
	"ip" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" serial PRIMARY KEY,
	"identity" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_sessions" (
	"token_hash" text PRIMARY KEY,
	"identity" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_requests" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"requested_by" text NOT NULL,
	"pesel" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"profession" text NOT NULL,
	"specialization" text,
	"proof" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"note" text
);
--> statement-breakpoint
INSERT INTO "cooldowns" ("identity", "last_at") SELECT "created_by", max("created_at") FROM "practitioners" WHERE "created_by" IS NOT NULL GROUP BY "created_by";
