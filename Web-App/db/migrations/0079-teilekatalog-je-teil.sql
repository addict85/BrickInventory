-- Eine Katalogänderung entwertet nur noch die Teile, die sie betrifft. Bisher
-- erhöhte jede Änderung an part_catalog, part_color_catalog, set_teile oder
-- bl_zuordnung einen gemeinsamen Zähler, und die Teile-Zusammenfassung ALLER
-- Konten wurde gelöscht und neu geschrieben. Jetzt merken die Trigger die
-- betroffenen Nummern (Rebrickable- und BrickLink-Nummer); utils/partsSummary.ts
-- zieht genau diese Gruppen in den Konten nach, die sie führen.
CREATE TABLE parts_katalog_offen (
  id      BIGSERIAL PRIMARY KEY,
  nummer  TEXT NOT NULL
);

-- Drei Funktionen, weil INSERT nur NEW TABLE und DELETE nur OLD TABLE kennt.
CREATE FUNCTION merke_teilekatalog_neu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bl_zuordnung' THEN
    INSERT INTO parts_katalog_offen (nummer)
    SELECT DISTINCT x FROM neu, LATERAL (VALUES (neu.rb_id), (neu.bl_id)) v(x)
     WHERE neu.art = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_katalog_offen (nummer) SELECT DISTINCT part_number FROM neu;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION merke_teilekatalog_alt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bl_zuordnung' THEN
    INSERT INTO parts_katalog_offen (nummer)
    SELECT DISTINCT x FROM alt, LATERAL (VALUES (alt.rb_id), (alt.bl_id)) v(x)
     WHERE alt.art = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_katalog_offen (nummer) SELECT DISTINCT part_number FROM alt;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION merke_teilekatalog_beide() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bl_zuordnung' THEN
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

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['part_catalog', 'part_color_catalog', 'set_teile', 'bl_zuordnung'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_parts_katalog ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON %I
                    REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu()', t);
    EXECUTE format('CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON %I
                    REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt()', t);
    EXECUTE format('CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON %I
                    REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide()', t);
  END LOOP;
END $$;

DROP FUNCTION bump_parts_katalog();
DROP TABLE parts_katalog_stand;
ALTER TABLE parts_summary_state DROP COLUMN katalog_stand;
