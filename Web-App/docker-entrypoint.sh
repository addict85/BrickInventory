#!/bin/sh
set -e

# compose.yaml startet app und jobs als brickinv; ./data hat der Dienst
# daten-rechte vorher eingerichtet, ohne dass dieser Container je root war.
# Als root (ein einzelnes `docker run` ohne compose) richtet der Start es
# selbst ein und gibt die Rechte danach ab.
if [ "$(id -u)" = 0 ]; then
  echo "[entrypoint] Als root gestartet: Datenverzeichnisse werden vorbereitet …"
  # Der Datenschlüssel liegt ausserhalb von /app/data; Docker legt den Ordner
  # root gehörend an, der Server muss die Datei anlegen und lesen.
  for f in /app/schluessel /app/schluessel/datenschluessel; do
    [ -e "$f" ] && chown -h brickinv:brickinv "$f" 2>/dev/null || true
  done
  sh /app/daten-rechte.sh
  exec su-exec brickinv "$0" "$@"
fi

# Was der Server anlegt (Uploads können Rechnungen sein), liest auf dem Host nur sein Konto.
umask 077
echo "[entrypoint] Server wird gestartet (Rolle ${ROLLE:-beides})."
exec node dist/server.js
