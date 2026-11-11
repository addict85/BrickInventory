#!/bin/sh
# Zwei Rollen ohne Superuser-Rechte: Die Migrationsrolle besitzt Datenbank,
# Schema und alle Objekte (Erststart, Migrationen, Restore); die Laufzeitrolle
# von app und jobs darf nur Zeilen lesen und schreiben. Ein Einbruch in die App
# kann so weder Tabellen ändern oder löschen noch COPY … PROGRAM erreichen.
# Läuft mit dem Superuser bei jedem `docker compose up` (Dienst db-rolle) und
# beim Anlegen einer neuen Datenbank (docker-entrypoint-initdb.d); wiederholbar.
#
# Die Migrationsrolle kann Schemas, Funktionen und Datenbank-Einstellungen
# anlegen. Nichts davon darf in dieser Superuser-Sitzung wirken – daher fester
# search_path schon beim Verbinden, RESET ALL vor allem anderen und nur
# Funktionen aus pg_catalog.
set -eu

# Docker-Secrets: X_FILE statt X, damit kein Passwort in `docker inspect` steht.
aus_datei() {
  eval "datei=\${$1_FILE:-}"
  [ -n "$datei" ] || return 0
  if eval "[ -n \"\${$1:-}\" ]"; then echo "[db-rolle] $1 und $1_FILE sind beide gesetzt - nur eines davon." >&2; exit 1; fi
  [ -r "$datei" ] || { echo "[db-rolle] $1_FILE=$datei ist nicht lesbar - siehe scripts/geheimnisse-einrichten.sh." >&2; exit 1; }
  eval "$1=\$(cat \"\$datei\")"
  export "$1"
}
aus_datei PGPASSWORD
aus_datei DB_APP_PASSWORD
aus_datei DB_MIGRATION_PASSWORD
aus_datei PGWEB_DB_PASSWORD
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD fehlt - sh scripts/geheimnisse-einrichten.sh, siehe UPGRADE.md}"
: "${DB_MIGRATION_PASSWORD:?DB_MIGRATION_PASSWORD fehlt - sh scripts/geheimnisse-einrichten.sh, siehe UPGRADE.md Abschnitt 50}"
SU_PASSWORT="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
if [ "$DB_APP_PASSWORD" = "$SU_PASSWORT" ]; then
  echo "[db-rolle] DB_APP_PASSWORD muss sich von DB_PASSWORD unterscheiden." >&2
  exit 1
fi
if [ "$DB_MIGRATION_PASSWORD" = "$SU_PASSWORT" ] || [ "$DB_MIGRATION_PASSWORD" = "$DB_APP_PASSWORD" ]; then
  echo "[db-rolle] DB_MIGRATION_PASSWORD muss sich von DB_PASSWORD und DB_APP_PASSWORD unterscheiden." >&2
  exit 1
fi
export PGWEB_DB_PASSWORD="${PGWEB_DB_PASSWORD:-}"
if [ -n "$PGWEB_DB_PASSWORD" ]; then
  for anderes in "$SU_PASSWORT" "$DB_APP_PASSWORD" "$DB_MIGRATION_PASSWORD"; do
    if [ "$PGWEB_DB_PASSWORD" = "$anderes" ]; then
      echo "[db-rolle] PGWEB_DB_PASSWORD muss sich von DB_PASSWORD, DB_APP_PASSWORD und DB_MIGRATION_PASSWORD unterscheiden." >&2
      exit 1
    fi
  done
fi
export DB_APP_USER="${DB_APP_USER:-brickinventory_app}"
export DB_MIGRATION_USER="${DB_MIGRATION_USER:-brickinventory_migration}"
export DB_LESEN_USER="${DB_LESEN_USER:-brickinventory_lesen}"

