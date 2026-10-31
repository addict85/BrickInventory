#!/bin/sh
set -e

# ── Warum hier ueberhaupt etwas ausgegeben wird ──────────────────────────────
#
# Marcos Befund: „Das Docker-Image scheint allgemein extrem lange zu benoetigen
# bis es startet. Meist dauert es um die 5min bis der 1. Log-Eintrag
# erscheint."
#
# Die erste Zeile des Servers steht unmittelbar nach den Importen
# (`[start] Prozess …, Rolle …`), und console.log schreibt synchron
# nach stdout. Wer minutenlang nichts sieht, sieht also nicht einen langsamen
# Server — er sieht ein Skript, das VOR dem Server laeuft und dabei schweigt.
#
# Deshalb sagt dieses Skript jetzt, was es tut. Eine Zeile beim Start kostet
# nichts und beantwortet die Frage „haengt es?" ohne Nachsehen.
echo "[entrypoint] Datenverzeichnisse werden vorbereitet …"

# Verzeichnisse der neuen Ordnung. instructions/shared und part_images sind
# entfallen (siehe src/infra/appPaths.ts).
mkdir -p \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs

# public/ gehoert nicht mehr dazu: Bilder liegen jetzt unter data/images/
# (siehe src/infra/appPaths.ts). public/ ist damit wieder read-only Build-Inhalt.

# ── Der Eigentuemerwechsel ist ein REPARATURSCHRITT, kein Startschritt ───────
#
# VORHER stand hier `chown -R brickinv:brickinv /app/data` — bei JEDEM Start.
#
# Noetig ist das genau einmal: wenn ein Datentraeger zum ersten Mal eingehaengt
# wird oder aus einer Installation mit einer anderen UID stammt. Danach gehoert
# ohnehin alles brickinv, und der Lauf schreibt zehntausende Male denselben
# Wert, den die Datei schon hat.
#
# Das ist nicht bloss ueberfluessig, sondern teuer, und zwar mit der Zahl der
# Dateien: data/images/ fuellt sich mit jedem Set-, Teile- und Minifiguren-Bild.
# Jede Aenderung an einem Inode ist auf einer SD-Karte oder einem
# Netzlaufwerk ein eigener Schreibvorgang mit eigener Quittung — bei 50'000
# Bildern sind das Minuten, und sie laufen vor der ersten Logzeile.
#
# Statt dessen: erst FRAGEN, dann reparieren.
#
#   BRICKINV_CHOWN=auto   (Vorgabe) sucht einen fremden Eintrag und repariert
#                         nur dann. `-print -quit` haelt beim ERSTEN Treffer an;
#                         im Normalfall ist es ein Durchlauf ohne einen
#                         einzigen Schreibvorgang.
#   BRICKINV_CHOWN=always erzwingt den vollen Lauf — fuer den Fall, dass die
#                         Suche etwas nicht sieht.
#   BRICKINV_CHOWN=never  laesst ihn ganz weg — fuer Einhaengungen, auf denen
#                         chown nichts bewirkt (SMB/CIFS mit festem uid).
ZIEL_UID=$(id -u brickinv)

# Die eben angelegten Verzeichnisse gehoeren root und sind immer zu richten.
# Es sind sieben Stueck; das kostet nichts und macht den Fall
# BRICKINV_CHOWN=never sicher.
# -h: Ein Symlink unter /app/data (der Ordner gehört der App) darf root nicht
# dazu bringen, das ZIEL umzuschreiben, etwa eine Datei ausserhalb.
chown -h brickinv:brickinv \
  /app/data \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs 2>/dev/null || true

