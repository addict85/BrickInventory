#!/bin/sh
# Richtet ./data für brickinv ein und endet. Läuft als root im eigenen Dienst
# daten-rechte (compose.yaml) vor app und jobs, ohne Netz und nur mit ./data
# eingehängt: Ein Symlink, den der Dienst unter /app/data ablegt, zeigt hier
# höchstens auf das schreibgeschützte Image, nie auf Schlüssel oder Secrets.
set -e

echo "[daten-rechte] Datenverzeichnisse werden vorbereitet …"

ZIEL_UID=$(id -u brickinv)

# Als root nur der Einhängepunkt selbst, mit -h (ein Symlink an seiner Stelle
# wird nicht verfolgt). Alles darunter gehört dem Dienst.
chown -h brickinv:brickinv /app/data 2>/dev/null || true

# Der Eigentümerwechsel unter /app/data ist ein Reparaturschritt (neuer
# Datenträger, andere UID), kein Startschritt: Bei zehntausenden Bildern kostet
# er Minuten. BRICKINV_CHOWN=auto sucht erst (bis zum ersten Treffer), always
# erzwingt ihn, never lässt ihn weg (SMB/CIFS mit festem uid). Die Marke spart
# danach auch die Suche.
MARKE=/app/data/.eigentuemer

# Root folgt dabei keinem Symlink des Dienstes: find ohne -L verfolgt keine,
# -xdev bleibt im Datenträger, chown -h ändert nur den Eintrag selbst.
berichtige() {
  echo "[daten-rechte] Eigentuemer wird gesetzt — das kann bei vielen Bildern einige Minuten dauern."
  find /app/data -xdev ! -uid "$ZIEL_UID" -exec chown -h brickinv:brickinv {} +
  echo "[daten-rechte] Eigentuemer berichtigt."
}

# Nicht als root: rm entfernt einen Symlink selbst, und geschrieben wird als
# brickinv. `|| true`: Auf einem nur lesbaren Datenträger ist die Marke kein Muss.
setzeMarke() {
  { rm -f "$MARKE" && su-exec brickinv sh -c 'printf "%s" "$1" > "$2"' marke "$ZIEL_UID" "$MARKE"; } 2>/dev/null || true
}

case "${BRICKINV_CHOWN:-auto}" in
  never)
    echo "[daten-rechte] Eigentuemerpruefung uebersprungen (BRICKINV_CHOWN=never)"
    ;;
  always)
    echo "[daten-rechte] Vollstaendiger Lauf erzwungen (BRICKINV_CHOWN=always)."
    berichtige
    setzeMarke
    ;;
  *)
    if [ "$(cat "$MARKE" 2>/dev/null)" = "$ZIEL_UID" ]; then
      :
    elif [ -n "$(find /app/data -xdev ! -uid "$ZIEL_UID" -print -quit 2>/dev/null)" ]; then
      echo "[daten-rechte] Fremde Eigentuemer gefunden."
      berichtige
      setzeMarke
    else
      setzeMarke
    fi
    ;;
esac

# Was der Dienst anlegt, liest auf dem Host nur sein Konto (Uploads können
# Rechnungen sein). Ältere Uploads zieht jeder Start nach, als brickinv.
umask 077
su-exec brickinv chmod -R go-rwx /app/data/uploads 2>/dev/null || true

# Als brickinv, nicht als root: Ein Symlink des Dienstes (etwa images → /etc)
# führte ein mkdir von root ausserhalb des Datenordners.
su-exec brickinv mkdir -p \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs \
  || echo "[daten-rechte] WARNUNG: Datenverzeichnisse liessen sich als brickinv nicht anlegen (Eigentuemer des Datenordners?)." >&2

echo "[daten-rechte] fertig."
