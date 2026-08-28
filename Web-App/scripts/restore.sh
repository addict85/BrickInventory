#!/bin/sh
# ── Wiederherstellen aus einer Sicherung von scripts/backup.sh ───────────────
#
# Aufruf:
#   ./scripts/restore.sh backups/db_JJJJ-MM-TT_HHMM.sql.gz [backups/data_JJJJ-MM-TT_HHMM.tar.gz]
#
# Der Weg stand bisher nur als Kommentar am Ende von backup.sh — und der dort
# gezeigte psql-Aufruf hatte eine Falle: OHNE ON_ERROR_STOP meldet psql auch
# bei einem halben, kaputten Dump Exit 0 (empirisch nachgestellt: abgeschnittener
# Dump → Exit 0; mit ON_ERROR_STOP=1 → Exit 3). Man glaubt, wiederhergestellt
# zu haben, und merkt erst beim Benutzen, dass die Hälfte fehlt.
#
# Dieses Skript:
#   1. prüft die Endmarke des Dumps, BEVOR es irgendetwas anfasst
#   2. fragt einmal nach (der Restore ÜBERSCHREIBT den aktuellen Stand)
#   3. spielt den Dump mit ON_ERROR_STOP=1 ein — jeder Fehler bricht ab
#   4. entpackt optional data/ (Bilder, Anleitungen — die liegen NICHT in der DB)
#   5. startet den App-Container neu
#
# Getestet wurde der Ablauf gegen Postgres 16, beide Richtungen: Restore in
# eine bestehende Datenbank (der --clean-Dump räumt selbst auf) und in eine
# komplett frische (inkl. Trigramm-Indizes); die App-Schema-Initialisierung
# lief danach durch und die Daten waren vollständig sichtbar.
set -eu

DB_SERVICE="${DB_SERVICE:-postgres}"
APP_SERVICE="${APP_SERVICE:-app}"
DB_USER="${PGUSER:-brickinventory}"
DB_NAME="${PGDATABASE:-brickinventory}"

DUMP="${1:-}"
DATA_TAR="${2:-}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Aufruf: $0 backups/db_….sql.gz [backups/data_….tar.gz]" >&2
  exit 1
fi

# 1. Dump auf Vollständigkeit prüfen, bevor irgendetwas überschrieben wird.
if ! gunzip -c "$DUMP" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  echo "[restore] FEHLER: $DUMP ist unvollständig (Endmarke fehlt) — Abbruch, nichts verändert." >&2
  exit 1
fi
echo "[restore] Dump-Endmarke vorhanden: $DUMP"

if [ -n "$DATA_TAR" ] && [ ! -f "$DATA_TAR" ]; then
  echo "[restore] FEHLER: $DATA_TAR existiert nicht." >&2
  exit 1
fi

# 2. Einmal nachfragen — das hier überschreibt den aktuellen Stand.
printf '[restore] Datenbank %s wird mit dem Stand aus %s ÜBERSCHRIEBEN. Fortfahren? [ja/N] ' "$DB_NAME" "$DUMP"
read -r antwort
[ "$antwort" = "ja" ] || { echo "[restore] Abgebrochen."; exit 1; }

# 3. Einspielen — ON_ERROR_STOP=1 ist der Unterschied zwischen „es sah gut
#    aus" und „es IST gut": jeder SQL-Fehler bricht mit Exit != 0 ab.
echo "[restore] Datenbank wird eingespielt …"
gunzip -c "$DUMP" | docker compose exec -T "$DB_SERVICE" \
  psql -v ON_ERROR_STOP=1 -q -U "$DB_USER" "$DB_NAME"
echo "[restore] Datenbank eingespielt."

# 4. Laufzeitdaten (Bilder, Anleitungen) — optional, aber ohne sie zeigen
#    Galerie und Anleitungsliste ins Leere, bis alles neu geladen ist.
if [ -n "$DATA_TAR" ]; then
  echo "[restore] Laufzeitdaten aus $DATA_TAR …"
  tar xzf "$DATA_TAR"
  echo "[restore] data/ wiederhergestellt."
else
  echo "[restore] Hinweis: kein data-Archiv angegeben — Bilder/Anleitungen bleiben wie sie sind."
fi

# 5. App neu starten, damit sie sauber gegen den neuen Stand initialisiert.
echo "[restore] App-Container wird neu gestartet …"
docker compose restart "$APP_SERVICE"
echo "[restore] fertig."
