#!/bin/sh
# ── Wiederherstellen aus einer Sicherung von scripts/backup.sh ───────────────
#
# Aufruf:
#   ./scripts/restore.sh backups/db_JJJJ-MM-TT_HHMM.sql.gz [backups/data_JJJJ-MM-TT_HHMM.tar.gz]
#
# Verschlüsselte Sicherungen (*.age, backup.sh mit BACKUP_AGE_EMPFAENGER):
#   BACKUP_AGE_IDENTITAET=/pfad/zum/privaten/schluessel ./scripts/restore.sh backups/db_….sql.gz.age …
# Entschlüsselt wird in ein Verzeichnis nur für den Besitzer, das am Ende verschwindet.
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
#   3. spielt den Dump als App-Rolle in einer Transaktion ein (ON_ERROR_STOP=1)
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
DB_APP_USER="${DB_APP_USER:-brickinventory_app}"
DB_NAME="${PGDATABASE:-brickinventory}"

DUMP="${1:-}"
DATA_TAR="${2:-}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Aufruf: $0 backups/db_….sql.gz[.age] [backups/data_….tar.gz[.age]]" >&2
  exit 1
fi

case "$DUMP$DATA_TAR" in
  *.age*)
    [ -n "${BACKUP_AGE_IDENTITAET:-}" ] || { echo "[restore] FEHLER: *.age braucht BACKUP_AGE_IDENTITAET (privater Schlüssel)." >&2; exit 1; }
    umask 077
    KLAR=$(mktemp -d)
    trap 'rm -rf "$KLAR"' EXIT
    entschluessele() {
      case "$1" in
        *.age) ziel="$KLAR/$(basename "$1" .age)"
               "${AGE:-age}" -d -i "$BACKUP_AGE_IDENTITAET" -o "$ziel" "$1" \
                 || { echo "[restore] FEHLER: $1 liess sich nicht entschlüsseln — nichts verändert." >&2; exit 1; }
               echo "$ziel" ;;
        *) echo "$1" ;;
      esac
    }
    DUMP=$(entschluessele "$DUMP")
    [ -z "$DATA_TAR" ] || DATA_TAR=$(entschluessele "$DATA_TAR")
    ;;
esac

# 1. Dump auf Vollständigkeit prüfen, bevor irgendetwas überschrieben wird.
if ! gunzip -c "$DUMP" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  echo "[restore] FEHLER: $DUMP ist unvollständig (Endmarke fehlt) — Abbruch, nichts verändert." >&2
  exit 1
fi
echo "[restore] Dump-Endmarke vorhanden: $DUMP"

# age verschlüsselt, prüft aber nicht, wer schrieb: Ein untergeschobener Dump
# könnte psql-Befehle wie \! (Shell im Postgres-Container) tragen. Zeilen mit
# Backslash ausserhalb der COPY-Daten weist dieser Vorlauf ab, den Rest psql
# selbst (\restrict mit eigenem Schlüssel, siehe unten).
if gunzip -c "$DUMP" | awk '
  daten { if ($0 == "\\.") daten = 0; next }
  /^COPY .* FROM stdin;$/ { daten = 1; next }
  /^\\(un)?restrict [A-Za-z0-9]+$/ { next }
  /^[ \t]*\\/ { print NR; exit }' | grep -q .; then
  echo "[restore] FEHLER: $DUMP enthält psql-Befehle (Zeilen mit \\) — kein Dump von backup.sh, nichts verändert." >&2
  exit 1
fi

# Das Archiv vor jeder Änderung prüfen; entpackt wird später nur data/.
if [ -n "$DATA_TAR" ]; then
  sh "$(dirname "$0")/archiv-pruefen.sh" "$DATA_TAR"
  echo "[restore] Archiv geprüft: $DATA_TAR"
fi

