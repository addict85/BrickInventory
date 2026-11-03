-- Ersetzte Tokens bleiben als Hash stehen, solange ihre Familie lebt (gleiches
-- Konto und created_at, das der Tausch weitergibt): Kommt einer wieder, hat
-- ihn jemand kopiert, und die ganze Familie endet.
CREATE TABLE api_tokens_verbraucht (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familie timestamptz NOT NULL,
  verbraucht_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_tokens_verbraucht_familie ON api_tokens_verbraucht (user_id, familie);
