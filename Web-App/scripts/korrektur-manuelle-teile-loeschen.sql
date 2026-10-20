-- ════════════════════════════════════════════════════════════════════════════
-- KORREKTUR: manuell erfasste Teile löschen — alle ausser den genannten
--
-- Marcos Bitte vom 20.10.: „Es sollen alle Teile ausser die mit der Nummer
-- 31000 und 31001 gelöscht werden." Und, nachdem ein Shell-Skript daraus
-- geworden war, die naheliegende Rückfrage: „kann dies nicht einfach über ein
-- SQL-Delete statement gelöst werden?"
--
-- Kann es. Zwei DELETEs in einer Transaktion, und dieselbe Form, die dieser
-- Baum für solche Eingriffe schon kennt (scripts/korrektur-menge-null.sql):
--
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory < scripts/korrektur-manuelle-teile-loeschen.sql
--
-- Andere Nummern behalten, ohne die Datei anzufassen:
--
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory -v behalten=3001,3002 \
--     < scripts/korrektur-manuelle-teile-loeschen.sql
--
-- ── PROBELAUF: die letzte Zeile von COMMIT auf ROLLBACK ändern ──────────────
--
-- Die Zählungen werden trotzdem ausgegeben — man sieht genau, was passieren
-- WÜRDE, und geändert ist danach nichts. Erst wenn die Zahlen stimmen, mit
-- COMMIT laufen lassen. Löschen lässt sich nicht zurücknehmen.
--
-- Vorher eine Sicherung, wenn die Installation wichtig ist:
--   docker exec brickinventory-db pg_dump -U brickinventory brickinventory \
--     > sicherung-$(date +%F).sql
--
-- ── Was gelöscht wird ───────────────────────────────────────────────────────
--
-- Genau das, was auch der Löschknopf an der Kachel löscht (routes/api_v1/
-- parts.ts, loescheManuellesTeil in utils/handlers/shared.ts):
--
--   parts              die Bestandszeile, NUR mit source='manual'
--   part_acquisitions  ihre Kaufpreis-Erfassungen
--
-- Die Erfassungen müssen mit: Die Finanzsummen lesen sie, nicht die
-- Bestandszeile. Bleiben sie stehen, zählt der Kaufpreis eines gelöschten
-- Teils weiter mit.
--
-- ── Die REIHENFOLGE ist tragend ─────────────────────────────────────────────
--
-- Erst die Erfassungen, dann die Zeilen. part_acquisitions hat keine Spalte
-- `source` — welche Erfassung zu einer MANUELLEN Position gehört, lässt sich
-- nur über die Bestandszeile feststellen. Ist die zuerst weg, findet das
-- zweite DELETE seine Zeilen nicht mehr und die Kaufpreise bleiben liegen.
--
-- ── Was NICHT gelöscht wird, und warum ──────────────────────────────────────
--
--   parts mit source='set'    Teile AUS Sets. Sie hängen am Set und
--                             verschwinden mit ihm.
--   part_catalog              Name und Kategorie je Teilenummer,
--   part_color_catalog        Farbbezeichnung, Farbcode und Bild je Teil und
--                             Farbe,
--   bl_zuordnung              die BrickLink-Nummer je Teil,
--   part_price_cache/-history Markt- und Preisverlauf.
--
--   Das sind KATALOGE: Sie gelten für alle Konten, auch für Set-Teile und für
--   den nächsten Import, und jede Zeile darin hat einmal einen Abruf bei
--   Rebrickable oder BrickLink gekostet. Übrig bleibt eine Beschreibung ohne
--   Bestand — die sieht niemand, weil die Listen über parts gehen.
--
--   storage_locations         Der Vorrat an Lagerorten („Kiste 3"). Eine
--                             Angabe des Menschen, die das Teil überlebt.
--
-- ── Verglichen wird auch gegen die BrickLink-Nummer ─────────────────────────
--
-- Auf der Kachel steht die BrickLink-Nummer, soweit es eine abweichende gibt
-- (blNummerSql in utils/blZuordnung.ts). Wer „31000" von einer Kachel abliest,
-- meint diese Kachel — auch wenn die Rebrickable-Nummer daneben anders heisst.
-- Beide Nummern zählen deshalb als Treffer.
--
-- Das ist der eine Punkt, an dem ein handgeschriebenes
-- `DELETE … WHERE part_number NOT IN ('31000','31001')` daneben liegt: Es
-- löscht das Teil, dessen Kachel 31000 zeigt, weil es intern 3002 heisst.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\timing off

-- Vorgabe nur setzen, wenn nichts mitgegeben wurde: Ein `\set` ohne diese
-- Abfrage überschriebe ein `-v behalten=…` von der Kommandozeile — die
-- Datei würde dann etwas anderes tun, als der Aufruf sagt.
\if :{?behalten}
\else
  \set behalten '31000,31001'
\endif

\echo 'Es BLEIBEN diese Nummern (Teilenummer oder BrickLink-Nummer):'
\echo :behalten

BEGIN;

-- Die Auswahl EINMAL festhalten. Nicht aus Vorsicht, sondern weil beide
-- DELETEs dieselbe Menge treffen müssen und das zweite sie nach dem ersten
-- nicht mehr herleiten könnte (siehe „Die REIHENFOLGE ist tragend" oben).
-- ON COMMIT DROP: Die Tabelle lebt nur in dieser Transaktion.
CREATE TEMP TABLE weg ON COMMIT DROP AS
  SELECT p.user_id,
         p.part_number,
         COALESCE(p.color_id, 0) AS color_id
    FROM parts p
    LEFT JOIN bl_zuordnung z ON z.art = 'part' AND z.rb_id = p.part_number
   WHERE p.source = 'manual'
     AND LOWER(p.part_number) <> ALL (
           SELECT LOWER(TRIM(x)) FROM UNNEST(STRING_TO_ARRAY(:'behalten', ',')) x)
     AND LOWER(COALESCE(z.bl_id, p.part_number)) <> ALL (
           SELECT LOWER(TRIM(x)) FROM UNNEST(STRING_TO_ARRAY(:'behalten', ',')) x);

-- ── Was ist ausgewählt? ─────────────────────────────────────────────────────
SELECT u.username AS konto,
       COUNT(*) FILTER (WHERE p.source = 'manual') AS manuell_gesamt,
       -- `source = 'manual'` gehört in BEIDE Zählungen. Ohne das zählt eine
       -- Zeile mit, die gar nicht gelöscht wird: Steckt dasselbe Teil in
       -- derselben Farbe auch in einem Set, trägt die Set-Zeile dieselben drei
       -- Werte und passt damit auf die Auswahl — das DELETE unten lässt sie
       -- aber stehen. GEMESSEN: „marco 7/4" statt „7/3", und in der Liste
       -- darunter standen nur drei seiner Positionen.
       COUNT(*) FILTER (WHERE p.source = 'manual'
                          AND (p.user_id, p.part_number, COALESCE(p.color_id, 0))
                           IN (SELECT user_id, part_number, color_id FROM weg))
         AS wird_geloescht
  FROM parts p
  JOIN users u ON u.id = p.user_id
 GROUP BY u.username
HAVING COUNT(*) FILTER (WHERE p.source = 'manual') > 0
 ORDER BY u.username;

-- Mit dem Konto in der Zeile: Dieselbe Nummer kann in mehreren Konten stehen,
-- und ohne diese Spalte stünde sie hier zweimal untereinander, ohne dass man
-- sieht, warum (im Haushalt gemessen: 31000 bei Marco UND beim Kind).
SELECT u.username AS konto,
       w.part_number AS nummer, w.color_id AS farbe,
       COALESCE(pc.part_name, '—') AS name,
       COALESCE(pcc.color_name, '—') AS farbname
  FROM weg w
  JOIN users u ON u.id = w.user_id
  LEFT JOIN part_catalog pc ON pc.part_number = w.part_number
  LEFT JOIN part_color_catalog pcc ON pcc.part_number = w.part_number
                                  AND pcc.color_id = w.color_id
 ORDER BY u.username, w.part_number, w.color_id
 LIMIT 60;

-- ── Schritt 1: die Kaufpreis-Erfassungen ────────────────────────────────────
WITH geloescht AS (
  DELETE FROM part_acquisitions a
   USING weg w
   WHERE a.user_id = w.user_id
     AND a.part_number = w.part_number
     AND COALESCE(a.color_id, 0) = w.color_id
  RETURNING a.quantity
)
SELECT COUNT(*) AS "Erfassungen gelöscht",
       COALESCE(SUM(quantity), 0) AS "Stück darin"
  FROM geloescht;

-- ── Schritt 2: die Bestandszeilen ───────────────────────────────────────────
WITH geloescht AS (
  DELETE FROM parts p
   USING weg w
   WHERE p.user_id = w.user_id
     AND p.part_number = w.part_number
     AND COALESCE(p.color_id, 0) = w.color_id
     AND p.source = 'manual'
  RETURNING 1
)
SELECT COUNT(*) AS "Positionen gelöscht" FROM geloescht;

-- ── Was bleibt ──────────────────────────────────────────────────────────────
SELECT u.username AS konto,
       COUNT(*) AS manuell_uebrig,
       STRING_AGG(DISTINCT p.part_number, ', ' ORDER BY p.part_number) AS nummern
  FROM parts p
  JOIN users u ON u.id = p.user_id
 WHERE p.source = 'manual'
 GROUP BY u.username
 ORDER BY u.username;

-- Zum Probelauf: COMMIT durch ROLLBACK ersetzen.
COMMIT;

-- Die vorberechnete Teile-Zusammenfassung (parts_summary) führt NUR Set-Teile
-- (`source <> 'manual'`, utils/partsSummary.ts) — sie ist von diesem Löschen
-- nicht betroffen und braucht keinen Neuaufbau. Im Browser einmal neu laden.
