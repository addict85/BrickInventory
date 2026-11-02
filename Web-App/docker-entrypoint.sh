#!/bin/sh
set -e

# Jeder Schritt sagt, was er tut: Minuten ohne Ausgabe vor dem Server liessen
# sich sonst nicht von einem hängenden Start unterscheiden.
echo "[entrypoint] Datenverzeichnisse werden vorbereitet …"

ZIEL_UID=$(id -u brickinv)

# Als root nur die Einhängepunkte selbst, mit -h (ein Symlink an ihrer Stelle
# wird nicht verfolgt). Alles darunter gehört dem Dienst, und der kann dort
# Symlinks ablegen.
chown -h brickinv:brickinv /app/data 2>/dev/null || true
# Der Datenschlüssel liegt ausserhalb von /app/data (compose.yaml); Docker legt
# den Ordner root gehörend an, der Server muss die Datei anlegen und lesen.
for f in /app/schluessel /app/schluessel/datenschluessel; do
  [ -e "$f" ] && chown -h brickinv:brickinv "$f" 2>/dev/null || true
done

# Der Eigentümerwechsel unter /app/data ist ein Reparaturschritt (neuer
# Datenträger, andere UID), kein Startschritt: Bei zehntausenden Bildern kostet
# er Minuten. BRICKINV_CHOWN=auto sucht erst (bis zum ersten Treffer), always
# erzwingt ihn, never lässt ihn weg (SMB/CIFS mit festem uid). Die Marke spart
# danach auch die Suche.
MARKE=/app/data/.eigentuemer

# Root folgt dabei keinem Symlink des Dienstes: find ohne -L verfolgt keine,
# -xdev bleibt im Datenträger, chown -h ändert nur den Eintrag selbst.
berichtige() {
  echo "[entrypoint] Eigentuemer wird gesetzt — das kann bei vielen Bildern einige Minuten dauern."
  find /app/data -xdev ! -uid "$ZIEL_UID" -exec chown -h brickinv:brickinv {} +
  echo "[entrypoint] Eigentuemer berichtigt."
}

# Nicht als root: rm entfernt einen Symlink selbst, und geschrieben wird als
# brickinv. `|| true`: Auf einem nur lesbaren Datenträger ist die Marke kein Muss.
setzeMarke() {
  { rm -f "$MARKE" && su-exec brickinv sh -c 'printf "%s" "$1" > "$2"' marke "$ZIEL_UID" "$MARKE"; } 2>/dev/null || true
}

case "${BRICKINV_CHOWN:-auto}" in
  never)
    echo "[entrypoint] Eigentuemerpruefung uebersprungen (BRICKINV_CHOWN=never)"
    ;;
  always)
    echo "[entrypoint] Vollstaendiger Lauf erzwungen (BRICKINV_CHOWN=always)."
    berichtige
    setzeMarke
    ;;
  *)
    if [ "$(cat "$MARKE" 2>/dev/null)" = "$ZIEL_UID" ]; then
      :
    elif [ -n "$(find /app/data -xdev ! -uid "$ZIEL_UID" -print -quit 2>/dev/null)" ]; then
      echo "[entrypoint] Fremde Eigentuemer gefunden."
      berichtige
      setzeMarke
    else
      setzeMarke
    fi
    ;;
esac

# Als brickinv, nicht als root: Ein Symlink des Dienstes (etwa images → /etc)
# führte ein mkdir von root ausserhalb des Datenordners.
su-exec brickinv mkdir -p \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs \
  || echo "[entrypoint] WARNUNG: Datenverzeichnisse liessen sich als brickinv nicht anlegen (Eigentuemer des Datenordners?)." >&2

echo "[entrypoint] Server wird gestartet (Rolle ${ROLLE:-beides})."
exec su-exec brickinv node dist/server.js
