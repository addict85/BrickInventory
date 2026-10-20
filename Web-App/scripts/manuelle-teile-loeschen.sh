#!/bin/sh
# ── Manuell erfasste Teile löschen — alle ausser den genannten Nummern ───────
#
# Marcos Bitte vom 20.10.: „Kannst du mir noch ein script erstellen um alle
# manuell erfassten Teile zu löschen via docker? Es sollen alle Teile ausser
# die mit der Nummer 31000 und 31001 gelöscht werden."
#
# Aufruf (im Verzeichnis mit der compose.yaml):
#
#   ./scripts/manuelle-teile-loeschen.sh 31000 31001        → nur ANZEIGEN
#   ./scripts/manuelle-teile-loeschen.sh --ja 31000 31001   → wirklich löschen
#
# Die Nummern sind die, die BLEIBEN. Ohne Nummer bricht das Skript ab: Ein
# leerer „ausser"-Teil würde alles löschen, und das soll niemand aus Versehen
# tippen können.
#
# ── Drei Wege zur Datenbank, dieselbe Arbeit ────────────────────────────────
#
# Das Skript läuft NICHT im App-Container: Das Laufzeit-Image enthält weder
# scripts/ (Dockerfile kopiert es nur in das Build-Stage) noch psql noch die
# Docker-CLI. Es gehört an die Stelle, von der aus auch `docker compose up`
# läuft — oder in den DATENBANK-Container, denn dort liegt psql.
#
#   1. Auf dem Host, neben der compose.yaml (Vorgabe, nichts einzurichten):
#
#        ./scripts/manuelle-teile-loeschen.sh 31000 31001
#
#      Jede Abfrage geht über `docker compose exec -T postgres psql` — genau
#      wie in scripts/backup.sh.
#
#   2. IM Datenbank-Container, ohne eine Datei dorthin zu kopieren: Das Skript
#      wird über die Standardeingabe hineingereicht (`sh -s --` gibt die
#      Argumente weiter).
#
#        docker compose exec -T postgres sh -s -- 31000 31001 \
#          < scripts/manuelle-teile-loeschen.sh
#
#      Drinnen gibt es keine Docker-CLI; das Skript merkt das und ruft psql
#      direkt auf. Erzwingen lässt sich das mit PSQL_DIREKT=1.
#
#   3. NUR MIT DOCKER, ohne compose — Marcos Weg. Entweder das Skript bleibt
#      auf dem Host und spricht über `docker exec` mit der Datenbank:
#
#        DB_CONTAINER=brickinventory-db ./scripts/manuelle-teile-loeschen.sh 31000 31001
#
#      … oder es wird in den Container gereicht (dann braucht es nicht einmal
#      den Containernamen im Skript, weil es drinnen schon ist):
#
#        docker exec -i brickinventory-db sh -s -- 31000 31001 \
#          < scripts/manuelle-teile-loeschen.sh
#
#      Den Namen des Datenbank-Containers zeigt `docker ps --format '{{.Names}}'`;
#      compose.yaml setzt ihn fest auf brickinventory-db.
#
# Ein Passwort braucht keiner der drei Wege: Über den lokalen Socket im
# Container ist die Anmeldung vertraut (`local all all trust` im offiziellen
# Postgres-Image) — dieselbe Voraussetzung, unter der scripts/backup.sh seit
# Monaten läuft.
#
# ── Was gelöscht wird ───────────────────────────────────────────────────────
#
# Genau das, was auch der Löschknopf an der Kachel löscht (routes/api_v1/
# parts.ts, loescheManuellesTeil in utils/handlers/shared.ts):
#
#   parts              die Bestandszeile, nur mit source='manual'
#   part_acquisitions  ihre Kaufpreis-Erfassungen
#
# Die Erfassungen MÜSSEN mit: part_acquisitions hat keine Spalte `source`, die
# Finanzsummen lesen aber die Erfassungen. Bleiben sie stehen, zählt der
# Kaufpreis eines gelöschten Teils weiter mit (dieselbe Begründung steht an der
# Löschroute, wo das `.catch(() => {})` deshalb bewusst fehlt).
#
# Welche Positionen gemeint sind, hält das Skript VORHER in einer temporären
# Tabelle fest. Das ist der Grund, warum die Reihenfolge der beiden DELETEs
# nichts mehr ausmacht: Ohne diese Liste müsste der zweite DELETE die Auswahl
# aus `parts` neu ableiten — und nach dem ersten wäre sie dort nicht mehr zu
# finden. Beides in EINER Transaktion, damit es keinen Zwischenzustand gibt, in
# dem die Hälfte weg ist.
#
# ── Was NICHT gelöscht wird, und warum ──────────────────────────────────────
#
#   parts mit source='set'    Teile AUS Sets. Sie hängen am Set und
#                             verschwinden mit ihm — hier geht es nur um die
#                             von Hand erfassten.
#   part_catalog              Name und Kategorie je Teilenummer,
#   part_color_catalog        Farbbezeichnung, Farbcode und Bild je Teil und
#                             Farbe,
#   bl_zuordnung              die BrickLink-Nummer je Teil,
#   part_price_cache/-history Markt- und Preisverlauf.
#
#   Das sind KATALOGE: Sie gelten für alle Konten, auch für Set-Teile und für
#   den nächsten Import, und jede Zeile darin hat einmal einen Abruf bei
#   Rebrickable oder BrickLink gekostet (Marcos Tageskontingent). Sie wegzuwerfen
#   würde nichts frei machen, aber beim nächsten Erfassen desselben Teils wieder
#   Abrufe kosten. Übrig bleibt eine Beschreibung ohne Bestand — die sieht
#   niemand, weil die Listen über parts gehen.
#
#   storage_locations         Der Vorrat an Lagerorten („Kiste 3"). Er ist eine
#                             Angabe des Menschen und überlebt das Teil.
#
# ── Vorher sichern ──────────────────────────────────────────────────────────
#
#   ./scripts/backup.sh
#
# Löschen lässt sich nicht zurücknehmen. Das Skript fragt nicht nach, es
# verlangt `--ja` — eine Rückfrage, die man mit der Eingabetaste wegklickt, ist
# keine.
set -eu

