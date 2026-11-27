-- The nightly balance check of every account's vouchers runs as a scheduled job
-- (src/vouchers/nightlyBalances.ts); jobs.type only accepts registered kinds.
INSERT INTO job_types (type) VALUES ('voucher_balances') ON CONFLICT DO NOTHING;
