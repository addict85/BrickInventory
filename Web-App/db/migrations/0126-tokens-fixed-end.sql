-- Every device access ends: tokens without a fixed end ("unlimited" from the QR dialog, the
-- sliding ones from token-create) get one 90 days from now, the default of TOKEN_MAX_DAYS.
-- From now, not from creation: an old device keeps working until then and signs in again.
-- The cleanup run bounds rows that still come without an end (src/account/deviceToken.ts). Repeatable.
UPDATE api_tokens
   SET hard_expires_at = NOW() + INTERVAL '90 days', never_expires = FALSE
 WHERE hard_expires_at IS NULL;
