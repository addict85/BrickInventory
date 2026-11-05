-- ════════════════════════════════════════════════════════════════════════════
-- BEFUND: Einträge mit Menge 0 — NUR LESEN, ändert nichts
--
-- Vor dem Löschen des letzten Kaufpreises setzte der Server die Menge auf 0 und
-- liess die Zeile stehen (behoben in hardened-180). Solche Zeilen sind für die
-- Oberfläche unsichtbare Geister: Sie zählten in Galerie und Statistik mit, und
-- in der Bewertung machte `quantity || 1` aus der 0 wieder eine 1 — ein Set
-- ohne Bestand erhöhte damit den Portfoliowert.
--
-- Der Fix verhindert NEUE Geister. Diese Abfrage zeigt, welche ALTEN noch in
-- der Datenbank liegen.
--
-- Aufruf:
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory < scripts/befund-menge-null.sql
-- ════════════════════════════════════════════════════════════════════════════

\pset border 2
\echo ''
\echo '== 1. Sets mit Menge 0 =================================================='
\echo '   "loeschbar"  = keine Erfassung mehr da -> die Zeile kann weg'
\echo '   "reparabel"  = es gibt noch Erfassungen -> Menge stimmt nicht, wird'
\echo '                  auf deren Summe gesetzt (es geht nichts verloren)'
\echo ''

SELECT u.username                                        AS konto,
       s.set_number                                      AS setnummer,
       s.name                                            AS name,
       COALESCE(a.anzahl, 0)                             AS erfassungen,
       COALESCE(a.menge, 0)                              AS menge_laut_erfassungen,
       CASE WHEN COALESCE(a.anzahl,0) = 0 THEN 'loeschbar' ELSE 'reparabel' END AS befund
  FROM sets s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN (
    SELECT user_id, set_number, COUNT(*) AS anzahl, SUM(quantity) AS menge
      FROM set_acquisitions GROUP BY user_id, set_number
  ) a ON a.user_id = s.user_id AND a.set_number = s.set_number
 WHERE s.quantity <= 0
 ORDER BY befund, u.username, s.set_number;

\echo ''
\echo '== 2. Was an diesen Sets haengt (Teile und Minifiguren) ================='
\echo '   Sie werden beim Loeschen der Set-Zeile mitgenommen — sonst blieben'
\echo '   sie ohne Set zurueck und zaehlten in Teileliste und Summen weiter.'
\echo ''

SELECT u.username AS konto,
       s.set_number,
       (SELECT COUNT(*) FROM parts p
         WHERE p.user_id = s.user_id AND p.set_number = s.set_number)    AS teile_zeilen,
       (SELECT COUNT(*) FROM minifigs m
         WHERE m.user_id = s.user_id AND m.set_number = s.set_number)    AS minifig_zeilen
  FROM sets s
  JOIN users u ON u.id = s.user_id
 WHERE s.quantity <= 0
   AND NOT EXISTS (SELECT 1 FROM set_acquisitions a
                    WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
 ORDER BY u.username, s.set_number;

\echo ''
\echo '== 3. Manuelle Teile und Minifiguren mit Menge 0 ========================'
\echo ''

SELECT 'Teil'     AS art, u.username AS konto,
       p.part_number || ' (Farbe ' || p.color_id || ')' AS bezeichnung,
       (SELECT COUNT(*) FROM part_acquisitions x
         WHERE x.user_id = p.user_id AND x.part_number = p.part_number
           AND x.color_id = p.color_id)                  AS erfassungen
  FROM parts p JOIN users u ON u.id = p.user_id
 WHERE p.source = 'manual' AND p.quantity <= 0
UNION ALL
SELECT 'Minifigur', u.username, m.fig_number,
       (SELECT COUNT(*) FROM minifig_acquisitions x
         WHERE x.user_id = m.user_id AND x.fig_number = m.fig_number)
  FROM minifigs m JOIN users u ON u.id = m.user_id
 WHERE m.source = 'manual' AND m.quantity <= 0
 ORDER BY 1, 2, 3;

\echo ''
\echo '== 4. Zusammenfassung =================================================='
\echo ''

SELECT 'Sets loeschbar' AS was, COUNT(*) AS anzahl FROM sets s
 WHERE s.quantity <= 0
   AND NOT EXISTS (SELECT 1 FROM set_acquisitions a
                    WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
UNION ALL
SELECT 'Sets reparabel', COUNT(*) FROM sets s
 WHERE s.quantity <= 0
   AND EXISTS (SELECT 1 FROM set_acquisitions a
                WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
UNION ALL
SELECT 'Manuelle Teile loeschbar', COUNT(*) FROM parts p
 WHERE p.source = 'manual' AND p.quantity <= 0
   AND NOT EXISTS (SELECT 1 FROM part_acquisitions x
                    WHERE x.user_id = p.user_id AND x.part_number = p.part_number
                      AND x.color_id = p.color_id)
UNION ALL
SELECT 'Manuelle Minifiguren loeschbar', COUNT(*) FROM minifigs m
 WHERE m.source = 'manual' AND m.quantity <= 0
   AND NOT EXISTS (SELECT 1 FROM minifig_acquisitions x
                    WHERE x.user_id = m.user_id AND x.fig_number = m.fig_number);

\echo ''
