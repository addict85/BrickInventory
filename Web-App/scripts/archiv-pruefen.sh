#!/bin/sh
# Prüft ein data-Archiv von backup.sh, bevor restore.sh es entpackt: nur
# Dateien und Ordner unter data/, kein absoluter Pfad, kein "..", keine
# Verknüpfung. Ein untergeschobenes Archiv schriebe sonst über data/ hinaus,
# etwa über eine Verknüpfung data/x -> /etc und danach data/x/… .
set -eu

ARCHIV="${1:-}"
fehler() { echo "[restore] FEHLER: $ARCHIV $1 — Abbruch, nichts verändert." >&2; exit 1; }

[ -f "$ARCHIV" ] || fehler "existiert nicht"
tar tzf "$ARCHIV" >/dev/null 2>&1 || fehler "ist kein lesbares tar.gz"

namen=$(tar tzf "$ARCHIV")
[ -n "$namen" ] || fehler "ist leer"
if printf '%s\n' "$namen" | grep -Ev '^data(/|$)' >/dev/null; then
  fehler "enthält Einträge ausserhalb von data/"
fi
if printf '%s\n' "$namen" | grep -E '(^|/)\.\.(/|$)' >/dev/null; then
  fehler "enthält Pfade mit .."
fi
# Erstes Zeichen der ausführlichen Liste: - Datei, d Ordner; alles andere
# (l Verknüpfung, h harter Link, Geräte, FIFOs) hat in data/ nichts zu suchen.
if tar tzvf "$ARCHIV" | cut -c1 | grep -Ev '^[-d]$' >/dev/null; then
  fehler "enthält Verknüpfungen oder Sonderdateien"
fi
