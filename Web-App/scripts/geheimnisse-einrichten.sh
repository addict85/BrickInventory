#!/bin/sh
# Legt ./geheimnisse/ an: je Geheimnis eine Datei, die compose.yaml als
# Docker-Secret einhängt. Umgebungsvariablen zeigt `docker inspect` jedem mit
# Zugang zu Docker; Dateien unter /run/secrets/ nicht. UPGRADE.md#geheimnisse.
#
#   sh scripts/geheimnisse-einrichten.sh            (im Ordner mit compose.yaml)
#   PGWEB=ja sh scripts/geheimnisse-einrichten.sh   auch ein Passwort für die Leserolle
#
# Vorhandene Dateien bleiben. Fehlende kommen aus einer alten .env
# (SESSION_SECRET, DB_PASSWORD, DB_APP_PASSWORD) oder werden
# zufällig erzeugt. DB_PASSWORD einer bestehenden Datenbank lässt sich nicht
# erzeugen: Ohne Wert in .env bricht das Skript dann ab.
set -eu

ORDNER="${GEHEIMNIS_ORDNER:-./geheimnisse}"
ENV_DATEI="${ENV_DATEI:-.env}"
PGDATEN="${PGDATEN_ORDNER:-./pgdata18}"

# Letzte Zeile NAME=… aus .env, ohne umschliessende Anführungszeichen.
aus_env() {
  [ -f "$ENV_DATEI" ] || return 0
  sed -n "s/^$1=//p" "$ENV_DATEI" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
# Hex aus /dev/urandom: nur [0-9a-f], passt so auch in eine Verbindungsadresse.
zufall() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

schreibe() {
  printf '%s' "$2" > "$ORDNER/$1.neu"
  chmod 444 "$ORDNER/$1.neu"
  mv "$ORDNER/$1.neu" "$ORDNER/$1"
}

# name, Variable in .env (oder leer), Byte für einen neuen Wert (0: nicht erzeugen)
richte_ein() {
  if [ -s "$ORDNER/$1" ]; then
    echo "[geheimnisse] $1 vorhanden."
    return 0
  fi
  wert=""
  [ -z "$2" ] || wert=$(aus_env "$2")
  if [ -n "$wert" ]; then
    schreibe "$1" "$wert"
    echo "[geheimnisse] $1 aus $ENV_DATEI ($2) übernommen."
  elif [ "$3" -gt 0 ]; then
    schreibe "$1" "$(zufall "$3")"
    echo "[geheimnisse] $1 neu erzeugt."
  else
    schreibe "$1" ""
    echo "[geheimnisse] $1 leer angelegt."
  fi
}

umask 077
mkdir -p "$ORDNER"
chmod 700 "$ORDNER"

if [ ! -s "$ORDNER/db_password" ] && [ -z "$(aus_env DB_PASSWORD)" ] && [ -d "$PGDATEN" ]; then
  echo "[geheimnisse] FEHLER: $PGDATEN gibt es schon, aber kein DB_PASSWORD in $ENV_DATEI." >&2
  echo "[geheimnisse]   Das Passwort des Superusers steht in der Datenbank; ein neues passte nicht." >&2
  echo "[geheimnisse]   Den bisherigen Wert als DB_PASSWORD=… in $ENV_DATEI eintragen und erneut aufrufen." >&2
  exit 1
fi

richte_ein session_secret SESSION_SECRET 48
richte_ein db_password DB_PASSWORD 24
richte_ein db_app_password DB_APP_PASSWORD 24
# Die Migrationsrolle bekommt ihr Passwort bei jedem Lauf von db-rolle neu; ein
# neu erzeugtes passt also auch zu einer bestehenden Datenbank (UPGRADE.md#migrationsrolle).
richte_ein db_migration_password "" 24
# Die Leserolle bekommt ihr Passwort bei jedem Lauf von db-rolle neu; leer
# heisst: sie meldet sich gar nicht an. Der Dateiname stammt aus der Zeit von pgweb.
if [ "${PGWEB:-nein}" = ja ]; then
  richte_ein pgweb_db_password "" 24
  echo "[geheimnisse] Leserolle brickinventory_lesen: Passwort in $ORDNER/pgweb_db_password (README, „Datenbank ansehen“)."
else
  [ -e "$ORDNER/pgweb_db_password" ] || richte_ein pgweb_db_password "" 0
fi

if [ "$(cat "$ORDNER/db_password")" = "$(cat "$ORDNER/db_app_password")" ]; then
  echo "[geheimnisse] FEHLER: db_password und db_app_password sind gleich; db_app_password löschen und erneut aufrufen." >&2
  exit 1
fi
for anderes in db_password db_app_password; do
  if [ "$(cat "$ORDNER/db_migration_password")" = "$(cat "$ORDNER/$anderes")" ]; then
    echo "[geheimnisse] FEHLER: db_migration_password und $anderes sind gleich; db_migration_password löschen und erneut aufrufen." >&2
    exit 1
  fi
done

alt=""
for v in SESSION_SECRET DB_PASSWORD DB_APP_PASSWORD PGWEB_PASSWORD PGWEB_DB_PASSWORD; do
  [ -z "$(aus_env "$v")" ] || alt="$alt $v"
done
if [ -n "$alt" ]; then
  echo "[geheimnisse] Jetzt aus $ENV_DATEI löschen (compose.yaml liest sie nicht mehr):$alt" >&2
fi
echo "[geheimnisse] fertig: $ORDNER (Ordner 700, Dateien 444). Nicht ins Repository, nicht in Sicherungen neben dem Dump."
