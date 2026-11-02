#!/bin/sh
# Die App verbindet sich mit einer eigenen Rolle ohne Superuser-Rechte, die
# Datenbank, Tabellen und Funktionen besitzt (Migrationen brauchen das). Ein
# Einbruch in die App erreicht so weder COPY … PROGRAM noch andere Datenbanken.
# Läuft mit dem Superuser bei jedem `docker compose up` (Dienst db-rolle) und
# beim Anlegen einer neuen Datenbank (docker-entrypoint-initdb.d); wiederholbar.
#
# Die Datenbank gehört der App-Rolle: Sie kann Schemas, Funktionen und
# Datenbank-Einstellungen anlegen. Nichts davon darf in dieser Superuser-Sitzung
# wirken – daher fester search_path schon beim Verbinden, RESET ALL vor allem
# anderen und nur Funktionen aus pg_catalog.
set -eu
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD in .env setzen - siehe UPGRADE.md}"
SU_PASSWORT="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
if [ "$DB_APP_PASSWORD" = "$SU_PASSWORT" ]; then
  echo "[db-rolle] DB_APP_PASSWORD muss sich von DB_PASSWORD unterscheiden." >&2
  exit 1
fi
export PGWEB_DB_PASSWORD="${PGWEB_DB_PASSWORD:-}"
if [ -n "$PGWEB_DB_PASSWORD" ] && { [ "$PGWEB_DB_PASSWORD" = "$SU_PASSWORT" ] || [ "$PGWEB_DB_PASSWORD" = "$DB_APP_PASSWORD" ]; }; then
  echo "[db-rolle] PGWEB_DB_PASSWORD muss sich von DB_PASSWORD und DB_APP_PASSWORD unterscheiden." >&2
  exit 1
fi
export DB_APP_USER="${DB_APP_USER:-brickinventory_app}"
export DB_LESEN_USER="${DB_LESEN_USER:-brickinventory_lesen}"

# Kommandozeilen-Optionen schlagen ALTER DATABASE … SET; role=none hebt ein
# untergeschobenes `SET role` auf, das die Sitzung zur App-Rolle machte.
PGOPTIONS='-c search_path=pg_catalog,pg_temp -c role=none -c default_transaction_read_only=off' \
psql -v ON_ERROR_STOP=1 -q -X \
  --username "${PGUSER:-${POSTGRES_USER:-brickinventory}}" \
  --dbname "${PGDATABASE:-${POSTGRES_DB:-brickinventory}}" <<'SQL'
SET search_path = pg_catalog, pg_temp;
SET ROLE NONE;
\getenv app_rolle DB_APP_USER
\getenv app_passwort DB_APP_PASSWORD
\getenv lesen_rolle DB_LESEN_USER
\getenv lesen_passwort PGWEB_DB_PASSWORD
SELECT pg_catalog.set_config('brickinventory.app_rolle', :'app_rolle', false) AS r,
       pg_catalog.set_config('brickinventory.app_passwort', :'app_passwort', false) AS p,
       pg_catalog.set_config('brickinventory.lesen_rolle', :'lesen_rolle', false) AS lr,
       pg_catalog.set_config('brickinventory.lesen_passwort', :'lesen_passwort', false) AS lp \gset
