-- Was Verwalter an fremden Konten tun, steht hier: Passwort setzen, zweiten
-- Faktor entfernen, Verwalterrolle ändern, Konto löschen. Eine erbeutete
-- Verwaltersitzung soll Spuren hinterlassen. ziel_name hält den Namen fest,
-- weil das Konto gelöscht sein kann.
CREATE TABLE IF NOT EXISTS verwaltungsprotokoll (
  id           SERIAL PRIMARY KEY,
  zeit         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verwalter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ziel_id      INTEGER,
  ziel_name    TEXT,
  aktion       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verwaltungsprotokoll_zeit ON verwaltungsprotokoll (zeit DESC);
CREATE INDEX IF NOT EXISTS idx_verwaltungsprotokoll_verwalter ON verwaltungsprotokoll (verwalter_id);