JA=0
BEHALTEN=""

for ARG in "$@"; do
  case "$ARG" in
    --ja)   JA=1 ;;
    -h|--help)
      echo "Aufruf: $0 [--ja] NUMMER [NUMMER ...]"
      echo "  Die genannten Teilenummern BLEIBEN, alle anderen manuell"
      echo "  erfassten Teile werden gelöscht. Ohne --ja wird nur angezeigt."
      exit 0 ;;
    -*)
      echo "Unbekannte Option: $ARG" >&2
      exit 2 ;;
    *)
      # Teilenummern sind Ziffern, Buchstaben, Punkt, Strich, Unterstrich
      # (z. B. 3001, 3001pr0001, 973c00). Alles andere wird abgewiesen, statt
      # es in das SQL zu schreiben: Diese Zeichenkette landet in einer Abfrage,
      # und eine Eingabe aus der Kommandozeile ist eine Eingabe von aussen.
      case "$ARG" in
        *[!A-Za-z0-9._-]*)
          echo "Unzulässige Teilenummer: $ARG" >&2
          exit 2 ;;
      esac
      BEHALTEN="$BEHALTEN $ARG" ;;
  esac
done

if [ -z "$BEHALTEN" ]; then
  echo "Keine Nummer angegeben — es ist nicht klar, was bleiben soll." >&2
  echo "Beispiel: $0 --ja 31000 31001" >&2
  echo "(Ohne Nummer hiesse es: alle ausser nichts, also alles. Das muss man" >&2
  echo " schreiben können, nicht vergessen können.)" >&2
  exit 2
fi

# Dienstnamen und Zugangsdaten wie in scripts/backup.sh — dieselbe compose.yaml,
# dieselben Vorgaben, dieselben Umgebungsvariablen zum Übersteuern.
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${PGUSER:-brickinventory}"
DB_NAME="${PGDATABASE:-brickinventory}"

# Aus „31000 31001" wird ('31000'),('31001') für eine VALUES-Liste. Jede Nummer
# ist oben geprüft, kleingeschrieben wird auf beiden Seiten verglichen.
WERTE=""
for NR in $BEHALTEN; do
  [ -n "$WERTE" ] && WERTE="$WERTE,"
  WERTE="$WERTE('$NR')"
done

