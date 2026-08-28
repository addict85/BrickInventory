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
# Cron-Beispiel (täglich um 3 Uhr):
#   0 3 * * * cd /opt/brickinventory && ./scripts/backup.sh >> backup.log 2>&1
set -eu

TARGET="${1:-./backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# Dienstnamen aus compose.yaml
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${PGUSER:-brickinventory}"
DB_NAME="${PGDATABASE:-brickinventory}"

mkdir -p "$TARGET"

echo "[backup] Datenbank → $TARGET/db_$STAMP.sql.gz"
# --clean --if-exists: Der Dump lässt sich in eine bestehende Datenbank
# einspielen, ohne sie vorher von Hand leeren zu müssen.
docker compose exec -T "$DB_SERVICE" \
  pg_dump --clean --if-exists -U "$DB_USER" "$DB_NAME" \
  | gzip > "$TARGET/db_$STAMP.sql.gz"

# ── Vollständigkeit prüfen — die wichtigste Zeile dieses Skripts ─────────────
#
# `set -eu` fängt in POSIX-sh KEINEN Fehler am ANFANG einer Pipe (kein
# pipefail): Scheitert pg_dump (Datenbank down, Platte voll, Dienstname
# falsch), läuft gzip trotzdem durch, hinterlässt eine kleine, formal GÜLTIGE
# .gz-Datei, und das Skript meldet Erfolg — per Cron wochenlang wertlose
# Sicherungen, ohne dass es jemand merkt. (Empirisch nachgestellt: Pipe-Kopf
# mit exit 1 → Skript läuft weiter, gunzip -t ist zufrieden.)
#
# Ein vollständiger pg_dump im Plain-Format endet IMMER mit der Zeile
# "-- PostgreSQL database dump complete". Fehlt sie, ist die Datei Schrott:
# löschen und laut scheitern, damit Cron-Mail/Log es zeigen.
if ! gunzip -c "$TARGET/db_$STAMP.sql.gz" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  echo "[backup] FEHLER: Dump ist unvollständig (Endmarke fehlt) — Datei wird gelöscht." >&2
  rm -f "$TARGET/db_$STAMP.sql.gz"
  exit 1
fi

echo "[backup] Laufzeitdaten → $TARGET/data_$STAMP.tar.gz"
# data/ enthält Uploads, Anleitungen und heruntergeladene Bilder.
# img_proxy_cache wird ausgelassen: reiner Cache, baut sich selbst wieder auf,
# und ist oft der grösste Posten.
# data/ enthält seit der Umstellung AUCH die Set-, Teile- und
# Minifiguren-Bilder (data/images/) — vorher lagen die in public/ und fehlten
# in jeder Sicherung. Das Archiv wird dadurch deutlich grösser; wer die Bilder
# nicht mitsichern will (sie lassen sich vom CDN neu holen), nimmt
# data/images ebenfalls in die Ausschlussliste auf.
tar czf "$TARGET/data_$STAMP.tar.gz" \
  --exclude='data/img_proxy_cache' \
  data 2>/dev/null || echo "[backup] Warnung: data/ nicht vollständig gesichert"

echo "[backup] Alte Sicherungen (> $KEEP_DAYS Tage) entfernen"
find "$TARGET" -name 'db_*.sql.gz'    -mtime "+$KEEP_DAYS" -delete
find "$TARGET" -name 'data_*.tar.gz'  -mtime "+$KEEP_DAYS" -delete

echo "[backup] fertig:"
ls -lh "$TARGET" | tail -n 4

# ── Wiederherstellen ─────────────────────────────────────────────────────────
# Dafür gibt es jetzt ein eigenes Skript mit Vollständigkeitsprüfung und
# ON_ERROR_STOP (der hier früher gezeigte rohe psql-Aufruf meldete auch bei
# einem halben Dump Exit 0):
#
#   ./scripts/restore.sh backups/db_JJJJ-MM-TT_HHMM.sql.gz [backups/data_….tar.gz]
