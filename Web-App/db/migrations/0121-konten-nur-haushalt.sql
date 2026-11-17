-- Eingeschleustes SQL der Laufzeitrolle las bisher Namen, Rollen und Adressen aller Konten und den
-- Haushaltsgraphen aller Konten. Jetzt sieht sie in users nur das eigene Konto, die direkt
-- verknüpften und die getrennten, die die Haushaltsansicht nennt; in account_links nur
-- Verknüpfungen, an denen das eigene Konto beteiligt ist. Adresse und Links liest nur die Systemrolle.
-- Wiederholbar; postgres/app-rolle.sh setzt die Spaltenrechte bei jedem Lauf ebenso.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zeilenschutz ON users;
CREATE POLICY zeilenschutz ON users FOR SELECT USING (
  id = (SELECT zeilenschutz_konto())
  OR EXISTS (SELECT 1 FROM account_links l
              WHERE (l.main_user_id = (SELECT zeilenschutz_konto()) AND l.sub_user_id = users.id)
                 OR (l.sub_user_id = (SELECT zeilenschutz_konto()) AND l.main_user_id = users.id))
  OR EXISTS (SELECT 1 FROM household_former_links f
              WHERE f.main_user_id = (SELECT zeilenschutz_konto()) AND users.id IN (f.sub_user_id, f.via_user_id)));
-- Vor- und Nachname (0117) nur am eigenen Konto.
DROP POLICY IF EXISTS namen_aendern ON users;
CREATE POLICY namen_aendern ON users FOR UPDATE
  USING (id = (SELECT zeilenschutz_konto())) WITH CHECK (id = (SELECT zeilenschutz_konto()));

DROP POLICY IF EXISTS lesen ON account_links;
CREATE POLICY lesen ON account_links FOR SELECT
  USING ((SELECT zeilenschutz_konto()) IN (main_user_id, sub_user_id));

DO $$
DECLARE
  r record;
  eigen oid := (SELECT relowner FROM pg_class WHERE oid = 'public.users'::regclass);
BEGIN
  FOR r IN SELECT rolname FROM pg_roles
            WHERE NOT rolsuper AND NOT rolbypassrls AND oid <> eigen AND rolname !~ '^pg_'
              AND has_any_column_privilege(oid, 'public.users', 'SELECT') LOOP
    EXECUTE format('REVOKE SELECT (password_hash, email, verification_token, token_expires, reset_token,
                    reset_token_expires, email_neu, email_neu_token, email_neu_bis) ON public.users FROM %I', r.rolname);
  END LOOP;
END $$;
