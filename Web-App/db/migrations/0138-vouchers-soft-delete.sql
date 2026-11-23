-- A deleted voucher stays restorable for a few days (undo in both apps); the hourly cleanup removes
-- row and PDF for good afterwards. A voucher is cash, so a slip must not cost it at once.
ALTER TABLE vouchers ADD COLUMN deleted_at TIMESTAMPTZ;

-- Unique among the live cards only: a deleted card must not block entering the same number again.
-- Restoring it then would collide, and the service answers that with "already exists".
ALTER TABLE vouchers DROP CONSTRAINT vouchers_user_id_number_search_key;
CREATE UNIQUE INDEX vouchers_user_id_number_search_key ON vouchers (user_id, number_search) WHERE deleted_at IS NULL;

-- The cleanup searches the few deleted rows, not the whole table.
CREATE INDEX vouchers_deleted_at ON vouchers (deleted_at) WHERE deleted_at IS NOT NULL;
