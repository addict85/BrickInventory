-- Wer einen Katalogwert eingetippt hat; NULL heißt: aus einer geprüften Quelle
-- (Rebrickable, BrickLink, eingespieltes Set). Ein eingetippter Wert ist nur
-- ein Platzhalter: Die geprüfte Quelle ersetzt ihn, und andere Konten fragen
-- trotz ihm nach. Ohne Fremdschlüssel, damit ein gelöschtes Konto den Wert
-- nicht nachträglich zum geprüften macht.
ALTER TABLE part_catalog       ADD COLUMN IF NOT EXISTS name_von      INTEGER;
ALTER TABLE part_catalog       ADD COLUMN IF NOT EXISTS kategorie_von INTEGER;
ALTER TABLE part_color_catalog ADD COLUMN IF NOT EXISTS farbname_von  INTEGER;
ALTER TABLE part_color_catalog ADD COLUMN IF NOT EXISTS farbcode_von  INTEGER;
ALTER TABLE part_color_catalog ADD COLUMN IF NOT EXISTS bild_von      INTEGER;
ALTER TABLE minifigs_catalog   ADD COLUMN IF NOT EXISTS name_von      INTEGER;
ALTER TABLE minifigs_catalog   ADD COLUMN IF NOT EXISTS bild_von      INTEGER;
