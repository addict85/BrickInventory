#!/bin/sh
set -e

# ── Warum hier ueberhaupt etwas ausgegeben wird ──────────────────────────────
#
# Marcos Befund: „Das Docker-Image scheint allgemein extrem lange zu benoetigen
# bis es startet. Meist dauert es um die 5min bis der 1. Log-Eintrag
# erscheint."
#
# Die erste Zeile des Servers steht unmittelbar nach den Importen
# (`[cluster] Primary … starting N workers`), und console.log schreibt synchron
# nach stdout. Wer minutenlang nichts sieht, sieht also nicht einen langsamen
# Server — er sieht ein Skript, das VOR dem Server laeuft und dabei schweigt.
#
# Deshalb sagt dieses Skript jetzt, was es tut. Eine Zeile beim Start kostet
# nichts und beantwortet die Frage „haengt es?" ohne Nachsehen.
echo "[entrypoint] Datenverzeichnisse werden vorbereitet …"

# Verzeichnisse der neuen Ordnung. instructions/shared und part_images sind
# entfallen (siehe utils/appPaths.ts).
mkdir -p \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs

# public/ gehoert nicht mehr dazu: Bilder liegen jetzt unter data/images/
# (siehe utils/appPaths.ts). public/ ist damit wieder read-only Build-Inhalt.

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
chown brickinv:brickinv \
  /app/data \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs 2>/dev/null || true

case "${BRICKINV_CHOWN:-auto}" in
  never)
    echo "[entrypoint] Eigentuemerpruefung uebersprungen (BRICKINV_CHOWN=never)"
    ;;
  always)
    echo "[entrypoint] Eigentuemer wird vollstaendig gesetzt (BRICKINV_CHOWN=always) — das kann bei vielen Bildern dauern."
    chown -R brickinv:brickinv /app/data
    ;;
  *)
    if [ -n "$(find /app/data ! -uid "$ZIEL_UID" -print -quit 2>/dev/null)" ]; then
      echo "[entrypoint] Fremde Eigentuemer gefunden — wird einmalig berichtigt. Das kann bei vielen Bildern einige Minuten dauern."
      chown -R brickinv:brickinv /app/data
      echo "[entrypoint] Eigentuemer berichtigt."
    fi
    ;;
esac

echo "[entrypoint] Server wird gestartet."

# Drop to brick user and start
# dist/server.js statt server.js: Der Build schreibt seit der Umstellung nach
# dist/ (siehe Dockerfile und .gitignore), damit Quelle und Erzeugnis nicht
# mehr im selben Verzeichnis stehen.
exec su-exec brickinv node dist/server.js
