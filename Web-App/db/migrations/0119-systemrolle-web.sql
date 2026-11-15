-- Die Web-Systemrolle (postgres/app-rolle.sh) hebt den Zeilenschutz auf wie die Systemrolle, darf
-- aber nur Zugangs- und Verwaltungstabellen, Kontoeinstellungen, die Auftragstabelle und Tabellen
-- ohne Kontobezug: Ein vergessener user_id-Filter in einem Systemrahmen einer Anfrage erreicht so
-- weder Gutscheine noch Sammlung oder Finanzen. Gefunden wird sie an ihrem Kommentar und an ihrem
-- CONNECT auf diese Datenbank; eine spätere Tabelle für den Web-Prozess vergibt ihre Rechte ebenso.

-- Ein gelöschtes Konto auch aus den Kopien vor Migrationen (wie bisher db/migrate.ts), ohne dass
-- der Web-Prozess die Kopien selbst lesen oder ändern darf.
CREATE OR REPLACE FUNCTION konto_aus_sicherungen_loeschen(uid integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  z record;
  n integer := 0;
  k integer;
BEGIN
  FOR z IN
    WITH fk AS (
      SELECT r.relname, a.attname FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = r.relnamespace AND ns.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass)
    SELECT ns.nspname AS schema, c.relname AS tabelle, a.attname AS spalte
      FROM pg_namespace ns
      JOIN pg_class c ON c.relnamespace = ns.oid AND c.relkind = 'r'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE ns.nspname ~ '^vor_migration_[0-9]+$'
       AND (a.attname ~ '(^|_)user_id$' OR (c.relname = 'users' AND a.attname = 'id')
            OR (c.relname, a.attname) IN (SELECT relname, attname FROM fk))
       AND format_type(a.atttypid, a.atttypmod) IN ('integer', 'bigint')
  LOOP
    EXECUTE format('DELETE FROM %I.%I WHERE %I = $1', z.schema, z.tabelle, z.spalte) USING uid;
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION konto_aus_sicherungen_loeschen(integer) FROM PUBLIC;

-- Die Bilddiagnose der Verwaltung zeigt nur, wie viele Konten ein Set führen, nicht welche.
CREATE OR REPLACE FUNCTION konten_mit_set(sn text) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT count(DISTINCT user_id)::integer FROM public.sets WHERE set_number = sn $$;
REVOKE ALL ON FUNCTION konten_mit_set(text) FROM PUBLIC;

DO $$
DECLARE
  r record;
  t record;
  s record;
  -- Mit Zeilenschutz, aber Sache der Anmeldung und Verwaltung: Zugang, Haushalt, Sprache und
  -- Währung des Kontos, Aufträge einstellen und abbrechen.
  konto text[] := ARRAY['account_link_invites', 'account_links', 'api_tokens', 'api_tokens_verbraucht',
    'auftraege', 'geraete_nonces', 'geraete_schluessel', 'household_former_links', 'passkeys',
    'qr_login_tokens', 'schritt_challenges', 'schritt_freigaben', 'user_settings',
    'verwalter_uebernahmen', 'webauthn_challenges', 'zweiter_faktor', 'zweiter_faktor_codes'];
  -- Ohne Zeilenschutz, aber nicht Sache des Web-Prozesses.
  ausser text[] := ARRAY['gutschein_guthaben_schranke', 'schema_migrations'];
BEGIN
  FOR r IN SELECT ro.rolname FROM pg_roles ro
            WHERE ro.rolbypassrls AND NOT ro.rolsuper
              AND shobj_description(ro.oid, 'pg_authid') = 'BrickInventory: Web-Systemrolle'
              AND EXISTS (SELECT 1 FROM pg_database d, aclexplode(d.datacl) a
                           WHERE d.datname = current_database() AND a.grantee = ro.oid
                             AND a.privilege_type = 'CONNECT') LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r.rolname);
    FOR t IN SELECT c.oid, c.relname FROM pg_class c
              WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                AND (c.relname = ANY (konto) OR (NOT c.relrowsecurity AND c.relname <> ALL (ausser))) LOOP
      EXECUTE format('GRANT %s ON public.%I TO %I',
                     CASE t.relname WHEN 'verwaltungsprotokoll' THEN 'SELECT, INSERT'
                                    ELSE 'SELECT, INSERT, UPDATE, DELETE' END, t.relname, r.rolname);
      FOR s IN SELECT d.objid::regclass AS name FROM pg_depend d JOIN pg_class q ON q.oid = d.objid
                WHERE d.classid = 'pg_class'::regclass AND d.refobjid = t.oid
                  AND d.deptype IN ('a', 'i') AND q.relkind = 'S' LOOP
        EXECUTE format('GRANT USAGE ON SEQUENCE %s TO %I', s.name, r.rolname);
      END LOOP;
    END LOOP;
    -- Der Stand je Konto ohne Inhalt: Ihn zählen Trigger hoch, auch wenn ein gelöschtes Konto
    -- seine Bestände mitnimmt. Die Nummern des Bestands ohne Konto zählt die Übersicht der Bilder.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.parts_version_user TO %I', r.rolname);
    EXECUTE format('GRANT SELECT (part_number, source) ON public.parts TO %I', r.rolname);
    EXECUTE format('GRANT SELECT (fig_number) ON public.minifigs TO %I', r.rolname);
    EXECUTE format('GRANT SELECT (set_number) ON public.sets TO %I', r.rolname);
    FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' LOOP
      EXECUTE format('GRANT SELECT ON public.%I TO %I', t.relname, r.rolname);
    END LOOP;
  END LOOP;
  FOR r IN SELECT rolname FROM pg_roles
            WHERE rolbypassrls AND NOT rolsuper AND has_table_privilege(oid, 'public.users', 'DELETE') LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.konto_aus_sicherungen_loeschen(integer) TO %I', r.rolname);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.konten_mit_set(text) TO %I', r.rolname);
  END LOOP;
END $$;

INSERT INTO auftrags_arten (art) VALUES ('katalog_nachzug') ON CONFLICT DO NOTHING;
