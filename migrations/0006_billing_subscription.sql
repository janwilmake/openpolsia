ALTER TABLE "user_billing" ADD COLUMN subscription_status TEXT DEFAULT 'none';
ALTER TABLE "user_billing" ADD COLUMN stripe_subscription_id TEXT;

-- Migrate existing subscription data from company to user_billing
UPDATE user_billing SET
  subscription_status = (
    SELECT c.subscription_status FROM company c WHERE c.user_id = user_billing.user_id AND c.subscription_status = 'active' LIMIT 1
  ),
  stripe_subscription_id = (
    SELECT c.stripe_subscription_id FROM company c WHERE c.user_id = user_billing.user_id AND c.stripe_subscription_id IS NOT NULL LIMIT 1
  )
WHERE EXISTS (
  SELECT 1 FROM company c WHERE c.user_id = user_billing.user_id AND c.subscription_status = 'active'
);