# Die Auswahl steht EINMAL da und wird von Anzeige und Löschung benutzt — sonst
# zeigte die eine Abfrage etwas anderes, als die andere löscht.
#
# Verglichen wird gegen die Teilenummer UND gegen die BrickLink-Nummer: Auf der
# Kachel steht die BrickLink-Nummer, soweit es eine abweichende gibt
# (blNummerSql in utils/blZuordnung.ts). Wer „31000" von einer Kachel abliest,
# meint diese Kachel — auch wenn die Rebrickable-Nummer daneben anders heisst.
AUSWAHL="
  WITH behalten(nr) AS (VALUES $WERTE)
  SELECT p.user_id,
         p.part_number,
         COALESCE(p.color_id, 0) AS color_id,
         COALESCE(z.bl_id, p.part_number) AS bl_nummer
    FROM parts p
    LEFT JOIN bl_zuordnung z ON z.art = 'part' AND z.rb_id = p.part_number
   WHERE p.source = 'manual'
     AND LOWER(p.part_number) NOT IN (SELECT LOWER(nr) FROM behalten)
     AND LOWER(COALESCE(z.bl_id, p.part_number)) NOT IN (SELECT LOWER(nr) FROM behalten)
"

# Welcher der drei Wege gilt (siehe Kopf)? Die Entscheidung fällt EINMAL, damit
# die Meldung darunter sagt, was wirklich passiert — und nicht etwas, das bei
# der nächsten Abfrage anders gemacht wird.
#
# Die Erkennung ist absichtlich eine Frage nach dem WERKZEUG, nicht nach der
# Umgebung: „Gibt es hier eine Docker-CLI?" ist nachprüfbar, „läuft das in
# einem Container?" wäre geraten (/.dockerenv gibt es nicht in jeder Laufzeit).
if [ "${PSQL_DIREKT:-0}" = "1" ] || ! command -v docker >/dev/null 2>&1; then
  WEG="direkt"
elif [ -n "${DB_CONTAINER:-}" ]; then
  WEG="container"
else
  WEG="compose"
fi

# `command psql` und nicht `psql`: Die Funktion heisst selbst psql und riefe
# sich sonst endlos auf.
psql() {
  case "$WEG" in
    direkt)    command psql   -v ON_ERROR_STOP=1 -U "$DB_USER" "$DB_NAME" "$@" ;;
    container) docker exec -i "$DB_CONTAINER" \
                 psql -v ON_ERROR_STOP=1 -U "$DB_USER" "$DB_NAME" "$@" ;;
    *)         docker compose exec -T "$DB_SERVICE" \
                 psql -v ON_ERROR_STOP=1 -U "$DB_USER" "$DB_NAME" "$@" ;;
  esac
}

case "$WEG" in
  direkt)    echo "[teile] Datenbank $DB_NAME, psql direkt (im Container oder auf dem Host)" ;;
  container) echo "[teile] Datenbank $DB_NAME im Container $DB_CONTAINER" ;;
  *)         echo "[teile] Datenbank $DB_NAME im Dienst $DB_SERVICE (docker compose)" ;;
esac
echo "[teile] Es BLEIBEN:$BEHALTEN"
echo

echo "── Bestand je Konto ────────────────────────────────────────────────────"
psql -c "
  WITH weg AS ($AUSWAHL)
  SELECT u.username AS konto,
         COUNT(*) FILTER (WHERE p.source = 'manual') AS manuell_gesamt,
         COUNT(*) FILTER (WHERE p.source = 'manual'
                            AND (p.user_id, p.part_number, COALESCE(p.color_id, 0))
                             IN (SELECT user_id, part_number, color_id FROM weg)) AS wird_geloescht
    FROM parts p
    JOIN users u ON u.id = p.user_id
   GROUP BY u.username
   HAVING COUNT(*) FILTER (WHERE p.source = 'manual') > 0
   ORDER BY u.username"

