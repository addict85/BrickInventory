-- Alle Hintergrundarbeit läuft über die Auftragstabelle, auch Zeitpläne:
-- Ein geplanter Lauf ist ein offener Auftrag mit faellig_ab in der Zukunft.
-- next_run_at trug bisher zwei Bedeutungen (fällig ab / Frist eines
-- laufenden); getrennt sind beide abfragbar und in der Verwaltung lesbar.
ALTER TABLE auftraege RENAME COLUMN next_run_at TO faellig_ab;
ALTER TABLE auftraege ADD COLUMN frist_bis   TIMESTAMPTZ;
ALTER TABLE auftraege ADD COLUMN gestartet   TIMESTAMPTZ;
ALTER TABLE auftraege ADD COLUMN fortschritt JSONB;
UPDATE auftraege SET frist_bis = faellig_ab WHERE status = 'laeuft';

-- 'abgebrochen': von Hand in der Verwaltung, nicht gescheitert.
ALTER TABLE auftraege DROP CONSTRAINT auftraege_status_check;
ALTER TABLE auftraege ADD CONSTRAINT auftraege_status_check
  CHECK (status IN ('offen', 'laeuft', 'erledigt', 'fehler', 'abgebrochen'));

DROP INDEX idx_auftraege_faellig;
CREATE INDEX idx_auftraege_offen_faellig ON auftraege (faellig_ab) WHERE status = 'offen';
CREATE INDEX idx_auftraege_frist   ON auftraege (frist_bis)  WHERE status = 'laeuft';
CREATE INDEX idx_auftraege_art     ON auftraege (art, status);

-- Drosselt eine Gegenseite (Cloudflare, CDN, Tageskontingent) oder will sie
-- Abstand zwischen zwei Abrufen, wartet die ganze Art bis `bis`. `stufe`
-- zählt wiederholte Drosselungen für einen wachsenden Abstand.
CREATE TABLE auftrag_pausen (
  art    TEXT PRIMARY KEY,
  bis    TIMESTAMPTZ NOT NULL,
  grund  TEXT,
  stufe  INTEGER NOT NULL DEFAULT 0
);

-- Die Auslöser der alten Planer haben keinen Leser mehr.
DELETE FROM laufzustand WHERE schluessel IN ('job_reschedule_trigger', 'csv_sync_trigger');
