-- Jeder CSV-Import bekommt eine Laufkennung. Startet ein neuer Import,
-- während der alte noch arbeitet, schrieben bisher beide in dieselbe Zeile;
-- jetzt schreibt nur noch der Lauf, dessen Kennung dort steht.
ALTER TABLE csv_import_jobs ADD COLUMN IF NOT EXISTS run_id TEXT;