# Was die Leserolle (pgweb) lesen darf, je Tabelle: eine Allowlist. Eine neue
# Tabelle oder Spalte bleibt unlesbar, bis sie hier bewusst steht; eine neue
# Geheimspalte wird so nie nebenbei freigegeben. Nicht aufgeführt sind z. B.
# Passwort-Hashes, Tokens, Sitzungen, TOTP, Einstellungswerte, Gutschein-PIN.
export LESEN_SPALTEN='
account_links: main_user_id, sub_user_id, created_at
api_aufrufe: tag, api, konto, anzahl
api_takt: api, naechster
app_logs: id, level, message, logged_at
auftraege: id, art, user_id, schluessel, status, versuche, max_versuche, faellig_ab, belegt_von, fehler, erstellt, aktualisiert, frist_bis, gestartet, fortschritt
auftrag_pausen: art, bis, grund, stufe
bl_zuordnung: art, rb_id, bl_id, fetched_at
catalog_cache: set_number, name, year, theme, pieces, image_url, is_gear, bl_type, fetched_at
global_settings: key, updated_at
gutschein_guthaben_schranke: id, letzter_abruf, sperre_bis
household_former_links: main_user_id, sub_user_id, via_user_id, created_at
image_misses: cache_key, checked_at, reason
image_wanted: url, set_number, requested_at
import_stand: user_id, status, total, done, current, results, error, started_at, updated_at, run_id
instructions: id, user_id, set_number, url, description, local_path, downloaded_at
laufzustand: schluessel, wert, aktualisiert
minifig_acquisitions: id, user_id, fig_number, quantity, unit_price, condition, created_at, currency, price_estimated, tag
minifig_parts_cache: fig_number, data, fetched_at
minifig_price_cache: id, fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at, geschaetzt, abdeckung
minifig_price_history: id, fig_number, condition, currency_code, avg_price, qty_avg_price, recorded_at, geschaetzt, abdeckung
minifigs: id, user_id, set_number, fig_number, source, storage_id
minifigs_catalog: fig_number, fig_name, image_url, image_local, updated_at
papierkorb: id, user_id, art, nummer, farbe_id, bezeichnung, zeilen, geloescht_am
part_acquisitions: id, user_id, part_number, color_id, quantity, unit_price, condition, created_at, currency, price_estimated, tag
part_catalog: part_number, part_name, category_name, updated_at
part_color_catalog: part_number, color_id, color_name, color_hex, image_url, image_local, updated_at
part_price_cache: id, part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at
part_price_history: id, part_number, color_id, condition, currency_code, avg_price, qty_avg_price, recorded_at
parts: id, user_id, set_number, part_number, color_id, source, storage_id, added_at
parts_katalog_offen: id, nummer
parts_summary: user_id, part_key, color_id, part_number, bl_part_number, part_name, color_name, color_hex, category_name, image_url, image_local, is_spare, total_quantity, in_sets, storage
parts_summary_state: user_id, built_version, built_at
parts_version_user: user_id, v
passkeys: id, user_id, sign_count, transports, name, created_at, last_used
price_alerts: user_id, set_number, condition, richtung, schwelle, currency_code, ausgeloest, zuletzt_am, zuletzt_preis, created_at
price_cache: id, set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at
price_history: id, set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, recorded_at
rate_limit_attempts: key, count, first_at, last_at, laufend, laufend_seit
rb_colors: id, name, rgb, is_trans, bl_color_id
rb_inventories: id, set_num, version
rb_inventory_minifigs: id, inventory_id, fig_num, quantity
rb_inventory_parts: id, inventory_id, part_num, color_id, quantity, is_spare, img_url
rb_part_categories: id, name
rb_parts: part_num, name, part_cat_id, part_img_url
rb_sets: set_num, name, year, theme_id, num_parts, set_img_url, herkunft
rb_themes: id, name, parent_id
schema_migrations: name, applied_at, pruefsumme
set_acquisitions: id, user_id, set_number, quantity, purchase_price, created_at, condition, currency, price_estimated, tag
set_catalog: set_number, minifigs, image_url, image_local, brickset_id, updated_at
set_figuren: set_number, fig_number, quantity, updated_at
set_minifigs_catalog: set_number, fig_number, fig_name, quantity, image_url, image_local, updated_at
set_parts_catalog: set_number, part_number, part_name, color_id, color_name, color_hex, category_name, image_url, image_local, is_spare, quantity, updated_at
set_teile: set_number, part_number, color_id, is_spare, quantity, updated_at
sets: id, user_id, set_number, added_at, updated_at, storage_id
shared_instructions: id, set_number, url, description, local_path, fetched_at
storage_locations: id, user_id, name, created_at
subsets_cache: set_number, data, fetched_at
user_settings: user_id, key, updated_at
users: id, username, email, first_name, last_name, is_admin, is_active, email_verified, token_expires, reset_token_expires, must_change_password, created_at, sitzungs_version
verwaltungsprotokoll: id, zeit, verwalter_id, ziel_id, ziel_name, aktion, einzelheiten
vouchers: id, user_id, amount, currency, pdf_path, created_at, updated_at, guthaben_geprueft_am
wanted: id, user_id, set_number, condition, created_at
wechselkurse: tag, waehrung, je_eur
zweiter_faktor: user_id, aktiv, eingerichtet_am
'

