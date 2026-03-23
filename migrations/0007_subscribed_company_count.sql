ALTER TABLE "user_billing" ADD COLUMN subscribed_company_count INTEGER DEFAULT 0;

-- Backfill: set subscribed_company_count to the number of companies for active subscribers
UPDATE user_billing SET subscribed_company_count = (
  SELECT COUNT(*) FROM company WHERE company.user_id = user_billing.user_id
) WHERE subscription_status = 'active';
