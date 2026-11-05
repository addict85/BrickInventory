-- Von Hand eingetragene BrickLink-Nummern (Korrektur beim Wanted-Import,
-- BrickLink-Nr. einer eigenen Figur) gehören dem Konto, nicht der gemeinsamen
-- Zuordnung: Dort steuern sie Preise und Bilder aller Konten. bl_id ist hier
-- nie NULL; „gleich der Rebrickable-Nummer" steht als die Nummer selbst.
CREATE TABLE bl_zuordnung_eigen (
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  art        text    NOT NULL,
  rb_id      text    NOT NULL,
  bl_id      text    NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, art, rb_id),
  CONSTRAINT bl_zuordnung_eigen_art CHECK (art IN ('part', 'fig', 'set'))
);
CREATE INDEX idx_bl_zuordnung_eigen_bl ON bl_zuordnung_eigen (user_id, art, bl_id);

-- Die Teile-Zusammenfassung gruppiert nach der BrickLink-Nummer; eine eigene
-- Zuordnung verschiebt Gruppen wie eine gemeinsame (Migration 0079).
CREATE OR REPLACE FUNCTION merke_teilekatalog_neu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('bl_zuordnung', 'bl_zuordnung_eigen') THEN
    INSERT INTO parts_katalog_offen (nummer)
    SELECT DISTINCT x FROM neu, LATERAL (VALUES (neu.rb_id), (neu.bl_id)) v(x)
     WHERE neu.art = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_katalog_offen (nummer) SELECT DISTINCT part_number FROM neu;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION merke_teilekatalog_alt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('bl_zuordnung', 'bl_zuordnung_eigen') THEN
    INSERT INTO parts_katalog_offen (nummer)
    SELECT DISTINCT x FROM alt, LATERAL (VALUES (alt.rb_id), (alt.bl_id)) v(x)
     WHERE alt.art = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_katalog_offen (nummer) SELECT DISTINCT part_number FROM alt;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION merke_teilekatalog_beide() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('bl_zuordnung', 'bl_zuordnung_eigen') THEN
    INSERT INTO parts_katalog_offen (nummer)
    SELECT DISTINCT x FROM (SELECT art, rb_id, bl_id FROM alt UNION ALL SELECT art, rb_id, bl_id FROM neu) z,
           LATERAL (VALUES (z.rb_id), (z.bl_id)) v(x)
     WHERE z.art = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_katalog_offen (nummer)
    SELECT DISTINCT part_number FROM (SELECT part_number FROM alt UNION ALL SELECT part_number FROM neu) z;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON bl_zuordnung_eigen
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON bl_zuordnung_eigen
  REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON bl_zuordnung_eigen
  REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();
