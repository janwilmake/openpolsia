ALTER TABLE "company" ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE "company" ADD COLUMN subscription_status TEXT DEFAULT 'none';

CREATE TABLE IF NOT EXISTS "user_billing" (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  task_credits INTEGER DEFAULT 50,
  tasks_used INTEGER DEFAULT 0
);
