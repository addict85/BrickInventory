-- Ersatzteil ist überall 0 oder 1. Der Rebrickable-Katalog führte es als Text
-- ('t', 'True', 'f' …), set_teile und parts_summary als Zahl; jeder Leser
-- musste die Schreibweisen kennen. Umgerechnet wird mit derselben Lesart wie
-- istErsatzteil() in utils/validate.ts.

ALTER TABLE rb_inventory_parts
  ALTER COLUMN is_spare TYPE integer
  USING CASE WHEN LOWER(TRIM(is_spare)) IN ('1', 't', 'true', 'y', 'yes') THEN 1 ELSE 0 END;

UPDATE set_teile     SET is_spare = 0 WHERE is_spare IS NULL OR is_spare NOT IN (0, 1);
UPDATE parts_summary SET is_spare = 0 WHERE is_spare IS NULL OR is_spare NOT IN (0, 1);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rb_inventory_parts', 'set_teile', 'parts_summary'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN is_spare SET DEFAULT 0, ALTER COLUMN is_spare SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (is_spare IN (0, 1))', t, t || '_ersatzteil_null_eins');
  END LOOP;
END $$;
