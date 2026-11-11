#!/bin/sh
# Stellt eine bestehende Installation auf getrennte Migrations- und
# Laufzeitrolle um (UPGRADE.md, Abschnitt 51). Wiederholbar: Jeder Schritt
# lässt stehen, was schon passt, und der letzte prüft das Ergebnis.
#
#   sh scripts/rollen-trennen.sh     (im Ordner mit compose.yaml, nach dem Update)
set -eu

DB_NAME="${PGDATABASE:-brickinventory}"
SUPERUSER="${DB_SUPERUSER:-brickinventory}"
DB_APP_USER="${DB_APP_USER:-brickinventory_app}"
DB_MIGRATION_USER="${DB_MIGRATION_USER:-brickinventory_migration}"

if ! grep -q '^  migration:' compose.yaml 2>/dev/null; then
  echo "[rollen] compose.yaml ohne Dienst migration (oder falscher Ordner): erst aktualisieren, dann hier aufrufen." >&2
  exit 1
fi

echo "[rollen] 1/4 Passwort der Migrationsrolle (./geheimnisse/db_migration_password) …"
sh "$(dirname "$0")/geheimnisse-einrichten.sh"

echo "[rollen] 2/4 Rollen und Eigentum (Dienst db-rolle) …"
docker compose up -d postgres
docker compose run --rm db-rolle

echo "[rollen] 3/4 Offene Migrationen als Migrationsrolle (Dienst migration) …"
docker compose run --rm migration

echo "[rollen] 4/4 Prüfung …"
# Als Superuser mit festem search_path: Die Datenbank gehört einer anderen Rolle.
ergebnis=$(docker compose exec -T -e PGOPTIONS='-c search_path=pg_catalog,pg_temp' postgres \
  psql -X -q -At -v ON_ERROR_STOP=1 -U "$SUPERUSER" -d "$DB_NAME" \
  -v mig="$DB_MIGRATION_USER" -v app="$DB_APP_USER" <<'SQL'
SELECT (SELECT count(*) FROM pg_catalog.pg_class c
         WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
           AND c.relowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = :'mig')
           AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a', 'i')))
       || ' ' || pg_catalog.has_schema_privilege(:'app', 'public', 'CREATE')
       || ' ' || pg_catalog.has_table_privilege(:'app', 'public.users', 'INSERT')
       || ' ' || (SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database());
SQL
)
if [ "$ergebnis" != "0 false true $DB_MIGRATION_USER" ]; then
  echo "[rollen] Prüfung fehlgeschlagen (fremde Objekte, CREATE der Laufzeitrolle, INSERT, Eigentümerin): $ergebnis" >&2
  exit 1
fi
echo "[rollen] $DB_MIGRATION_USER besitzt alles, $DB_APP_USER schreibt nur Zeilen."

docker compose up -d
echo "[rollen] fertig."
