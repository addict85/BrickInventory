-- ════════════════════════════════════════════════════════════════════════════
-- KORREKTUR: Einträge mit Menge 0 bereinigen
--
-- Gegenstück zu scripts/befund-menge-null.sql. BITTE ZUERST DEN BEFUND LAUFEN
-- LASSEN und die Ausgabe ansehen — dieses Skript LÖSCHT Zeilen.
--
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory < scripts/korrektur-menge-null.sql
--
-- ── Was es tut ──────────────────────────────────────────────────────────────
--  1. REPARIEREN: Zeilen mit Menge 0, zu denen es noch Erfassungen gibt,
--     bekommen die Summe dieser Erfassungen. Hier geht nichts verloren — die
--     Menge stand nur falsch.
--  2. LÖSCHEN: Zeilen mit Menge 0 OHNE Erfassung. Das sind die Geister aus der
--     Zeit vor hardened-180. Bei Sets gehen die daran hängenden Teile,
--     Minifiguren und (leeren) Erfassungslisten mit — dieselben vier Tabellen
--     wie beim regulären Löschen (deleteSetRows in utils/handlers.ts).
--
-- ── Was es NICHT tut ────────────────────────────────────────────────────────
-- Es fasst KEINE Zeile mit Menge > 0 an, und es setzt keine Menge auf die
-- Erfassungssumme, wenn die Menge positiv ist. Das wäre gefährlich: Ein Set
-- aus einem alten Import kann eine Menge ohne Erfassungen haben, und die
-- Summe wäre dann 0 — das Skript würde einen echten Bestand vernichten.
-- Deshalb ist `quantity <= 0` in JEDER Bedingung die Eintrittskarte.
--
-- ── Sicherheit ──────────────────────────────────────────────────────────────
-- Alles läuft in EINER Transaktion. Bricht ein Schritt ab, ist nichts
-- geändert. Am Ende steht COMMIT.
--
-- Zum Probelauf ohne Änderung: die letzte Zeile von COMMIT auf ROLLBACK
-- ändern. Die Zählungen werden trotzdem ausgegeben — man sieht also genau,
-- was passieren WÜRDE.
--
-- Vorher eine Sicherung, wenn die Installation wichtig ist:
--   docker exec brickinventory-db pg_dump -U brickinventory brickinventory \
--     > sicherung-$(date +%F).sql
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ── Schritt 1: Mengen reparieren, wo es noch Erfassungen gibt ───────────────
WITH kandidaten AS (
  SELECT s.user_id, s.set_number,
         (SELECT SUM(a.quantity) FROM set_acquisitions a
           WHERE a.user_id = s.user_id AND a.set_number = s.set_number) AS neue_menge
    FROM sets s
   WHERE s.quantity <= 0
     AND EXISTS (SELECT 1 FROM set_acquisitions a
                  WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
),
korrigiert AS (
  UPDATE sets s SET quantity = k.neue_menge
    FROM kandidaten k
   WHERE s.user_id = k.user_id AND s.set_number = k.set_number
     AND k.neue_menge > 0
  RETURNING 1
)
SELECT COUNT(*) AS "Sets: Menge repariert" FROM korrigiert;

-- Dasselbe für manuelle Teile und Minifiguren.
WITH kandidaten AS (
  SELECT p.user_id, p.part_number, p.color_id,
         (SELECT SUM(x.quantity) FROM part_acquisitions x
           WHERE x.user_id = p.user_id AND x.part_number = p.part_number
             AND x.color_id = p.color_id) AS neue_menge
    FROM parts p
   WHERE p.source = 'manual' AND p.quantity <= 0
),
korrigiert AS (
  UPDATE parts p SET quantity = k.neue_menge
    FROM kandidaten k
   WHERE p.user_id = k.user_id AND p.part_number = k.part_number
     AND p.color_id = k.color_id AND k.neue_menge > 0
  RETURNING 1
)
SELECT COUNT(*) AS "Manuelle Teile: Menge repariert" FROM korrigiert;

WITH kandidaten AS (
  SELECT m.user_id, m.fig_number,
         (SELECT SUM(x.quantity) FROM minifig_acquisitions x
           WHERE x.user_id = m.user_id AND x.fig_number = m.fig_number) AS neue_menge
    FROM minifigs m
   WHERE m.source = 'manual' AND m.quantity <= 0
),
korrigiert AS (
  UPDATE minifigs m SET quantity = k.neue_menge
    FROM kandidaten k
   WHERE m.user_id = k.user_id AND m.fig_number = k.fig_number
     AND k.neue_menge > 0
  RETURNING 1
)
SELECT COUNT(*) AS "Manuelle Minifiguren: Menge repariert" FROM korrigiert;

-- ── Schritt 2: Geister löschen (Menge 0 UND keine Erfassung) ────────────────
--
-- Die Liste der Geister wird EINMAL festgehalten und in allen vier DELETEs
-- benutzt. Würde jedes DELETE seine eigene Bedingung auswerten, könnte das
-- erste (auf sets) die Grundlage der folgenden bereits weggenommen haben —
-- die Teile blieben dann liegen.
CREATE TEMP TABLE geister_sets ON COMMIT DROP AS
  SELECT s.user_id, s.set_number
    FROM sets s
   WHERE s.quantity <= 0
     AND NOT EXISTS (SELECT 1 FROM set_acquisitions a
                      WHERE a.user_id = s.user_id AND a.set_number = s.set_number);

SELECT COUNT(*) AS "Sets zu loeschen" FROM geister_sets;

WITH weg AS (
  DELETE FROM parts p USING geister_sets g
   WHERE p.user_id = g.user_id AND p.set_number = g.set_number
  RETURNING 1
) SELECT COUNT(*) AS "davon Teile-Zeilen" FROM weg;

WITH weg AS (
  DELETE FROM minifigs m USING geister_sets g
   WHERE m.user_id = g.user_id AND m.set_number = g.set_number
  RETURNING 1
) SELECT COUNT(*) AS "davon Minifiguren-Zeilen" FROM weg;

WITH weg AS (
  DELETE FROM set_acquisitions a USING geister_sets g
   WHERE a.user_id = g.user_id AND a.set_number = g.set_number
  RETURNING 1
) SELECT COUNT(*) AS "davon Erfassungen" FROM weg;

WITH weg AS (
  DELETE FROM sets s USING geister_sets g
   WHERE s.user_id = g.user_id AND s.set_number = g.set_number
  RETURNING 1
) SELECT COUNT(*) AS "Sets geloescht" FROM weg;

-- Manuelle Teile und Minifiguren ohne Erfassung.
WITH weg AS (
  DELETE FROM parts p
   WHERE p.source = 'manual' AND p.quantity <= 0
     AND NOT EXISTS (SELECT 1 FROM part_acquisitions x
                      WHERE x.user_id = p.user_id AND x.part_number = p.part_number
                        AND x.color_id = p.color_id)
  RETURNING 1
) SELECT COUNT(*) AS "Manuelle Teile geloescht" FROM weg;

WITH weg AS (
  DELETE FROM minifigs m
   WHERE m.source = 'manual' AND m.quantity <= 0
     AND NOT EXISTS (SELECT 1 FROM minifig_acquisitions x
                      WHERE x.user_id = m.user_id AND x.fig_number = m.fig_number)
  RETURNING 1
) SELECT COUNT(*) AS "Manuelle Minifiguren geloescht" FROM weg;

-- ── Schritt 3: Kontrolle ────────────────────────────────────────────────────
-- Muss überall 0 sein. Steht hier etwas anderes, bitte NICHT committen.
SELECT (SELECT COUNT(*) FROM sets     WHERE quantity <= 0)                        AS "Sets mit Menge <= 0",
       (SELECT COUNT(*) FROM parts    WHERE source='manual' AND quantity <= 0)    AS "Man. Teile <= 0",
       (SELECT COUNT(*) FROM minifigs WHERE source='manual' AND quantity <= 0)    AS "Man. Minifiguren <= 0";

-- Zum Probelauf: COMMIT durch ROLLBACK ersetzen.
COMMIT;
