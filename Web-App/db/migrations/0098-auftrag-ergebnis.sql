-- Das Ergebnis eines Imports, den eine Anfrage eingereicht hat und abwartet
-- (src/auftraege/importAlsAuftrag.ts). Wie die Nutzlast nicht im Datenbank-Browser.
ALTER TABLE auftraege ADD COLUMN IF NOT EXISTS ergebnis jsonb;
