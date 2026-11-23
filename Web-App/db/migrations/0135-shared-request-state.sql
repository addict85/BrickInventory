-- The request budget per account and the one-time PDF tickets lived in the memory
-- of the one web process. Here they hold across every web process on this database,
-- so more than one may run. Both are account rows: row security as for idempotency.

-- One row per account (bounded by the accounts, no cleanup needed). last_allowed
-- says whether the last claim fitted: RETURNING only sees the new row.
CREATE TABLE api_budget (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  units        INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  jobs         INTEGER NOT NULL DEFAULT 0 CHECK (jobs >= 0),
  last_allowed BOOLEAN NOT NULL DEFAULT TRUE
);

-- Only the hash of a ticket is stored; it is valid once and until expires_at.
CREATE TABLE pdf_tickets (
  ticket_hash TEXT PRIMARY KEY CHECK (length(ticket_hash) = 64),
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target      TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 40),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX pdf_tickets_expires_at ON pdf_tickets (expires_at);
-- Deleting an account searches its tickets (ON DELETE CASCADE).
CREATE INDEX pdf_tickets_user_id ON pdf_tickets (user_id);

ALTER TABLE api_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY row_security ON api_budget
  USING (user_id = (SELECT row_security_account()))
  WITH CHECK (user_id = (SELECT row_security_account()));

ALTER TABLE pdf_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY row_security ON pdf_tickets
  USING (user_id = (SELECT row_security_account()))
  WITH CHECK (user_id = (SELECT row_security_account()));
