-- ════════════════════════════════════════════════════════════════════════════
-- BEFUND: Welchen Lagerort haben die Sets? — NUR LESEN, ändert nichts
--
-- Gegenstück zu scripts/korrektur-lagerort-estrich.sql. Dieses Skript zeigt,
-- was das Korrekturskript ÄNDERN würde: je Konto, wie viele Sets schon im
-- Zielort liegen, wie viele noch gar keinen Ort haben und wie viele in einem
-- ANDEREN Ort stehen — Letztere sind die, die das Korrekturskript überschreibt.
--
-- Aufruf (Zielort ist Estrich, wie von Marco verlangt):
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory < scripts/befund-lagerort-estrich.sql
--
-- Anderer Zielort:
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory -v ort=Keller \
--     < scripts/befund-lagerort-estrich.sql
--
-- ── Warum der Befund die ANDEREN Orte einzeln nennt ─────────────────────────
--
-- „Alle Sets auf Estrich" ist leicht gesagt und trifft womöglich Zuordnungen,
-- die jemand bewusst gesetzt hat. Die Liste unten zeigt sie namentlich — wer
-- sie sieht, kann entscheiden, ob sie wirklich mitgehen sollen. Eine Zahl
-- allein („17 werden geändert") könnte das nicht.
-- ════════════════════════════════════════════════════════════════════════════

\if :{?ort}
\else
\set ort 'Estrich'
\endif

\pset border 2
\echo ''
\echo '== Zielort ============================================================='
\echo :'ort'
\echo ''
\echo '== 1. Sets je Konto ===================================================='
\echo '   "im_zielort"   = liegt schon dort, bleibt unberuehrt'
\echo '   "ohne_ort"     = noch kein Lagerort, bekommt den Zielort'
\echo '   "anderer_ort"  = steht woanders und wuerde UEBERSCHRIEBEN'
\echo ''

-- Der Lagerort steht seit Migration 0031 als ID an der Zeile; der Name
-- kommt aus dem Vorrat. LEFT JOIN, weil ein Set ohne Ort mitgezaehlt werden
-- muss — es ist der haeufigste Fall, den dieses Skript aendert.
SELECT u.username                                        AS konto,
       COUNT(*)                                          AS sets,
       COUNT(*) FILTER (WHERE l.name = :'ort')           AS im_zielort,
       COUNT(*) FILTER (WHERE s.storage_id IS NULL)      AS ohne_ort,
       COUNT(*) FILTER (WHERE s.storage_id IS NOT NULL
                          AND l.name <> :'ort')          AS anderer_ort
  FROM sets s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN storage_locations l ON l.id = s.storage_id
 GROUP BY u.username
 ORDER BY u.username;

\echo ''
\echo '== 2. Welche ANDEREN Orte betroffen waeren =============================='
\echo '   Diese Zuordnungen schreibt die Korrektur um. Leer = keine.'
\echo ''

SELECT u.username   AS konto,
       l.name       AS bisheriger_ort,
       COUNT(*)     AS sets
  FROM sets s
  JOIN users u ON u.id = s.user_id
  JOIN storage_locations l ON l.id = s.storage_id
 WHERE l.name <> :'ort'
 GROUP BY u.username, l.name
 ORDER BY u.username, COUNT(*) DESC, l.name;

\echo ''
\echo '== 3. Steht der Zielort schon im Vorrat? ================================'
\echo '   Der Vorrat (storage_locations) ist die Liste, aus der die Oberflaeche'
\echo '   waehlen laesst. Fehlt der Ort dort, zeigte sie einen Wert an, den sie'
\echo '   selbst nicht zur Wahl stellt — die Korrektur legt ihn deshalb an.'
\echo '   Hier stehen ALLE Konten; angelegt wird er nur in dem, das die'
\echo '   Korrektur ueber -v konto=... bekommt.'
\echo ''

SELECT u.username AS konto,
       CASE WHEN l.id IS NULL THEN 'fehlt' ELSE 'vorhanden' END AS vorrat
  FROM users u
  LEFT JOIN storage_locations l
         ON l.user_id = u.id AND lower(l.name) = lower(:'ort')
 ORDER BY u.username;

\echo ''
\echo '== 4. Teile und Minifiguren (werden NICHT angefasst) ===================='
\echo '   Marcos Vorgabe nennt die Sets. Hier steht nur, was daneben liegt —'
\echo '   damit niemand annimmt, die Korrektur haette alles mitgenommen.'
\echo ''

SELECT u.username                                            AS konto,
       COUNT(*) FILTER (WHERE p.storage_id IS NOT NULL)      AS teile_mit_ort,
       COUNT(*) FILTER (WHERE p.storage_id IS NULL)          AS teile_ohne_ort
  FROM parts p
  JOIN users u ON u.id = p.user_id
 GROUP BY u.username
 ORDER BY u.username;

SELECT u.username                                            AS konto,
       COUNT(*) FILTER (WHERE m.storage_id IS NOT NULL)      AS figuren_mit_ort,
       COUNT(*) FILTER (WHERE m.storage_id IS NULL)          AS figuren_ohne_ort
  FROM minifigs m
  JOIN users u ON u.id = m.user_id
 GROUP BY u.username
 ORDER BY u.username;

\echo ''
