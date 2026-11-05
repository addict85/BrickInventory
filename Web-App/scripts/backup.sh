#!/bin/sh
# ── Sicherung von Datenbank und Laufzeitdaten ────────────────────────────────
#
# VORHER gab es keinen dokumentierten Weg. compose.yaml bindet ./pgdata direkt
# ins Hostverzeichnis — die naheliegende Idee, dieses Verzeichnis wegzukopieren,
# ergibt bei laufendem Postgres aber eine INKONSISTENTE Kopie, die sich im
# Ernstfall nicht zurückspielen lässt. Ein Backup, das erst beim Wiederherstellen
# als wertlos auffällt, ist schlimmer als gar keins.
#
# Dieses Skript macht stattdessen einen echten pg_dump im laufenden Betrieb
# (transaktional konsistent) und sichert data/ separat als Tar.
#
# Aufruf:
#   ./scripts/backup.sh                  → nach ./backups/
#   ./scripts/backup.sh /pfad/zum/ziel   → dorthin
#
# Cron-Beispiel (täglich um 3 Uhr, in der crontab von root – der Dienst schreibt
# nur für sich lesbar, siehe UPGRADE.md Abschnitt 39):
#   0 3 * * * cd /opt/brickinventory && ./scripts/backup.sh >> backup.log 2>&1
#
# Eine Sicherung ist ein GEHEIMNIS: Der Dump enthält alle Passwort-Hashes und,
# verschlüsselt, API-Schlüssel, SMTP-Passwort, Gutscheinnummern und -PINs und den zweiten
# Faktor. Darum entstehen Dateien und Verzeichnis nur für den Besitzer lesbar
# (umask 077), und ein offenes Ziel wird gemeldet.
#
# Der Schlüssel dazu (schluessel/datenschluessel, bei älteren Installationen
# data/.datenschluessel) kommt NICHT ins Archiv: Neben dem Dump machte er die
# Verschlüsselung wertlos. Mit BACKUP_SCHLUESSEL_ZIEL=<Ordner an einem anderen
# Ort> legt das Skript ihn dort ab; sonst meldet es ihn.
#
# Verschlüsselt ist die Vorgabe: Empfänger (öffentliche age-Schlüssel, age1…)
# aus ./backup-empfaenger.txt (einer je Zeile), BACKUP_AGE_EMPFAENGER_DATEI
# oder BACKUP_AGE_EMPFAENGER. Es entstehen nur *.age-Dateien; den privaten
# Schlüssel braucht erst restore.sh (BACKUP_AGE_IDENTITAET), er gehört nicht
# auf diesen Rechner. Ohne Empfänger sichert das Skript nichts, ausser mit
# ausdrücklichem BACKUP_KLARTEXT=ja (UPGRADE.md, Abschnitt 33).
set -eu
umask 077

AGE="${AGE:-age}"
VERSCHLUESSELN=""
if [ -z "${BACKUP_AGE_EMPFAENGER:-}" ] && [ -z "${BACKUP_AGE_EMPFAENGER_DATEI:-}" ] && [ -f ./backup-empfaenger.txt ]; then
  BACKUP_AGE_EMPFAENGER_DATEI=./backup-empfaenger.txt
fi
if [ -n "${BACKUP_AGE_EMPFAENGER:-}" ] || [ -n "${BACKUP_AGE_EMPFAENGER_DATEI:-}" ]; then
  command -v "$AGE" >/dev/null 2>&1 || { echo "[backup] FEHLER: age fehlt (apt install age) — nichts gesichert." >&2; exit 1; }
  if [ -n "${BACKUP_AGE_EMPFAENGER_DATEI:-}" ]; then
    [ -r "$BACKUP_AGE_EMPFAENGER_DATEI" ] || { echo "[backup] FEHLER: $BACKUP_AGE_EMPFAENGER_DATEI nicht lesbar." >&2; exit 1; }
  fi
  VERSCHLUESSELN=1
elif [ "${BACKUP_KLARTEXT:-}" = ja ]; then
  echo "[backup] WARNUNG: unverschlüsselt (BACKUP_KLARTEXT=ja) — der Dump enthält Konten, Passwort-Hashes und Sitzungen." >&2
