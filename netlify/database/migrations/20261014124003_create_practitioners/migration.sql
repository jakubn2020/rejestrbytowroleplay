CREATE TABLE "practitioners" (
	"id" serial PRIMARY KEY,
	"pesel" text NOT NULL UNIQUE,
	"pwz" text NOT NULL UNIQUE,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"profession" text NOT NULL,
	"specialization" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
