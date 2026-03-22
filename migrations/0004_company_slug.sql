-- Add slug column to company for email routing (e.g. slug@openpolsia.com)
ALTER TABLE "company" ADD COLUMN "slug" TEXT;

-- Backfill existing companies: use lowercase id prefix as slug
UPDATE "company" SET "slug" = LOWER(SUBSTR("id", 1, 8)) WHERE "slug" IS NULL;

-- Make slug unique and not null
CREATE UNIQUE INDEX "company_slug_unique" ON "company" ("slug");
