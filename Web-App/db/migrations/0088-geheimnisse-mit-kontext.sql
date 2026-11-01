-- Geheimnisse liegen ab jetzt als v2: AES-GCM mit Kontext (Spalte, Konto,
-- Zeile) als zusätzlich authentifizierten Daten. Den Altbestand (v1, Klartext)
-- schlüsselt die App vor der ersten Anfrage um (startup/datenbank.ts).
-- NOT VALID: Bis dahin steht noch v1 da; jede neue und geänderte Zeile muss v2 sein.
ALTER TABLE vouchers DROP CONSTRAINT vouchers_nummer_verschluesselt;
ALTER TABLE vouchers ADD CONSTRAINT vouchers_nummer_verschluesselt
  CHECK (number LIKE 'v2:%' AND nummer_suche IS NOT NULL) NOT VALID;
