-- Kontotabellen ohne user_id: Die Laufzeitrolle (ohne BYPASSRLS) liest weder Passwort-Hashes
-- noch Sitzungen; Anmeldung und Sitzungsspeicher laufen über die Systemrolle. Rollen werden
-- über ihre Rechte gefunden, weil der Name der Laufzeitrolle hier nicht feststeht;
-- postgres/app-rolle.sh setzt dasselbe bei jedem Lauf.
DO $$
DECLARE
  r record;
  spalten text;
  eigen oid := (SELECT relowner FROM pg_class WHERE oid = 'public.users'::regclass);
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO spalten
    FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'password_hash';
  FOR r IN SELECT rolname FROM pg_roles
            WHERE NOT rolsuper AND NOT rolbypassrls AND oid <> eigen
              AND (has_table_privilege(oid, 'public.users', 'SELECT')
                   OR has_table_privilege(oid, 'public.user_sessions', 'SELECT, INSERT, UPDATE, DELETE')) LOOP
    EXECUTE format('REVOKE SELECT ON public.users FROM %I', r.rolname);
    EXECUTE format('GRANT SELECT (%s) ON public.users TO %I', spalten, r.rolname);
    EXECUTE format('REVOKE ALL ON public.user_sessions FROM %I', r.rolname);
  END LOOP;
END $$;

-- Haushalt: Wer mit wem verknüpft ist, steuert den Zeilenschutz (zeilenschutz_konten()).
-- Lesen darf jedes Konto (nur IDs, der Haushalt liest über Konten hinweg); verknüpfen nur
-- der Systemrahmen, lösen nur ein beteiligtes Konto. Einladungen sieht nur ihr Konto.
ALTER TABLE account_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesen ON account_links FOR SELECT USING (true);
CREATE POLICY loesen ON account_links FOR DELETE
  USING ((SELECT zeilenschutz_konto()) IN (main_user_id, sub_user_id));

ALTER TABLE household_former_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON household_former_links FOR SELECT
  USING ((SELECT zeilenschutz_konto()) IN (main_user_id, sub_user_id));
CREATE POLICY loesen ON household_former_links FOR DELETE
  USING ((SELECT zeilenschutz_konto()) IN (main_user_id, sub_user_id));

ALTER TABLE account_link_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON account_link_invites
  USING (main_user_id = (SELECT zeilenschutz_konto()))
  WITH CHECK (main_user_id = (SELECT zeilenschutz_konto()));

-- Kopien vor Migrationen tragen Zugangsdaten aller Konten ohne Policy: nur noch für die
-- Systemrolle und die Eigentümerin (RLS ohne Policy verbirgt jede Zeile).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname ~ '^vor_migration_[0-9]+$' AND c.relkind = 'r' AND pg_has_role(c.relowner, 'USAGE') LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.name);
  END LOOP;
END $$;
