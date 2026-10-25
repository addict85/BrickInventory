-- ── Papierkorb: gelöschte Sets, manuelle Teile und Figuren für 30 Tage ──────
--
-- Ein Schnappschuss der gelöschten Zeilen als JSON statt einer Spalte
-- deleted_at: So ändert sich kein einziger Lesepfad, und die eindeutigen
-- Indizes (sets, idx_parts_eindeutig …) gelten weiter, ohne Ausnahme für
-- „gelöschte" Zeilen.
--
-- zeilen: { "<tabelle>": [ <zeile als to_jsonb>, … ], … }
CREATE TABLE papierkorb (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  art          TEXT NOT NULL CHECK (art IN ('set', 'teil', 'figur')),
  nummer       TEXT NOT NULL,
  farbe_id     INTEGER,
  bezeichnung  TEXT,
  zeilen       JSONB NOT NULL,
  geloescht_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_papierkorb_konto ON papierkorb (user_id, geloescht_am DESC);
