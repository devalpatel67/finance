ALTER TABLE "transactions" ADD COLUMN "direction" text DEFAULT 'outflow' NOT NULL;
--> statement-breakpoint
UPDATE "transactions" SET "direction" = CASE WHEN "amount"::numeric >= 0 THEN 'inflow' ELSE 'outflow' END;