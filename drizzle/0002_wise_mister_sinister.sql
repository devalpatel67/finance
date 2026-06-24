ALTER TABLE "statements" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "statements_user_content_hash" ON "statements" USING btree ("user_id","content_hash");