-- User credit & subscription
ALTER TABLE "user" ADD COLUMN "credit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "monthlySubscription" TEXT DEFAULT NULL;

-- Companies
CREATE TABLE IF NOT EXISTS "company" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "method" TEXT NOT NULL,
  "sourceInput" TEXT,
  "createdAt" TEXT NOT NULL
);

-- Transactions
CREATE TABLE IF NOT EXISTS "transaction" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "amount" INTEGER NOT NULL,
  "description" TEXT,
  "createdAt" TEXT NOT NULL
);
