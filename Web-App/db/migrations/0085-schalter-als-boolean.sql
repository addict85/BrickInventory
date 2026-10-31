-- Ja/Nein-Spalten sind BOOLEAN. Sie trugen 0/1 als Zahl (mit CHECK) oder,
-- bei rb_colors.is_trans, die Schreibweisen der Rebrickable-CSV als Text; jeder
-- Leser musste die Lesart kennen. Umgerechnet wird mit derselben Lesart, die
-- die Spalten bisher hatten: 0 heisst nein, alles andere ja; NULL heisst die
-- Vorgabe der Spalte.

-- Die Sicht liest set_teile.is_spare; ihr Typ ändert sich mit.
DROP VIEW set_parts_catalog;

ALTER TABLE users
  DROP CONSTRAINT users_is_admin_schalter,
  DROP CONSTRAINT users_is_active_schalter,
  DROP CONSTRAINT users_email_verified_schalter,
  ALTER COLUMN is_admin DROP DEFAULT,
  ALTER COLUMN is_admin TYPE boolean USING is_admin <> 0,
  ALTER COLUMN is_admin SET DEFAULT false,
  ALTER COLUMN is_active DROP DEFAULT,
  ALTER COLUMN is_active TYPE boolean USING is_active <> 0,
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN email_verified DROP DEFAULT,
  ALTER COLUMN email_verified TYPE boolean USING email_verified <> 0,
  ALTER COLUMN email_verified SET DEFAULT false,
  ALTER COLUMN must_change_password DROP DEFAULT,
  ALTER COLUMN must_change_password TYPE boolean USING COALESCE(must_change_password, 0) <> 0,
  ALTER COLUMN must_change_password SET DEFAULT false,
  ALTER COLUMN must_change_password SET NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rb_inventory_parts', 'set_teile', 'parts_summary'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_ersatzteil_null_eins');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN is_spare DROP DEFAULT,
                      ALTER COLUMN is_spare TYPE boolean USING is_spare <> 0,
                      ALTER COLUMN is_spare SET DEFAULT false', t);
  END LOOP;
END $$;

ALTER TABLE catalog_cache
  ALTER COLUMN is_gear DROP DEFAULT,
  ALTER COLUMN is_gear TYPE boolean USING COALESCE(is_gear, 0) <> 0,
  ALTER COLUMN is_gear SET DEFAULT false,
  ALTER COLUMN is_gear SET NOT NULL;

ALTER TABLE rb_colors
  ALTER COLUMN is_trans TYPE boolean
    USING COALESCE(LOWER(TRIM(is_trans)) IN ('1', 't', 'true', 'y', 'yes'), false),
  ALTER COLUMN is_trans SET DEFAULT false,
  ALTER COLUMN is_trans SET NOT NULL;

-- Wie vorher: nur geprüfte Werte aus den Katalogen (Migration 0062).
CREATE VIEW set_parts_catalog AS
SELECT t.set_number, t.part_number,
       CASE WHEN pc.name_von IS NULL THEN pc.part_name END             AS part_name,
       t.color_id,
       CASE WHEN pcc.farbname_von IS NULL THEN pcc.color_name END      AS color_name,
       CASE WHEN pcc.farbcode_von IS NULL THEN pcc.color_hex END       AS color_hex,
       CASE WHEN pc.kategorie_von IS NULL THEN pc.category_name END    AS category_name,
       CASE WHEN pcc.bild_von IS NULL THEN pcc.image_url END           AS image_url,
       pcc.image_local,
       t.is_spare, t.quantity, t.updated_at
  FROM set_teile t
  LEFT JOIN part_catalog pc ON pc.part_number = t.part_number
  LEFT JOIN part_color_catalog pcc ON pcc.part_number = t.part_number AND pcc.color_id = t.color_id;
