-- Ein Zähler je Konto, den jede Sitzung bei der Anmeldung abschreibt. Wer
-- Zugänge beendet, erhöht ihn: Eine Sitzungszeile, die eine laufende Anfrage
-- nach dem Löschen wieder schreibt, trägt dann eine veraltete Zahl.
ALTER TABLE users ADD COLUMN sitzungs_version integer NOT NULL DEFAULT 0;
