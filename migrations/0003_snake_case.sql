-- Rename camelCase columns to snake_case in our tables
-- (Better Auth tables are left untouched)

-- user: monthlySubscription -> monthly_subscription
ALTER TABLE "user" RENAME COLUMN "monthlySubscription" TO "monthly_subscription";

-- company: rename camelCase columns
ALTER TABLE "company" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "company" RENAME COLUMN "sourceInput" TO "source_input";
ALTER TABLE "company" RENAME COLUMN "createdAt" TO "created_at";

-- transaction: rename camelCase columns
ALTER TABLE "transaction" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "transaction" RENAME COLUMN "createdAt" TO "created_at";
