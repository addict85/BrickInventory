#!/bin/sh
# Die App verbindet sich mit einer eigenen Rolle ohne Superuser-Rechte, die
# Datenbank, Tabellen und Funktionen besitzt (Migrationen brauchen das). Ein
# Einbruch in die App erreicht so weder COPY … PROGRAM noch andere Datenbanken.
# Läuft mit dem Superuser bei jedem `docker compose up` (Dienst db-rolle) und
# beim Anlegen einer neuen Datenbank (docker-entrypoint-initdb.d); wiederholbar.
set -eu
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD in .env setzen - siehe UPGRADE.md}"
if [ "$DB_APP_PASSWORD" = "${PGPASSWORD:-${POSTGRES_PASSWORD:-}}" ]; then
  echo "[db-rolle] DB_APP_PASSWORD muss sich von DB_PASSWORD unterscheiden." >&2
  exit 1
fi
export DB_APP_USER="${DB_APP_USER:-brickinventory_app}"

psql -v ON_ERROR_STOP=1 -q -X \
  --username "${PGUSER:-${POSTGRES_USER:-brickinventory}}" \
  --dbname "${PGDATABASE:-${POSTGRES_DB:-brickinventory}}" <<'SQL'
\getenv app_rolle DB_APP_USER
\getenv app_passwort DB_APP_PASSWORD
SELECT set_config('brickinventory.app_rolle', :'app_rolle', false) AS r,
       set_config('brickinventory.app_passwort', :'app_passwort', false) AS p \gset
DO $$
DECLARE
  rolle text := current_setting('brickinventory.app_rolle');
  ziel  oid;
  r     record;
BEGIN
  IF rolle = current_user THEN RAISE EXCEPTION 'Die App-Rolle darf nicht der Superuser % sein', rolle; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = rolle) THEN
    EXECUTE format('CREATE ROLE %I LOGIN', rolle);
    RAISE NOTICE '[db-rolle] Rolle % angelegt', rolle;
  END IF;
  EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS',
                 rolle, current_setting('brickinventory.app_passwort'));
  SELECT oid INTO ziel FROM pg_roles WHERE rolname = rolle;
  FOR r IN SELECT g.rolname FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = ziel LOOP
    EXECUTE format('REVOKE %I FROM %I', r.rolname, rolle);
  END LOOP;
  EXECUTE format('ALTER DATABASE %I OWNER TO %I', current_database(), rolle);
  IF (SELECT nspowner FROM pg_namespace WHERE nspname = 'public') NOT IN (ziel, 'pg_database_owner'::regrole) THEN
    EXECUTE format('ALTER SCHEMA public OWNER TO %I', rolle);
  END IF;

  -- Was eine Erweiterung mitbringt (pg_trgm), bleibt bei ihr; Sequenzen einer
  -- Spalte gehen mit ihrer Tabelle.
  FOR r IN SELECT c.oid::regclass AS name, c.relkind FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relowner <> ziel
              AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                                AND d.objid = c.oid AND d.deptype IN ('e', 'a', 'i')) LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                   WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.name, rolle);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS name, p.prokind FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proowner <> ziel
              AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                                AND d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE'
                   ELSE 'FUNCTION' END, r.name, rolle);
  END LOOP;
  FOR r IN SELECT t.oid::regtype AS name, t.typtype FROM pg_type t
            WHERE t.typnamespace = 'public'::regnamespace AND t.typowner <> ziel
              AND (t.typtype IN ('e', 'd', 'r')
                   OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c'))
              AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_type'::regclass
                                AND d.objid = t.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.name, rolle);
  END LOOP;
END $$;
SQL
echo "[db-rolle] Rolle ${DB_APP_USER} ohne Superuser-Rechte besitzt die Datenbank."
