-- Status der PDF-Aufträge in der Datenbank statt in JSON-Dateien: Jeder
-- Arbeitsprozess sieht ihn gleich, und das Zählen laufender Aufträge ist eine
-- Abfrage statt eines Verzeichnisdurchlaufs (utils/pdfAuftraege.ts).
CREATE TABLE pdf_auftraege (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
  fehler          TEXT,
  fehlende_bilder INTEGER,
  eta_sekunden    INTEGER,
  aktualisiert    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pdf_auftraege_laufend ON pdf_auftraege (user_id) WHERE status = 'running';
