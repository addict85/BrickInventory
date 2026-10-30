-- Eine Set-Nummer trägt immer ihre Version („10179-1“), wie bei Rebrickable.
-- Bisher galt das nur beim Erfassen; Leser fragten deshalb beide
-- Schreibweisen ab (OR). Ab hier normalisiert die Datenbank beim Schreiben,
-- und eine CHECK-Regel hält es fest. Zwischenspeicher, die unter der
-- Schreibweise des Aufrufers ablegen (price_cache, subsets_cache …), bleiben aussen vor.

CREATE OR REPLACE FUNCTION set_nummer_mit_version(n text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN n IS NULL OR n ~ '-[0-9]+$' THEN n ELSE n || '-1' END $$;

CREATE OR REPLACE FUNCTION setnummer_normalisieren() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.set_number := set_nummer_mit_version(NEW.set_number);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION setnum_normalisieren() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.set_num := set_nummer_mit_version(NEW.set_num);
  RETURN NEW;
END $$;

-- Schreibt eine Spalte auf die Form mit Version um. Gibt es die Zeile unter
-- der neuen Nummer schon (gleicher Schlüssel), entfällt die alte; was dabei
-- zusammengeführt werden muss, erledigen die Schritte davor.
CREATE FUNCTION pg_temp.mit_version(tabelle text, spalte text, schluessel text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE gleich text := ''; k text;
BEGIN
  IF schluessel IS NOT NULL THEN
    FOREACH k IN ARRAY schluessel LOOP
      gleich := gleich || format(' AND b.%1$I IS NOT DISTINCT FROM a.%1$I', k);
    END LOOP;
    EXECUTE format('DELETE FROM %1$I a WHERE a.%2$I !~ ''-[0-9]+$'' AND EXISTS '
                   '(SELECT 1 FROM %1$I b WHERE b.%2$I = a.%2$I || ''-1''%3$s)', tabelle, spalte, gleich);
  END IF;
  EXECUTE format('UPDATE %1$I SET %2$I = %2$I || ''-1'' WHERE %2$I !~ ''-[0-9]+$''', tabelle, spalte);
END $$;

-- Kinder und sets werden nacheinander umgeschrieben; dazwischen zeigen die
-- Fremdschlüssel kurz ins Leere. Geprüft wird am Ende (unten).
SET CONSTRAINTS set_acquisitions_bestand_fkey, parts_set_fk, minifigs_set_fk, instructions_set_fk DEFERRED;

-- Sets: Gibt es dasselbe Set eines Kontos in beiden Schreibweisen, bleibt die
-- Zeile mit Version; Lagerort und Aufnahmedatum der anderen fliessen ein.
UPDATE sets n SET storage_id = COALESCE(n.storage_id, a.storage_id),
                  added_at   = LEAST(n.added_at, a.added_at)
  FROM sets a
 WHERE a.set_number !~ '-[0-9]+$' AND n.user_id = a.user_id AND n.set_number = a.set_number || '-1';

-- Kaufpreise: gleicher Tag, Zustand, Preis und Währung werden addiert.
UPDATE set_acquisitions z SET quantity = z.quantity + q.quantity
  FROM set_acquisitions q
 WHERE q.set_number !~ '-[0-9]+$' AND z.user_id = q.user_id AND z.set_number = q.set_number || '-1'
   AND COALESCE(z.tag, (z.created_at AT TIME ZONE 'UTC')::date) = COALESCE(q.tag, (q.created_at AT TIME ZONE 'UTC')::date)
   AND z.condition = q.condition AND COALESCE(z.purchase_price, -1) = COALESCE(q.purchase_price, -1)
   AND z.price_estimated = q.price_estimated AND z.currency = q.currency;
DELETE FROM set_acquisitions q
 WHERE q.set_number !~ '-[0-9]+$'
   AND EXISTS (SELECT 1 FROM set_acquisitions z
                WHERE z.user_id = q.user_id AND z.set_number = q.set_number || '-1'
                  AND COALESCE(z.tag, (z.created_at AT TIME ZONE 'UTC')::date) = COALESCE(q.tag, (q.created_at AT TIME ZONE 'UTC')::date)
                  AND z.condition = q.condition AND COALESCE(z.purchase_price, -1) = COALESCE(q.purchase_price, -1)
                  AND z.price_estimated = q.price_estimated AND z.currency = q.currency);

-- Teile und Figuren eines Sets: der Lagerort der wegfallenden Zeile bleibt.
UPDATE parts n SET storage_id = a.storage_id
  FROM parts a
 WHERE a.set_number !~ '-[0-9]+$' AND n.user_id = a.user_id AND n.set_number = a.set_number || '-1'
   AND n.part_number = a.part_number AND n.color_id = a.color_id AND n.storage_id IS NULL;
UPDATE minifigs n SET storage_id = a.storage_id
  FROM minifigs a
 WHERE a.set_number !~ '-[0-9]+$' AND n.user_id = a.user_id AND n.set_number = a.set_number || '-1'
   AND n.fig_number = a.fig_number AND n.storage_id IS NULL;

-- Katalog: Lücken der Zeile mit Version aus der anderen füllen.
UPDATE set_catalog n SET name = COALESCE(n.name, a.name), year = COALESCE(n.year, a.year),
       theme = COALESCE(n.theme, a.theme), pieces = COALESCE(n.pieces, a.pieces),
       minifigs = COALESCE(n.minifigs, a.minifigs), image_url = COALESCE(n.image_url, a.image_url),
       image_local = COALESCE(n.image_local, a.image_local), brickset_id = COALESCE(n.brickset_id, a.brickset_id)
  FROM set_catalog a
 WHERE a.set_number !~ '-[0-9]+$' AND n.set_number = a.set_number || '-1';

-- Die abhängigen Zeilen vor sets: Das Löschen einer Set-Zeile nähme ihre
-- Teile, Figuren und Anleitungen sonst per ON DELETE CASCADE mit.
SELECT pg_temp.mit_version('set_acquisitions', 'set_number', NULL);
SELECT pg_temp.mit_version('parts',            'set_number', ARRAY['user_id', 'part_number', 'color_id']);
SELECT pg_temp.mit_version('minifigs',         'set_number', ARRAY['user_id', 'fig_number']);
SELECT pg_temp.mit_version('instructions',     'set_number', ARRAY['user_id', 'url']);
SELECT pg_temp.mit_version('sets',             'set_number', ARRAY['user_id']);
SELECT pg_temp.mit_version('set_catalog',      'set_number', ARRAY[]::text[]);
SELECT pg_temp.mit_version('catalog_cache',    'set_number', ARRAY[]::text[]);
SELECT pg_temp.mit_version('set_teile',        'set_number', ARRAY['part_number', 'color_id']);
SELECT pg_temp.mit_version('set_figuren',      'set_number', ARRAY['fig_number']);
SELECT pg_temp.mit_version('wanted',           'set_number', ARRAY['user_id', 'condition']);
SELECT pg_temp.mit_version('price_alerts',     'set_number', ARRAY['user_id', 'condition']);
SELECT pg_temp.mit_version('rb_inventories',   'set_num',    NULL);

DROP FUNCTION pg_temp.mit_version(text, text, text[]);

-- Die Fremdschlüssel auf sets sind aufgeschoben; vor ALTER TABLE müssen ihre
-- Prüfungen gelaufen sein.
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE t text; s text;
BEGIN
  FOR t, s IN VALUES ('sets', 'set_number'), ('set_acquisitions', 'set_number'), ('parts', 'set_number'),
                     ('minifigs', 'set_number'), ('instructions', 'set_number'), ('set_catalog', 'set_number'),
                     ('catalog_cache', 'set_number'), ('set_teile', 'set_number'), ('set_figuren', 'set_number'),
                     ('wanted', 'set_number'), ('price_alerts', 'set_number'), ('rb_inventories', 'set_num')
  LOOP
    EXECUTE format('CREATE TRIGGER %1$I BEFORE INSERT OR UPDATE OF %2$I ON %3$I FOR EACH ROW EXECUTE FUNCTION %4$I()',
                   t || '_setnummer', s, t, CASE s WHEN 'set_num' THEN 'setnum_normalisieren' ELSE 'setnummer_normalisieren' END);
    -- NOT VALID und danach VALIDATE: Die Prüfung der alten Zeilen sperrt
    -- Schreiber nicht für die ganze Dauer.
    EXECUTE format('ALTER TABLE %1$I ADD CONSTRAINT %2$I CHECK (%3$I ~ ''-[0-9]+$'') NOT VALID',
                   t, t || '_setnummer_mit_version', s);
    EXECUTE format('ALTER TABLE %1$I VALIDATE CONSTRAINT %2$I', t, t || '_setnummer_mit_version');
  END LOOP;
END $$;