echo "── Was gelöscht wird (die ersten 60 Positionen) ────────────────────────"
psql -c "
  WITH weg AS ($AUSWAHL)
  SELECT w.part_number AS nummer,
         NULLIF(w.bl_nummer, w.part_number) AS bl_nummer,
         w.color_id AS farbe,
         COALESCE(pcc.color_name, '—') AS farbname,
         COALESCE(pc.part_name, '—') AS name,
         (SELECT COUNT(*) FROM part_acquisitions a
           WHERE a.user_id = w.user_id AND a.part_number = w.part_number
             AND COALESCE(a.color_id, 0) = w.color_id) AS erfassungen
    FROM weg w
    LEFT JOIN part_catalog pc ON pc.part_number = w.part_number
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = w.part_number
                                    AND pcc.color_id = w.color_id
   ORDER BY w.part_number, w.color_id
   LIMIT 60"

echo "── Summe ───────────────────────────────────────────────────────────────"
psql -c "
  WITH weg AS ($AUSWAHL)
  SELECT (SELECT COUNT(*) FROM weg) AS positionen,
         (SELECT COUNT(*) FROM part_acquisitions a
           WHERE (a.user_id, a.part_number, COALESCE(a.color_id, 0))
              IN (SELECT user_id, part_number, color_id FROM weg)) AS erfassungen,
         (SELECT COALESCE(SUM(a.quantity), 0) FROM part_acquisitions a
           WHERE (a.user_id, a.part_number, COALESCE(a.color_id, 0))
              IN (SELECT user_id, part_number, color_id FROM weg)) AS stueck"

if [ "$JA" -ne 1 ]; then
  # Der vorgeschlagene Aufruf trägt den Weg mit, auf dem dieser Lauf gearbeitet
  # hat. Ohne das stünde hier ein Befehl, der über die VORGABE (docker compose)
  # geht — wer mit DB_CONTAINER gearbeitet hat, bekäme den Vorschlag, es anders
  # zu machen als gerade eben, und im schlimmsten Fall eine andere Datenbank.
  VORSATZ=""
  case "$WEG" in
    container) VORSATZ="DB_CONTAINER=$DB_CONTAINER " ;;
    direkt)    [ "${PSQL_DIREKT:-0}" = "1" ] && VORSATZ="PSQL_DIREKT=1 " ;;
  esac
  echo
  echo "[teile] NUR ANGEZEIGT — es wurde nichts geändert."
  echo "[teile] Zum Löschen denselben Aufruf mit --ja wiederholen:"
  echo "        $VORSATZ$0 --ja$BEHALTEN"
  echo "[teile] Vorher sichern:  ./scripts/backup.sh"
  exit 0
fi

echo
echo "[teile] LÖSCHEN …"

# Eine Transaktion, und die Auswahl darin EINMAL festgehalten: Zwischen den
# beiden DELETEs darf sich die Menge nicht mehr ändern, sonst bleiben
# Erfassungen ohne Bestandszeile stehen (oder umgekehrt).
#
# ON_COMMIT DROP: Die Tabelle lebt nur in dieser Sitzung und ist mit dem COMMIT
# weg — kein Aufräumen, das jemand vergessen kann.
psql <<SQL
BEGIN;

CREATE TEMP TABLE weg ON COMMIT DROP AS $AUSWAHL;

SELECT COUNT(*) AS "ausgewählte Positionen" FROM weg;

DELETE FROM part_acquisitions a
 USING weg w
 WHERE a.user_id = w.user_id
   AND a.part_number = w.part_number
   AND COALESCE(a.color_id, 0) = w.color_id;

DELETE FROM parts p
 USING weg w
 WHERE p.user_id = w.user_id
   AND p.part_number = w.part_number
   AND COALESCE(p.color_id, 0) = w.color_id
   AND p.source = 'manual';

COMMIT;
SQL

echo
echo "── Danach ──────────────────────────────────────────────────────────────"
psql -c "
  SELECT u.username AS konto,
         COUNT(*) AS manuell_uebrig,
         STRING_AGG(DISTINCT p.part_number, ', ' ORDER BY p.part_number) AS nummern
    FROM parts p
    JOIN users u ON u.id = p.user_id
   WHERE p.source = 'manual'
   GROUP BY u.username
   ORDER BY u.username"

# Die vorberechnete Teile-Zusammenfassung (parts_summary) führt NUR Set-Teile
# (`source <> 'manual'`, utils/partsSummary.ts) — sie ist von diesem Löschen
# nicht betroffen und braucht keinen Neuaufbau.
echo
echo "[teile] Fertig. Die Seite im Browser einmal neu laden."
