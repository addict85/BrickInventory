-- ── Zweiter Faktor: Einmalcodes nach RFC 6238 (TOTP), freiwillig je Konto ───
--
-- Eigene Tabellen statt Spalten an users: Mehrere Stellen lesen
-- `SELECT * FROM users`, und keine davon soll den Schlüssel je zu sehen
-- bekommen.
--
-- geheimnis steht im Klartext (Base32) — der Server muss ihn zum Prüfen
-- lesen können. Wer die Datenbank hat, braucht den zweiten Faktor nicht mehr;
-- er schützt gegen erratene und mehrfach benutzte Passwörter. Deshalb gehören
-- Sicherungen weiter nur dem Besitzer (scripts/backup.sh).
CREATE TABLE zweiter_faktor (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  geheimnis        TEXT NOT NULL,
  -- false, solange die Einrichtung nicht mit einem gültigen Code bestätigt ist.
  aktiv            BOOLEAN NOT NULL DEFAULT FALSE,
  -- Der zuletzt angenommene Zeitschritt: Derselbe Code gilt nur einmal.
  letzter_schritt  BIGINT NOT NULL DEFAULT 0,
  eingerichtet_am  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wiederherstellungscodes, nur als SHA-256 (sie sind zufällig und lang genug,
-- dass ein langsamer Hash nichts beiträgt).
CREATE TABLE zweiter_faktor_codes (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash      TEXT NOT NULL,
  verbraucht_am  TIMESTAMPTZ
);

CREATE INDEX idx_zweiter_faktor_codes_konto ON zweiter_faktor_codes (user_id);
