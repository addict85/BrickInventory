-- Was über den Zugang entscheidet, schreibt nur noch die Systemrolle: In users darf die
-- Laufzeitrolle allein Vor- und Nachname ändern; Passwort, Verwalterrecht, aktiv, Adresse,
-- Links und Sitzungsversion setzt sie nicht, auch nicht mit eingeschleustem SQL. Globale
-- Einstellungen (Mailserver, Registrierung) liest sie nur. Das Verwaltungsprotokoll ist für
-- beide Rollen nur anfügbar; aufgeräumt wird mit fester Frist über eine Funktion der
-- Eigentümerin. Rollen werden wie in 0115 über ihre Rechte gefunden; postgres/app-rolle.sh
-- setzt dasselbe bei jedem Lauf.

CREATE FUNCTION verwaltungsprotokoll_aufraeumen() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  alt integer;
  namen integer;
BEGIN
  DELETE FROM public.verwaltungsprotokoll WHERE zeit < now() - interval '365 days';
  GET DIAGNOSTICS alt = ROW_COUNT;
  UPDATE public.verwaltungsprotokoll p SET ziel_name = NULL
   WHERE ziel_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p.ziel_id);
  GET DIAGNOSTICS namen = ROW_COUNT;
  RETURN alt + namen;
END $$;
REVOKE ALL ON FUNCTION verwaltungsprotokoll_aufraeumen() FROM PUBLIC;

DO $$
DECLARE
  r record;
  eigen oid := (SELECT relowner FROM pg_class WHERE oid = 'public.users'::regclass);
BEGIN
  FOR r IN SELECT rolname, rolbypassrls FROM pg_roles
            WHERE NOT rolsuper AND oid <> eigen AND rolname !~ '^pg_'
              AND has_table_privilege(oid, 'public.verwaltungsprotokoll', 'INSERT') LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.verwaltungsprotokoll FROM %I', r.rolname);
    IF r.rolbypassrls THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.verwaltungsprotokoll_aufraeumen() TO %I', r.rolname);
    ELSE
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM %I', r.rolname);
      EXECUTE format('GRANT UPDATE (first_name, last_name) ON public.users TO %I', r.rolname);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.global_settings FROM %I', r.rolname);
    END IF;
  END LOOP;
END $$;