else
  echo "[backup] FEHLER: kein Empfänger für die Verschlüsselung — nichts gesichert." >&2
  echo "[backup]   Auf einem ANDEREN Rechner: age-keygen -o backup-schluessel.txt; den öffentlichen" >&2
  echo "[backup]   Schlüssel (age1…) hier in ./backup-empfaenger.txt eintragen (UPGRADE.md, Abschnitt 33)." >&2
  echo "[backup]   Unverschlüsselt nur ausdrücklich: BACKUP_KLARTEXT=ja" >&2
  exit 1
fi
# Klartext entsteht nie am Ziel: Die Daten laufen direkt in age, dort liegt bis
# zum Umbenennen nur <datei>.teil. Im privaten Arbeitsordner (mktemp -d, 0700)
# steht nur das Ende des Dumps für die Prüfung der Endmarke.
ENDUNG=""; [ -z "$VERSCHLUESSELN" ] || ENDUNG=".age"
KLAR=$(mktemp -d)
TEIL=""
trap 'rm -rf "$KLAR"; [ -z "$TEIL" ] || rm -f "$TEIL"' EXIT
trap 'exit 1' HUP INT TERM
schreibe() {
  if [ -z "$VERSCHLUESSELN" ]; then cat > "$1"
  elif [ -n "${BACKUP_AGE_EMPFAENGER_DATEI:-}" ]; then "$AGE" -R "$BACKUP_AGE_EMPFAENGER_DATEI" -o "$1"
  else "$AGE" -r "$BACKUP_AGE_EMPFAENGER" -o "$1"
  fi
}
fertig() {
  [ -s "$TEIL" ] || { echo "[backup] FEHLER: $1 ist leer." >&2; exit 1; }
  mv "$TEIL" "$1"
  TEIL=""
  echo "[backup] gesichert → $1"
}

# Der Dienst legt seine Dateien nur für sich lesbar an (umask 077). Unter einem
# anderen Benutzer fehlten sie im Archiv; das fällt erst beim Wiederherstellen auf.
if [ -d data ]; then
  UNLESBAR=$( { find data \( -path data/img_proxy_cache -o -path data/.datenschluessel \) -prune -o -type f -print 2>"$KLAR/find" \
                | while IFS= read -r f; do [ -r "$f" ] || { echo "$f"; break; }; done; sed -n 1p "$KLAR/find"; } | sed -n 1p)
  if [ -n "$UNLESBAR" ]; then
    echo "[backup] FEHLER: data/ ist nicht vollständig lesbar ($UNLESBAR) — nichts gesichert." >&2
    echo "[backup]   Als root oder mit der UID des Dienstes ausführen (UPGRADE.md, Abschnitt 39)." >&2
    exit 1
  fi
fi

TARGET="${1:-./backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# Dienstnamen aus compose.yaml
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${PGUSER:-brickinventory}"
DB_NAME="${PGDATABASE:-brickinventory}"

mkdir -p "$TARGET"
# mkdir -p lässt ein bestehendes Verzeichnis, wie es ist — nur melden, nicht
# umstellen: Das Ziel kann ein geteiltes Laufwerk sein.
# (ls statt find -perm: dessen Schreibweise unterscheidet sich zwischen GNU,
# BusyBox und macOS.)
case "$(ls -ld "$TARGET")" in
  ???????---*) ;;
  *) echo "[backup] Warnung: $TARGET ist für andere Benutzer zugänglich — die Sicherung enthält Klartext-Schlüssel (chmod 700 \"$TARGET\")" >&2 ;;
esac

DB_DATEI="$TARGET/db_$STAMP.sql.gz$ENDUNG"
echo "[backup] Datenbank → $DB_DATEI"
# --clean --if-exists: Der Dump lässt sich in eine bestehende Datenbank
# einspielen, ohne sie vorher von Hand leeren zu müssen.
mkfifo "$KLAR/strom"
tail -c 1024 < "$KLAR/strom" > "$KLAR/ende" &
TEIL="$DB_DATEI.teil"
docker compose exec -T "$DB_SERVICE" \
  pg_dump --clean --if-exists -U "$DB_USER" "$DB_NAME" \
  | tee "$KLAR/strom" | gzip | schreibe "$TEIL"
wait

