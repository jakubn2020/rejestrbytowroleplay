CREATE TABLE IF NOT EXISTS "exams" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"pass_percent" integer DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exam_questions" (
	"id" serial PRIMARY KEY,
	"exam_id" integer NOT NULL,
	"version" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"options" text DEFAULT '[]' NOT NULL,
	"correct" text DEFAULT '' NOT NULL,
	"points" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exam_sessions" (
	"id" serial PRIMARY KEY,
	"exam_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"token" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"started_at" timestamp,
	"ends_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exam_participants" (
	"id" serial PRIMARY KEY,
	"session_id" integer NOT NULL,
	"login" text NOT NULL,
	"token" text,
	"version" text,
	"seed" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp,
	"submitted_at" timestamp,
	"last_seen_at" timestamp,
	"last_activity_at" timestamp,
	"answers" text DEFAULT '{}' NOT NULL,
	"open_grades" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exam_events" (
	"id" serial PRIMARY KEY,
	"participant_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"details" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_questions_exam_idx" ON "exam_questions" ("exam_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_sessions_token_idx" ON "exam_sessions" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_participants_session_idx" ON "exam_participants" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_events_participant_idx" ON "exam_events" ("participant_id");