# Kommandozeilen-Optionen schlagen ALTER DATABASE … SET; role=none hebt ein
# untergeschobenes `SET role` auf, das die Sitzung zur Migrationsrolle machte.
PGOPTIONS='-c search_path=pg_catalog,pg_temp -c role=none -c default_transaction_read_only=off' \
psql -v ON_ERROR_STOP=1 -q -X \
  --username "${PGUSER:-${POSTGRES_USER:-brickinventory}}" \
  --dbname "${PGDATABASE:-${POSTGRES_DB:-brickinventory}}" <<'SQL'
SET search_path = pg_catalog, pg_temp;
SET ROLE NONE;
\getenv app_rolle DB_APP_USER
\getenv app_passwort DB_APP_PASSWORD
\getenv migration_rolle DB_MIGRATION_USER
\getenv migration_passwort DB_MIGRATION_PASSWORD
\getenv lesen_rolle DB_LESEN_USER
\getenv lesen_passwort PGWEB_DB_PASSWORD
\getenv lesen_spalten LESEN_SPALTEN
SELECT pg_catalog.set_config('brickinventory.app_rolle', :'app_rolle', false) AS r,
       pg_catalog.set_config('brickinventory.app_passwort', :'app_passwort', false) AS p,
       pg_catalog.set_config('brickinventory.migration_rolle', :'migration_rolle', false) AS mr,
       pg_catalog.set_config('brickinventory.migration_passwort', :'migration_passwort', false) AS mp,
       pg_catalog.set_config('brickinventory.lesen_rolle', :'lesen_rolle', false) AS lr,
       pg_catalog.set_config('brickinventory.lesen_passwort', :'lesen_passwort', false) AS lp,
       pg_catalog.set_config('brickinventory.lesen_spalten', :'lesen_spalten', false) AS ls \gset
