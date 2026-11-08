UPDATE "practitioners" SET "profession" = 'Pielęgniarz' WHERE "profession" LIKE 'Pielęgniarz (%';
--> statement-breakpoint
UPDATE "practitioners" SET "profession" = 'Ratownik medyczny' WHERE "profession" LIKE 'Ratownik medyczny (%';
--> statement-breakpoint
UPDATE "entry_requests" SET "profession" = 'Pielęgniarz' WHERE "profession" LIKE 'Pielęgniarz (%';
--> statement-breakpoint
UPDATE "entry_requests" SET "profession" = 'Ratownik medyczny' WHERE "profession" LIKE 'Ratownik medyczny (%';
--> statement-breakpoint
DELETE FROM "settings" WHERE "key" = 'seal';