# 2. Einmal nachfragen — das hier überschreibt den aktuellen Stand.
printf '[restore] Datenbank %s wird mit dem Stand aus %s ÜBERSCHRIEBEN. Fortfahren? [ja/N] ' "$DB_NAME" "$DUMP"
read -r antwort
[ "$antwort" = "ja" ] || { echo "[restore] Abgebrochen."; exit 1; }

# 3. Als App-Rolle einspielen: Funktionen, Prüfregeln und Trigger im Dump
#    gehören ihr und liefen als Superuser mit dessen Rechten. Besitzerangaben
#    und DROP/COMMENT der Erweiterung (gehört evtl. dem Superuser) fallen weg,
#    ausserhalb der COPY-Daten. -1 mit ON_ERROR_STOP: ganz oder gar nicht.
#    \restrict mit einem Schlüssel, den der Dump nicht kennt: psql führt dann
#    keinen Backslash-Befehl aus, auch nicht mitten in einer Zeile.
echo "[restore] Rolle der App wird vorbereitet …"
docker compose run --rm "${ROLLEN_SERVICE:-db-rolle}"
echo "[restore] Datenbank wird eingespielt …"
RESTRICT=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
gunzip -c "$DUMP" | awk -v schluessel="$RESTRICT" '
  BEGIN { print "\\restrict " schluessel }
  daten { if ($0 == "\\.") daten = 0; print; next }
  /^COPY .* FROM stdin;$/ { daten = 1; print; next }
  /^\\(un)?restrict [A-Za-z0-9]+$/ { next }
  /^ALTER [A-Z ]+ [^\047;]+ OWNER TO [^\047;]+;$/ { next }
  /^DROP EXTENSION IF EXISTS [a-z_"]+;$/ { next }
  /^COMMENT ON EXTENSION [a-z_"]+ IS \047[^\047]*\047;$/ { next }
  { print }' | docker compose exec -T "$DB_SERVICE" \
  psql -X -v ON_ERROR_STOP=1 -q -1 -U "$DB_APP_USER" "$DB_NAME"
echo "[restore] Datenbank eingespielt."

# 4. Laufzeitdaten (Bilder, Anleitungen) — optional, aber ohne sie zeigen
#    Galerie und Anleitungsliste ins Leere, bis alles neu geladen ist.
if [ -n "$DATA_TAR" ]; then
  echo "[restore] Laufzeitdaten aus $DATA_TAR …"
  tar xzf "$DATA_TAR" --no-same-owner data
  echo "[restore] data/ wiederhergestellt."
else
  echo "[restore] Hinweis: kein data-Archiv angegeben — Bilder/Anleitungen bleiben wie sie sind."
fi

# Der Datenschlüssel liegt nicht im Archiv (siehe backup.sh). Fehlt er, legt
# der Server beim Neustart einen neuen an, und die verschlüsselten Werte des
# Dumps lassen sich nicht mehr lesen.
if [ ! -f schluessel/datenschluessel ] && [ ! -f data/.datenschluessel ]; then
  echo "[restore] ACHTUNG: schluessel/datenschluessel fehlt. Vor dem Neustart die getrennt gesicherte" >&2
  echo "[restore]   Datei dorthin legen (oder DATA_KEY setzen); sonst sind API-Schlüssel," >&2
  echo "[restore]   SMTP-Passwort, Gutschein-PINs und der zweite Faktor nicht mehr lesbar." >&2
  printf '[restore] Trotzdem neu starten? [ja/N] '
  read -r antwort
  [ "$antwort" = "ja" ] || { echo "[restore] Ohne Neustart beendet."; exit 1; }
fi

# 5. db-rolle noch einmal: Die eingespielten Tabellen bekommen die Rechte der
#    Leserolle (pgweb).
echo "[restore] Rolle der App wird nachgerichtet …"
docker compose run --rm "${ROLLEN_SERVICE:-db-rolle}"

# 6. App neu starten, damit sie sauber gegen den neuen Stand initialisiert.
echo "[restore] App-Container wird neu gestartet …"
docker compose restart "$APP_SERVICE"
echo "[restore] fertig."
