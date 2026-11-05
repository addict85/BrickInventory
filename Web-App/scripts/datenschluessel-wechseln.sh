#!/bin/sh
# Wechselt den Datenschlüssel, etwa bei Verdacht, dass ./schluessel/datenschluessel
# abgeflossen ist (UPGRADE.md, Abschnitt 43). Im Ordner mit compose.yaml:
#
#   sudo sh scripts/datenschluessel-wechseln.sh                beginnen
#   sudo sh scripts/datenschluessel-wechseln.sh abschliessen   den vorigen löschen
#
# Beginnen: Der bisherige Schlüssel wird zu datenschluessel.alt, der Dienst
# `schluessel` legt einen neuen an, und app und jobs schreiben beim Start alles,
# was nur der alte öffnet, mit dem neuen neu (DATA_KEY_ALT_FILE in compose.yaml).
set -eu

ORDNER="${SCHLUESSEL_ORDNER:-./schluessel}"
AKTUELL="$ORDNER/datenschluessel"
VORIG="$ORDNER/datenschluessel.alt"

case "${1:-beginnen}" in
  beginnen)
    [ -s "$AKTUELL" ] || { echo "[schlüssel] FEHLER: $AKTUELL fehlt — im Ordner mit compose.yaml aufrufen." >&2; exit 1; }
    if [ -e "$VORIG" ]; then
      echo "[schlüssel] FEHLER: $VORIG gibt es schon; ein Wechsel ist offen. Erst abschliessen." >&2
      exit 1
    fi
    docker compose stop app jobs
    mv "$AKTUELL" "$VORIG"
    docker compose up -d
    echo "[schlüssel] Neuer Schlüssel angelegt. Weiter:"
    echo "  1. docker compose logs app | grep Schlüsselwechsel   (wie viele Werte neu geschrieben sind)"
    echo "  2. den neuen $AKTUELL getrennt sichern (BACKUP_SCHLUESSEL_ZIEL) und die alte Kopie dort ersetzen"
    echo "  3. Konten mit zweitem Faktor erzeugen neue Wiederherstellungscodes"
    echo "  4. sudo sh scripts/datenschluessel-wechseln.sh abschliessen"
    ;;
  abschliessen)
    [ -e "$VORIG" ] || { echo "[schlüssel] Kein Wechsel offen."; exit 0; }
    if ! docker compose logs app 2>/dev/null | grep -q 'Schlüsselwechsel:'; then
      echo "[schlüssel] FEHLER: Der Server hat den Wechsel noch nicht gemeldet (docker compose logs app)." >&2
      exit 1
    fi
    rm -f "$VORIG"
    docker compose restart app jobs
    echo "[schlüssel] Wechsel abgeschlossen; der vorige Schlüssel ist gelöscht."
    ;;
  *)
    echo "Aufruf: sh scripts/datenschluessel-wechseln.sh [beginnen|abschliessen]" >&2
    exit 2
    ;;
esac