# ── Die Marke: warum auch die SUCHE nicht bei jedem Start laufen soll ────────
#
# Marcos Rueckfrage: „Kann dieser Schritt mit den Dateien nicht erfolgen
# nachdem der Server gestartet ist?"
#
# Kann er nicht — jedenfalls nicht durch den Server: Der laeuft via su-exec als
# brickinv und darf gar nicht chownen. Moeglich waere nur, den Lauf PARALLEL
# als root weiterlaufen zu lassen. Das ist bewusst nicht gemacht (siehe unten).
#
# Die Frage dahinter — „warum kostet ein normaler Start ueberhaupt etwas?" —
# ist aber die richtige, und sie hat eine bessere Antwort als Nebenlaeufigkeit:
# gar nicht erst suchen. Die Suche schreibt zwar nichts, laeuft aber ueber jede
# Datei. Auf einem Netzlaufwerk ist schon das Durchgehen teuer — dort ist jede
# einzelne Abfrage ein Paket ueber das Netz.
#
# Deshalb eine Marke: Nach einem erfolgreichen Durchgang steht die Ziel-UID in
# einer Datei. Stimmt sie beim naechsten Start noch, ist nichts zu tun — ein
# Lesevorgang statt eines Durchlaufs.
#
# Was die Marke NICHT kann: Sie merkt nicht, wenn jemand von Hand fremde
# Dateien hineinlegt. Dafuer gibt es BRICKINV_CHOWN=always, und das ist der
# ehrlichere Handel als eine Suche, die bei jedem Start ueber zehntausende
# Dateien laeuft, um einen Fall abzudecken, den es im Betrieb nicht gibt.
MARKE=/app/data/.eigentuemer

berichtige() {
  echo "[entrypoint] Eigentuemer wird gesetzt — das kann bei vielen Bildern einige Minuten dauern."
  chown -R -h brickinv:brickinv /app/data
  echo "[entrypoint] Eigentuemer berichtigt."
}

# Die Marke schreiben. `|| true`, weil `set -e` sonst bei einem nur lesbar
# eingehaengten Datentraeger den ganzen Start abbraeche — die Marke ist eine
# Abkuerzung, kein Muss.
setzeMarke() {
  { printf '%s' "$ZIEL_UID" > "$MARKE" && chown -h brickinv:brickinv "$MARKE"; } 2>/dev/null || true
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
      # Der Normalfall nach dem ersten Start: nichts. Kein Durchlauf, kein
      # Schreibvorgang.
      :
    elif [ -n "$(find /app/data ! -uid "$ZIEL_UID" -print -quit 2>/dev/null)" ]; then
      # `-print -quit` haelt beim ERSTEN Treffer an — die Suche ist hier also
      # kurz, der Lauf danach lang.
      echo "[entrypoint] Fremde Eigentuemer gefunden."
      berichtige
      setzeMarke
    else
      # Nichts Fremdes da, aber noch keine Marke: einmalig setzen, damit auch
      # der naechste Start den Durchlauf spart.
      setzeMarke
    fi
    ;;
esac

# ── Wurzelzertifikat der internen CA (Caddy) ────────────────────────────────
# Caddy legt seine Dateien nur für root lesbar ab; der Server läuft als
# brickinv. Kopiert wird nur das öffentliche Zertifikat, nie ein Schlüssel.
# Beim ersten Start legt Caddy die CA womöglich erst nach uns an — dann holt
# eine Schleife im Hintergrund die Kopie bis zu zwei Minuten lang nach.
CA_QUELLE=/caddy-ca/root.crt
kopiereCa() {
  [ -f "$CA_QUELLE" ] || return 1
  mkdir -p "$(dirname "$CA_ZERTIFIKAT")" \
    && cp "$CA_QUELLE" "$CA_ZERTIFIKAT.neu" && chmod 644 "$CA_ZERTIFIKAT.neu" \
    && mv "$CA_ZERTIFIKAT.neu" "$CA_ZERTIFIKAT"
}
if [ -n "$CA_ZERTIFIKAT" ] && [ -d /caddy-ca ] && ! kopiereCa; then
  echo "[entrypoint] Wurzelzertifikat der CA noch nicht da — wird nachgeholt, sobald Caddy es anlegt."
  ( i=0; while [ "$i" -lt 120 ]; do kopiereCa && exit 0; sleep 1; i=$((i+1)); done ) &
fi

echo "[entrypoint] Server wird gestartet (Rolle ${ROLLE:-beides})."

# Drop to brick user and start
# dist/server.js statt server.js: Der Build schreibt seit der Umstellung nach
# dist/ (siehe Dockerfile und .gitignore), damit Quelle und Erzeugnis nicht
# mehr im selben Verzeichnis stehen.
exec su-exec brickinv node dist/server.js
