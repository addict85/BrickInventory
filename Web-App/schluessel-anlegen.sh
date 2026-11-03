#!/bin/sh
# Legt den Datenschlüssel einmal an und übergibt ihn brickinv. Läuft als
# eigener Dienst vor app und jobs (compose.yaml), damit diese den Ordner nur
# lesend sehen: Ein Fehler im Server kann den Schlüssel dann nicht überschreiben.
set -eu

ORDNER="${SCHLUESSEL_ORDNER:-/app/schluessel}"
ALT="${ALTER_SCHLUESSEL:-/app/data/.datenschluessel}"
EIGNER="${SCHLUESSEL_EIGNER:-brickinv}"
DATEI="$ORDNER/datenschluessel"

if [ -s "$DATEI" ]; then
  echo "[schluessel] Datenschlüssel vorhanden."
elif [ -e "$ALT" ]; then
  # Zwei Schlüssel wären ein Startfehler; der Server erklärt den Umzug.
  echo "[schluessel] Alter Schlüssel in data/ gefunden — kein neuer angelegt (UPGRADE.md, Datenschlüssel)."
  exit 0
else
  umask 077
  head -c 32 /dev/urandom | base64 > "$DATEI.neu"
  mv "$DATEI.neu" "$DATEI"
  echo "[schluessel] Neuer Datenschlüssel angelegt: ./schluessel/datenschluessel — getrennt von data/ sichern."
fi

chown "$EIGNER" "$ORDNER" "$DATEI"
chmod 700 "$ORDNER"
chmod 400 "$DATEI"
