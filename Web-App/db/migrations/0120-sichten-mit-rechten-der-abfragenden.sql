-- Eine Sicht liest sonst mit den Rechten ihrer Eigentümerin, also am Zeilenschutz und an den
-- Tabellenrechten der abfragenden Rolle vorbei. 0119 gab der Web-Systemrolle jede Sicht; eine
-- spätere über Gutscheine oder Sammlung hätte sie mitgenommen. Jetzt nur die genannten.
DO $$
DECLARE
  v record;
  r record;
  web text[] := ARRAY['set_minifigs_catalog', 'set_parts_catalog'];
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
  END LOOP;
  FOR r IN SELECT ro.rolname FROM pg_roles ro
            WHERE ro.rolbypassrls AND NOT ro.rolsuper
              AND shobj_description(ro.oid, 'pg_authid') = 'BrickInventory: Web-Systemrolle' LOOP
    FOR v IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM %I', v.relname, r.rolname);
      IF v.relname = ANY (web) THEN
        EXECUTE format('GRANT SELECT ON public.%I TO %I', v.relname, r.rolname);
      END IF;
    END LOOP;
  END LOOP;
END $$;
