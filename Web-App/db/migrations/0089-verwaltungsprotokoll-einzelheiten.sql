-- Das Protokoll hält auch Änderungen an Servereinstellungen fest (Mailserver,
-- Zugangsschlüssel, Registrierung); welche, steht hier — Namen, nie Werte.
ALTER TABLE verwaltungsprotokoll ADD COLUMN einzelheiten text;
