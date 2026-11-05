-- Preise lädt nur ein Auftrag zugleich nach: BrickLink zählt die Abrufe je Tag.
INSERT INTO auftrag_exklusiv (art) VALUES ('preise_nachladen') ON CONFLICT DO NOTHING;

-- Geldbeträge haben überall vier Nachkommastellen; gerundet wird erst in der
-- Anzeige.
ALTER TABLE vouchers ALTER COLUMN amount TYPE numeric(12,4);

-- Die Spaltennamen bleiben, weil Apps und Exporte sie lesen; die Bedeutung
-- steht am Feld.
COMMENT ON COLUMN set_acquisitions.currency     IS 'Währung, in der gekauft wurde (ISO 4217).';
COMMENT ON COLUMN part_acquisitions.currency    IS 'Währung, in der gekauft wurde (ISO 4217).';
COMMENT ON COLUMN minifig_acquisitions.currency IS 'Währung, in der gekauft wurde (ISO 4217).';
COMMENT ON COLUMN vouchers.currency             IS 'Währung des Guthabens (ISO 4217).';
COMMENT ON COLUMN price_cache.currency_code     IS 'Währung des Marktpreises, wie BrickLink sie nennt.';
COMMENT ON COLUMN wechselkurse.waehrung         IS 'Zielwährung des Kurses (ISO 4217).';

-- Kein Fremdschlüssel auf den Farbkatalog: KEINE_FARBE (9999) steht für
-- „ohne Farbe“ und hat dort keine Zeile.
COMMENT ON COLUMN part_acquisitions.color_id  IS 'Rebrickable-Farbe; 9999 = ohne Farbe, darum kein Fremdschlüssel.';
COMMENT ON COLUMN part_price_cache.color_id   IS 'Rebrickable-Farbe; 9999 = ohne Farbe, darum kein Fremdschlüssel.';
COMMENT ON COLUMN part_price_history.color_id IS 'Rebrickable-Farbe; 9999 = ohne Farbe, darum kein Fremdschlüssel.';
COMMENT ON COLUMN teil_farbe_eigen.color_id   IS 'Rebrickable-Farbe; 9999 = ohne Farbe, darum kein Fremdschlüssel.';
COMMENT ON COLUMN set_teile.color_id          IS 'Rebrickable-Farbe; 9999 = ohne Farbe, darum kein Fremdschlüssel.';
COMMENT ON COLUMN set_parts_catalog.color_id  IS 'Rebrickable-Farbe; 9999 = ohne Farbe, darum kein Fremdschlüssel.';
