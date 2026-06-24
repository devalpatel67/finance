ALTER TABLE "statements" ADD COLUMN "opening_balance" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "closing_balance" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "reconciliation_status" text;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "reconciliation_delta" numeric(14, 2);