-- ── Geldbeträge als NUMERIC statt REAL ──────────────────────────────────────
--
-- Alle Preisspalten lagen als REAL (32-Bit-Gleitkomma) in der Datenbank. Am
-- laufenden Server sichtbar: Ein Set mit Kaufpreis 49.90 kam als
-- "avg_purchase_price": 49.9000015258789 zurück, der Diagrammwert als
-- 49.900001525878906.
--
-- Schlimmer als die Anzeige ist das Rechnen. In Postgres nachgestellt:
--
--   SELECT SUM(p) FROM (SELECT 0.07::real AS p FROM generate_series(1,1000)) x
--     → 69.99974        (exakt wären 70.00)
--   SELECT (12.34::real * 3)::text
--     → 37.02000045776367
--
-- Der Fehler wächst mit der Zahl der Summanden — also mit der Sammlung. Genau
-- die Summen über alle Sets sind das, was der Finanzreiter anzeigt.
--
-- NUMERIC rechnet dezimal und exakt. Die Nachkommastellen: vier statt zwei,
-- weil Stückpreise einzelner Teile deutlich unter einem Rappen liegen können
-- (ein Standardstein in einer Sammelbestellung). Beträge mit zwei
-- Nachkommastellen bleiben davon unberührt und exakt.
--
-- Der USING-Ausdruck rundet den Altbestand auf vier Stellen. Aus den
-- gespeicherten 49.9000015258789 wird damit wieder 49.9000 — die Rundung
-- REPARIERT hier, sie verliert nichts: Der ursprünglich eingegebene Wert hatte
-- nie mehr Stellen, die Artefakte stammen erst aus der Speicherung als REAL.
--
-- Hinweis für den Code: Der pg-Treiber liefert NUMERIC als ZEICHENKETTE. Damit
-- sich das nicht durch hunderte Rechenstellen zieht, stellt db/database.ts
-- einen Typ-Parser ein, der NUMERIC wieder als JavaScript-Zahl ausliefert —
-- siehe die Begründung dort.

ALTER TABLE sets                  ALTER COLUMN purchase_price TYPE NUMERIC(12,4) USING ROUND(purchase_price::numeric, 4);
ALTER TABLE set_acquisitions      ALTER COLUMN purchase_price TYPE NUMERIC(12,4) USING ROUND(purchase_price::numeric, 4);

ALTER TABLE parts                 ALTER COLUMN purchase_price TYPE NUMERIC(12,4) USING ROUND(purchase_price::numeric, 4);
ALTER TABLE parts                 ALTER COLUMN unit_price     TYPE NUMERIC(12,4) USING ROUND(unit_price::numeric, 4);
ALTER TABLE part_acquisitions     ALTER COLUMN unit_price     TYPE NUMERIC(12,4) USING ROUND(unit_price::numeric, 4);

ALTER TABLE minifigs              ALTER COLUMN purchase_price TYPE NUMERIC(12,4) USING ROUND(purchase_price::numeric, 4);
ALTER TABLE minifigs              ALTER COLUMN unit_price     TYPE NUMERIC(12,4) USING ROUND(unit_price::numeric, 4);
ALTER TABLE minifig_acquisitions  ALTER COLUMN unit_price     TYPE NUMERIC(12,4) USING ROUND(unit_price::numeric, 4);

ALTER TABLE price_cache           ALTER COLUMN min_price     TYPE NUMERIC(12,4) USING ROUND(min_price::numeric, 4),
                                  ALTER COLUMN avg_price     TYPE NUMERIC(12,4) USING ROUND(avg_price::numeric, 4),
                                  ALTER COLUMN max_price     TYPE NUMERIC(12,4) USING ROUND(max_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);

ALTER TABLE price_history         ALTER COLUMN min_price     TYPE NUMERIC(12,4) USING ROUND(min_price::numeric, 4),
                                  ALTER COLUMN avg_price     TYPE NUMERIC(12,4) USING ROUND(avg_price::numeric, 4),
                                  ALTER COLUMN max_price     TYPE NUMERIC(12,4) USING ROUND(max_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);

ALTER TABLE price_market          ALTER COLUMN min_price     TYPE NUMERIC(12,4) USING ROUND(min_price::numeric, 4),
                                  ALTER COLUMN max_price     TYPE NUMERIC(12,4) USING ROUND(max_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);

ALTER TABLE part_price_cache      ALTER COLUMN avg_price     TYPE NUMERIC(12,4) USING ROUND(avg_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);

ALTER TABLE part_price_history    ALTER COLUMN avg_price     TYPE NUMERIC(12,4) USING ROUND(avg_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);

ALTER TABLE minifig_price_cache   ALTER COLUMN avg_price     TYPE NUMERIC(12,4) USING ROUND(avg_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);

ALTER TABLE minifig_price_history ALTER COLUMN avg_price     TYPE NUMERIC(12,4) USING ROUND(avg_price::numeric, 4),
                                  ALTER COLUMN qty_avg_price TYPE NUMERIC(12,4) USING ROUND(qty_avg_price::numeric, 4);
