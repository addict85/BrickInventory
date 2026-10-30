-- Passkeys (WebAuthn): Anmeldung ohne Passwort und zweiter Faktor neben TOTP.
-- Gespeichert wird nur der öffentliche Schlüssel; der Zähler fängt geklonte
-- Authenticatoren, die Einmal-Challenges fangen wiederholte Antworten.
CREATE TABLE passkeys (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BYTEA NOT NULL,
  sign_count    BIGINT NOT NULL DEFAULT 0,
  transports    TEXT,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used     TIMESTAMPTZ
);
CREATE INDEX idx_passkeys_konto ON passkeys (user_id);

-- Eine Challenge gilt einmal und kurz; gespeichert als SHA-256, gelöscht beim Einlösen.
CREATE TABLE webauthn_challenges (
  challenge  TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  zweck      TEXT NOT NULL CHECK (zweck IN ('registrieren', 'anmelden', 'zweiter_faktor')),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_webauthn_challenges_frist ON webauthn_challenges (expires_at);
CREATE INDEX idx_webauthn_challenges_konto ON webauthn_challenges (user_id);