DO $$
DECLARE
  rolle text := pg_catalog.current_setting('brickinventory.app_rolle');
  migration text := pg_catalog.current_setting('brickinventory.migration_rolle');
  lesen text := pg_catalog.current_setting('brickinventory.lesen_rolle');
  lesen_pw text := pg_catalog.current_setting('brickinventory.lesen_passwort');
  liste text := pg_catalog.current_setting('brickinventory.lesen_spalten');
  spalten text[];
  tab   oid;
  db    text := pg_catalog.current_database();
  ziel  oid;
  r     record;
  kopie record;
  konto record;
  -- MAINTAIN (VACUUM/ANALYZE nach dem Katalog-Import ohne Eigentum) gibt es erst ab 17.
  pflege text := CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'db-rolle muss als Superuser laufen, nicht als %', current_user;
  END IF;
  IF rolle = current_user OR lesen = current_user OR migration = current_user
     OR rolle = lesen OR rolle = migration OR lesen = migration THEN
    RAISE EXCEPTION 'Laufzeitrolle %, Migrationsrolle %, Leserolle % und Superuser % müssen verschieden sein',
      rolle, migration, lesen, current_user;
  END IF;
  -- Event-Trigger feuern bei jedem ALTER … OWNER unten mit Superuser-Rechten.
  IF EXISTS (SELECT FROM pg_catalog.pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'Aktive Event-Trigger in %: erst prüfen und deaktivieren', db;
  END IF;
  EXECUTE pg_catalog.format('ALTER DATABASE %I RESET ALL', db);

  -- Beide Rollen ohne Sonderrechte, ohne eigene Einstellungen und in keiner
  -- anderen Rolle Mitglied (auch nicht die Laufzeit- in der Migrationsrolle).
  FOR konto IN SELECT * FROM (VALUES (migration, pg_catalog.current_setting('brickinventory.migration_passwort')),
                                     (rolle, pg_catalog.current_setting('brickinventory.app_passwort'))) AS k(name, pw) LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = konto.name) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I LOGIN', konto.name);
      RAISE NOTICE '[db-rolle] Rolle % angelegt', konto.name;
    END IF;
    EXECUTE pg_catalog.format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS',
                   konto.name, konto.pw);
    EXECUTE pg_catalog.format('ALTER ROLE %I RESET ALL', konto.name);
    EXECUTE pg_catalog.format('ALTER ROLE %I IN DATABASE %I RESET ALL', konto.name, db);
    FOR r IN SELECT g.rolname FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
              WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = konto.name) LOOP
      EXECUTE pg_catalog.format('REVOKE %I FROM %I', r.rolname, konto.name);
    END LOOP;
  END LOOP;

  -- Eigentümerin von allem ist die Migrationsrolle; was bisher der
  -- Laufzeitrolle oder dem Superuser gehörte, geht an sie.
  SELECT oid INTO ziel FROM pg_catalog.pg_roles WHERE rolname = migration;
  EXECUTE pg_catalog.format('ALTER DATABASE %I OWNER TO %I', db, migration);
  IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public') NOT IN (ziel, 'pg_database_owner'::pg_catalog.regrole) THEN
    EXECUTE pg_catalog.format('ALTER SCHEMA public OWNER TO %I', migration);
  END IF;

  -- Was eine Erweiterung mitbringt (pg_trgm), bleibt bei ihr; Sequenzen einer
  -- Spalte gehen mit ihrer Tabelle.
  FOR r IN SELECT c.oid::pg_catalog.regclass AS name, c.relkind FROM pg_catalog.pg_class c
            WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relowner <> ziel
              AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                                AND d.objid = c.oid AND d.deptype IN ('e', 'a', 'i')) LOOP
    EXECUTE pg_catalog.format('ALTER %s %s OWNER TO %I', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                   WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.name, migration);
  END LOOP;
  FOR r IN SELECT p.oid::pg_catalog.regprocedure AS name, p.prokind FROM pg_catalog.pg_proc p
            WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proowner <> ziel
              AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                                AND d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE pg_catalog.format('ALTER %s %s OWNER TO %I', CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE'
                   ELSE 'FUNCTION' END, r.name, migration);
  END LOOP;
  FOR r IN SELECT t.oid::pg_catalog.regtype AS name, t.typtype FROM pg_catalog.pg_type t
            WHERE t.typnamespace = 'public'::pg_catalog.regnamespace AND t.typowner <> ziel
              AND (t.typtype IN ('e', 'd', 'r')
                   OR (t.typtype = 'c' AND (SELECT relkind FROM pg_catalog.pg_class WHERE oid = t.typrelid) = 'c'))
              AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                                AND d.objid = t.oid AND d.deptype = 'e') LOOP
    EXECUTE pg_catalog.format('ALTER %s %s OWNER TO %I', CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.name, migration);
  END LOOP;
  -- Die Kopien vor Migrationen legt der Dienst migration an und räumt sie weg;
  -- die Laufzeitrolle verschlüsselt sie nach und löscht daraus gelöschte Konten.
  FOR r IN SELECT n.oid, n.nspname FROM pg_catalog.pg_namespace n
            WHERE n.nspname OPERATOR(pg_catalog.~) '^vor_migration_[0-9]+$' LOOP
    EXECUTE pg_catalog.format('ALTER SCHEMA %I OWNER TO %I', r.nspname, migration);
    FOR kopie IN SELECT c.oid::pg_catalog.regclass AS name FROM pg_catalog.pg_class c
              WHERE c.relnamespace = r.oid AND c.relkind = 'r' AND c.relowner <> ziel LOOP
      EXECUTE pg_catalog.format('ALTER TABLE %s OWNER TO %I', kopie.name, migration);
    END LOOP;
    EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA %I TO %I', r.nspname, rolle);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', r.nspname, rolle);
    EXECUTE pg_catalog.format('GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', r.nspname, rolle);
  END LOOP;

  -- Laufzeitrolle: Zeilen lesen und schreiben, Sequenzen weiterzählen, temporäre
  -- Tabellen (Schatten des Katalog-Imports); kein CREATE in Datenbank und Schema.
  -- Erst alles weg, dann genau das: Aus der Zeit als Eigentümerin bleibt nichts.
  EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM %I', db, rolle);
  EXECUTE pg_catalog.format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', db, rolle);
  EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA public FROM %I', rolle);
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', rolle);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', rolle);
  EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE, DELETE%s ON ALL TABLES IN SCHEMA public TO %I', pflege, rolle);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', rolle);
  EXECUTE pg_catalog.format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', rolle);
  -- Für alles, was die Migrationsrolle künftig anlegt (Migrationen, Kopien,
  -- Restore), gilt dasselbe ohne erneuten Lauf; ohne IN SCHEMA, damit auch neue
  -- vor_migration_*-Schemas erfasst sind.
  EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM %I', migration, rolle);
  EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT SELECT, INSERT, UPDATE, DELETE%s ON TABLES TO %I',
                 migration, pflege, rolle);
  EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', migration, rolle);
  EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT USAGE ON SCHEMAS TO %I', migration, rolle);

  -- Leserolle für pgweb: nur SELECT auf die Allowlist oben.
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
  -- Auch keine temporären Tabellen; die Laufzeitrolle hat TEMP oben ausdrücklich.
  EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', db);
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO %I', db, lesen);
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', lesen);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', lesen);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', lesen);
  -- Allowlist (LESEN_SPALTEN): nur genannte Spalten genannter Tabellen. Eine
  -- Spalte, die es nicht gibt, meldet sich; eine fehlende Tabelle nicht, weil
  -- db-rolle vor den Migrationen einer neuen Datenbank läuft.
  FOR r IN SELECT pg_catalog.btrim(pg_catalog.split_part(z, ':', 1)) AS tabelle,
                  pg_catalog.string_to_array(pg_catalog.regexp_replace(pg_catalog.split_part(z, ':', 2), '\s', '', 'g'), ',') AS namen
             FROM pg_catalog.regexp_split_to_table(liste, E'\n') AS z
            WHERE pg_catalog.strpos(z, ':') > 0 LOOP
    tab := (SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::pg_catalog.regnamespace
              AND c.relname = r.tabelle AND c.relkind IN ('r', 'p', 'v', 'm'));
    CONTINUE WHEN tab IS NULL;
    SELECT pg_catalog.array_agg(pg_catalog.quote_ident(a.attname::text) ORDER BY a.attnum) INTO spalten
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = tab AND a.attnum > 0 AND NOT a.attisdropped AND a.attname::text = ANY (r.namen);
    IF pg_catalog.cardinality(r.namen) <> COALESCE(pg_catalog.cardinality(spalten), 0) THEN
      RAISE NOTICE '[db-rolle] Leserolle: in % fehlt eine der Spalten %', r.tabelle, r.namen;
    END IF;
    IF spalten IS NOT NULL THEN
      EXECUTE pg_catalog.format('GRANT SELECT (%s) ON %s TO %I', pg_catalog.array_to_string(spalten, ', '), tab::pg_catalog.regclass, lesen);
    END IF;
  END LOOP;
END $$;
SQL
echo "[db-rolle] ${DB_MIGRATION_USER} besitzt die Datenbank, ${DB_APP_USER} liest und schreibt nur Zeilen, ${DB_LESEN_USER} liest nur die Allowlist."
