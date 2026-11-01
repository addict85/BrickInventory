-- Gespeicherte Antworten liegen ab jetzt verschlüsselt (Präfix v1:). Ältere
-- Zeilen trugen den Rumpf im Klartext, darunter Tokens und Codes. Der Rumpf
-- fällt weg, die Zeile bleibt: Eine Wiederholung bekommt 409 statt einer
-- zweiten Wirkung, und nach 24 Stunden räumt der Auftrag sie ohnehin ab.
UPDATE idempotenz SET antwort = NULL WHERE antwort IS NOT NULL AND antwort NOT LIKE 'v1:%';