# POSIX-sh hat kein pipefail: Scheitert pg_dump, laufen gzip und age trotzdem
# durch. Ein vollständiger Dump endet immer mit dieser Marke; fehlt sie, räumt
# der trap die halbe Datei weg.
if ! tail -n 5 "$KLAR/ende" | grep -q 'PostgreSQL database dump complete'; then
  echo "[backup] FEHLER: Dump ist unvollständig (Endmarke fehlt) — nichts gesichert." >&2
  exit 1
fi
fertig "$DB_DATEI"

DATA_DATEI="$TARGET/data_$STAMP.tar.gz$ENDUNG"
echo "[backup] Laufzeitdaten → $DATA_DATEI"
# img_proxy_cache ist ein reiner Cache; wer die Bilder (data/images) nicht
# mitsichern will, nimmt sie ebenfalls in die Ausschlussliste auf.
TEIL="$DATA_DATEI.teil"
# Ohne pipefail trägt eine Datei den Status von tar aus der Pipe heraus.
{ tar czf - --exclude='data/img_proxy_cache' --exclude='data/.datenschluessel' data || echo $? > "$KLAR/tar"; } \
  | schreibe "$TEIL"
if [ -s "$KLAR/tar" ]; then
  echo "[backup] FEHLER: tar endete mit Status $(cat "$KLAR/tar") — data/ nicht gesichert." >&2
  exit 1
fi
fertig "$DATA_DATEI"

SCHLUESSEL=schluessel/datenschluessel
if [ ! -f "$SCHLUESSEL" ] && [ -f data/.datenschluessel ]; then
  SCHLUESSEL=data/.datenschluessel
  echo "[backup] Hinweis: Der Schlüssel liegt noch im Datenordner — Umzug nach schluessel/ steht in UPGRADE.md." >&2
fi
if [ ! -f "$SCHLUESSEL" ]; then
  echo "[backup] Hinweis: keine Schlüsseldatei — steht der Schlüssel in DATA_KEY, diesen getrennt aufbewahren." >&2
elif [ -n "${BACKUP_SCHLUESSEL_ZIEL:-}" ]; then
  mkdir -p "$BACKUP_SCHLUESSEL_ZIEL"
  if [ "$(cd "$BACKUP_SCHLUESSEL_ZIEL" && pwd)" = "$(cd "$TARGET" && pwd)" ]; then
    echo "[backup] Warnung: BACKUP_SCHLUESSEL_ZIEL ist das Sicherungsziel — der Schlüssel liegt dann wieder neben dem Dump." >&2
  fi
  cmp -s "$SCHLUESSEL" "$BACKUP_SCHLUESSEL_ZIEL/datenschluessel" 2>/dev/null \
    || cp "$SCHLUESSEL" "$BACKUP_SCHLUESSEL_ZIEL/datenschluessel"
  echo "[backup] Datenschlüssel → $BACKUP_SCHLUESSEL_ZIEL/datenschluessel"
else
  echo "[backup] ACHTUNG: $SCHLUESSEL ist NICHT in der Sicherung. Ohne ihn sind nach einem" >&2
  echo "[backup]   Wiederherstellen API-Schlüssel, SMTP-Passwort, Gutscheine (Nummer, PIN) und der zweite" >&2
  echo "[backup]   Faktor verloren. Einmal getrennt sichern oder BACKUP_SCHLUESSEL_ZIEL setzen." >&2
fi

echo "[backup] Alte Sicherungen (> $KEEP_DAYS Tage) entfernen"
find "$TARGET" \( -name 'db_*.sql.gz' -o -name 'db_*.sql.gz.age' \) -mtime "+$KEEP_DAYS" -delete
find "$TARGET" \( -name 'data_*.tar.gz' -o -name 'data_*.tar.gz.age' \) -mtime "+$KEEP_DAYS" -delete

echo "[backup] fertig:"
ls -lh "$TARGET" | tail -n 4

# ── Wiederherstellen ─────────────────────────────────────────────────────────
# Dafür gibt es jetzt ein eigenes Skript mit Vollständigkeitsprüfung und
# ON_ERROR_STOP (der hier früher gezeigte rohe psql-Aufruf meldete auch bei
# einem halben Dump Exit 0):
#
#   ./scripts/restore.sh backups/db_JJJJ-MM-TT_HHMM.sql.gz [backups/data_….tar.gz]
