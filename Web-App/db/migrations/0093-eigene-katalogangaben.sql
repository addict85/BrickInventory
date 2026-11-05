-- Was ein Konto selbst eintippt (Name, Kategorie, Farbname, Farbcode, Bild),
-- gehört dem Konto und seinem Haushalt, nicht dem gemeinsamen Katalog. Die
-- Kataloge führen nur noch geprüfte Werte; gelesen wird über db/katalogSicht.ts,
-- dort hat der geprüfte Wert Vorrang vor der eigenen Angabe.
CREATE TABLE teil_eigen (
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  part_number   text    NOT NULL,
  part_name     text,
  category_name text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, part_number)
);

CREATE TABLE teil_farbe_eigen (
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  part_number text    NOT NULL,
  color_id    integer NOT NULL,
  color_name  text,
  color_hex   text,
  image_url   text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, part_number, color_id)
);

CREATE TABLE figur_eigen (
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fig_number text    NOT NULL,
  fig_name   text,
  image_url  text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fig_number)
);

-- Die Teile-Zusammenfassung zeigt eigene Angaben; eine Änderung zieht sie nach
-- wie eine Katalogänderung (Migration 0079).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['teil_eigen', 'teil_farbe_eigen'] LOOP
    EXECUTE format('CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON %I
                    REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu()', t);
    EXECUTE format('CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON %I
                    REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt()', t);
    EXECUTE format('CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON %I
                    REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide()', t);
  END LOOP;
END $$;

-- Bisherige Eingaben ziehen zu ihrem Konto um; die eines gelöschten Kontos entfallen.
INSERT INTO teil_eigen (user_id, part_number, part_name, category_name)
SELECT u.id, pc.part_number,
       CASE WHEN pc.name_von      = u.id THEN pc.part_name END,
       CASE WHEN pc.kategorie_von = u.id THEN pc.category_name END
  FROM part_catalog pc
  JOIN users u ON u.id IN (pc.name_von, pc.kategorie_von);

INSERT INTO teil_farbe_eigen (user_id, part_number, color_id, color_name, color_hex, image_url)
SELECT u.id, c.part_number, c.color_id,
       CASE WHEN c.farbname_von = u.id THEN c.color_name END,
       CASE WHEN c.farbcode_von = u.id THEN c.color_hex END,
       CASE WHEN c.bild_von     = u.id THEN c.image_url END
  FROM part_color_catalog c
  JOIN users u ON u.id IN (c.farbname_von, c.farbcode_von, c.bild_von);

INSERT INTO figur_eigen (user_id, fig_number, fig_name, image_url)
SELECT u.id, mc.fig_number,
       CASE WHEN mc.name_von = u.id THEN mc.fig_name END,
       CASE WHEN mc.bild_von = u.id THEN mc.image_url END
  FROM minifigs_catalog mc
  JOIN users u ON u.id IN (mc.name_von, mc.bild_von);

DROP VIEW set_parts_catalog;
DROP VIEW set_minifigs_catalog;

UPDATE part_catalog SET
  part_name     = CASE WHEN name_von      IS NULL THEN part_name END,
  category_name = CASE WHEN kategorie_von IS NULL THEN category_name END
 WHERE name_von IS NOT NULL OR kategorie_von IS NOT NULL;
UPDATE part_color_catalog SET
  color_name = CASE WHEN farbname_von IS NULL THEN color_name END,
  color_hex  = CASE WHEN farbcode_von IS NULL THEN color_hex END,
  image_url  = CASE WHEN bild_von     IS NULL THEN image_url END
 WHERE farbname_von IS NOT NULL OR farbcode_von IS NOT NULL OR bild_von IS NOT NULL;
UPDATE minifigs_catalog SET
  fig_name  = CASE WHEN name_von IS NULL THEN fig_name END,
  image_url = CASE WHEN bild_von IS NULL THEN image_url END
 WHERE name_von IS NOT NULL OR bild_von IS NOT NULL;

ALTER TABLE part_catalog       DROP COLUMN name_von, DROP COLUMN kategorie_von;
ALTER TABLE part_color_catalog DROP COLUMN farbname_von, DROP COLUMN farbcode_von, DROP COLUMN bild_von;
ALTER TABLE minifigs_catalog   DROP COLUMN name_von, DROP COLUMN bild_von;

CREATE VIEW set_parts_catalog AS
SELECT t.set_number, t.part_number, pc.part_name, t.color_id,
       pcc.color_name, pcc.color_hex, pc.category_name, pcc.image_url, pcc.image_local,
       t.is_spare, t.quantity, t.updated_at
  FROM set_teile t
  LEFT JOIN part_catalog pc ON pc.part_number = t.part_number
  LEFT JOIN part_color_catalog pcc ON pcc.part_number = t.part_number AND pcc.color_id = t.color_id;

CREATE VIEW set_minifigs_catalog AS
SELECT f.set_number, f.fig_number, mc.fig_name, f.quantity, mc.image_url, mc.image_local, f.updated_at
  FROM set_figuren f
  LEFT JOIN minifigs_catalog mc ON mc.fig_number = f.fig_number;
