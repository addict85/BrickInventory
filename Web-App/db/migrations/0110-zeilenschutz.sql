-- Zeilenschutz: Vergisst eine Abfrage den Filter auf user_id, liefert und
-- ändert die Datenbank trotzdem nur Zeilen des Kontos, für das die Anfrage
-- läuft, und seiner direkten Unterkonten (wie darfSchreibenFuer in
-- src/haushalt). Die Datenbankschicht setzt app.konto bzw. app.system je
-- Transaktion; ohne beides sieht die Laufzeitrolle hier keine Zeile.
-- Die Eigentümerin (Migrationsrolle) bleibt aussen vor: kein FORCE.

CREATE FUNCTION zeilenschutz_system() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
  AS $$ SELECT COALESCE(current_setting('app.system', true), '') = 'an' $$;

CREATE FUNCTION zeilenschutz_konten() RETURNS integer[]
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE WHEN k.id IS NULL THEN '{}'::integer[]
              ELSE k.id || ARRAY(SELECT l.sub_user_id FROM public.account_links l WHERE l.main_user_id = k.id) END
    FROM (SELECT NULLIF(current_setting('app.konto', true), '')::integer AS id) k
$$;

-- Die Unterabfragen werden je Anweisung einmal ausgewertet, nicht je Zeile,
-- und lassen den Index auf user_id nutzbar.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sets', 'set_acquisitions', 'parts', 'part_acquisitions', 'minifigs',
                           'minifig_acquisitions', 'wanted', 'price_alerts', 'storage_locations', 'instructions',
                           'papierkorb', 'vouchers', 'user_settings', 'parts_summary', 'parts_summary_state',
                           'parts_version_user', 'import_stand', 'bl_zuordnung_eigen', 'figur_eigen', 'teil_eigen',
                           'teil_farbe_eigen', 'idempotenz'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY zeilenschutz ON %I
                      USING ((SELECT zeilenschutz_system()) OR user_id = ANY ((SELECT zeilenschutz_konten())::integer[]))
                      WITH CHECK ((SELECT zeilenschutz_system()) OR user_id = ANY ((SELECT zeilenschutz_konten())::integer[]))', t);
  END LOOP;
END $$;
