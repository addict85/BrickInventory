-- Hintergrundarbeit als Zeile statt als setTimeout im Webprozess: Ein
-- Neustart verliert nichts, ein Fehler wird wiederholt und bleibt am Ende als
-- 'fehler' sichtbar. Abgearbeitet vom Primär-Worker (jobs/auftragsWorker.ts)
-- mit FOR UPDATE SKIP LOCKED; next_run_at ist bei 'laeuft' die Frist, nach
-- der ein verwaister Auftrag (Absturz) wieder vergeben wird.
CREATE TABLE auftraege (
  id            BIGSERIAL PRIMARY KEY,
  art           TEXT NOT NULL,
  nutzlast      JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  schluessel    TEXT,
  status        TEXT NOT NULL DEFAULT 'offen'
                CHECK (status IN ('offen', 'laeuft', 'erledigt', 'fehler')),
  versuche      INTEGER NOT NULL DEFAULT 0,
  max_versuche  INTEGER NOT NULL DEFAULT 5 CHECK (max_versuche > 0),
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  belegt_von    TEXT,
  fehler        TEXT,
  erstellt      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aktualisiert  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_auftraege_faellig ON auftraege (next_run_at) WHERE status IN ('offen', 'laeuft');
-- Derselbe Auftrag (z. B. die Bilder eines Sets) steht höchstens einmal offen.
CREATE UNIQUE INDEX idx_auftraege_schluessel ON auftraege (schluessel) WHERE status = 'offen';
CREATE INDEX idx_auftraege_user ON auftraege (user_id) WHERE user_id IS NOT NULL;