DO $$
DECLARE
  rolle text := pg_catalog.current_setting('brickinventory.app_rolle');
  lesen text := pg_catalog.current_setting('brickinventory.lesen_rolle');
  lesen_pw text := pg_catalog.current_setting('brickinventory.lesen_passwort');
  db    text := pg_catalog.current_database();
  ziel  oid;
  r     record;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'db-rolle muss als Superuser laufen, nicht als %', current_user;
  END IF;
  IF rolle = current_user OR lesen = current_user OR rolle = lesen THEN
    RAISE EXCEPTION 'App-Rolle %, Leserolle % und Superuser % müssen verschieden sein', rolle, lesen, current_user;
  END IF;
  -- Event-Trigger feuern bei jedem ALTER … OWNER unten mit Superuser-Rechten.
  IF EXISTS (SELECT FROM pg_catalog.pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'Aktive Event-Trigger in %: erst prüfen und deaktivieren', db;
  END IF;
  EXECUTE pg_catalog.format('ALTER DATABASE %I RESET ALL', db);

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = rolle) THEN
    EXECUTE pg_catalog.format('CREATE ROLE %I LOGIN', rolle);
    RAISE NOTICE '[db-rolle] Rolle % angelegt', rolle;
  END IF;
  EXECUTE pg_catalog.format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS',
                 rolle, pg_catalog.current_setting('brickinventory.app_passwort'));
  EXECUTE pg_catalog.format('ALTER ROLE %I RESET ALL', rolle);
  EXECUTE pg_catalog.format('ALTER ROLE %I IN DATABASE %I RESET ALL', rolle, db);
  SELECT oid INTO ziel FROM pg_catalog.pg_roles WHERE rolname = rolle;
  FOR r IN SELECT g.rolname FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid = m.roleid WHERE m.member = ziel LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', r.rolname, rolle);
  END LOOP;
  EXECUTE pg_catalog.format('ALTER DATABASE %I OWNER TO %I', db, rolle);
  IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public') NOT IN (ziel, 'pg_database_owner'::pg_catalog.regrole) THEN
    EXECUTE pg_catalog.format('ALTER SCHEMA public OWNER TO %I', rolle);
  END IF;

  -- Was eine Erweiterung mitbringt (pg_trgm), bleibt bei ihr; Sequenzen einer
  -- Spalte gehen mit ihrer Tabelle.
  FOR r IN SELECT c.oid::pg_catalog.regclass AS name, c.relkind FROM pg_catalog.pg_class c
            WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relowner <> ziel
              AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                                AND d.objid = c.oid AND d.deptype IN ('e', 'a', 'i')) LOOP
    EXECUTE pg_catalog.format('ALTER %s %s OWNER TO %I', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                   WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.name, rolle);
  END LOOP;
  FOR r IN SELECT p.oid::pg_catalog.regprocedure AS name, p.prokind FROM pg_catalog.pg_proc p
            WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proowner <> ziel
              AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                                AND d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE pg_catalog.format('ALTER %s %s OWNER TO %I', CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE'
                   ELSE 'FUNCTION' END, r.name, rolle);
  END LOOP;
  FOR r IN SELECT t.oid::pg_catalog.regtype AS name, t.typtype FROM pg_catalog.pg_type t
            WHERE t.typnamespace = 'public'::pg_catalog.regnamespace AND t.typowner <> ziel
              AND (t.typtype IN ('e', 'd', 'r')
                   OR (t.typtype = 'c' AND (SELECT relkind FROM pg_catalog.pg_class WHERE oid = t.typrelid) = 'c'))
              AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                                AND d.objid = t.oid AND d.deptype = 'e') LOOP
    EXECUTE pg_catalog.format('ALTER %s %s OWNER TO %I', CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.name, rolle);
  END LOOP;

  -- Leserolle für pgweb: nur SELECT, ohne Anmeldedaten, Sitzungen und
  -- Geheimnisse. Neue Tabellen sieht sie erst nach dem nächsten Lauf.
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = lesen) THEN
    EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN', lesen);
  END IF;
  EXECUTE pg_catalog.format('ALTER ROLE %I %s NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT',
                 lesen, CASE WHEN lesen_pw = '' THEN 'NOLOGIN PASSWORD NULL' ELSE pg_catalog.format('LOGIN PASSWORD %L', lesen_pw) END);
  EXECUTE pg_catalog.format('ALTER ROLE %I RESET ALL', lesen);
  EXECUTE pg_catalog.format('ALTER ROLE %I SET default_transaction_read_only = on', lesen);
  FOR r IN SELECT g.rolname FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
            WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = lesen) LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', r.rolname, lesen);
  END LOOP;
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO %I', db, lesen);
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', lesen);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', lesen);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', lesen);
  FOR r IN SELECT c.oid::pg_catalog.regclass AS name, c.relname,
                  pg_catalog.array_agg(pg_catalog.quote_ident(a.attname::text) ORDER BY a.attnum) FILTER (WHERE NOT a.attname::text = ANY (CASE c.relname
                    WHEN 'users' THEN ARRAY['password_hash', 'verification_token', 'reset_token']
                    WHEN 'zweiter_faktor' THEN ARRAY['geheimnis']
                    WHEN 'user_settings' THEN ARRAY['value']
                    WHEN 'global_settings' THEN ARRAY['value']
                    WHEN 'vouchers' THEN ARRAY['pin']
                    WHEN 'idempotenz' THEN ARRAY['antwort']
                    ELSE ARRAY[]::text[] END)) AS spalten
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
              AND c.relname <> ALL (ARRAY['api_tokens', 'qr_login_tokens', 'user_sessions', 'webauthn_challenges',
                                          'zweiter_faktor_codes', 'account_link_invites'])
            GROUP BY c.oid, c.relname LOOP
    EXECUTE pg_catalog.format('GRANT SELECT (%s) ON %s TO %I', pg_catalog.array_to_string(r.spalten, ', '), r.name, lesen);
  END LOOP;
END $$;
SQL
echo "[db-rolle] Rolle ${DB_APP_USER} ohne Superuser-Rechte besitzt die Datenbank; ${DB_LESEN_USER} liest ohne Geheimnisse."
