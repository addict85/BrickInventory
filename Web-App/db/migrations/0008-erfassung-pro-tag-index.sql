-- ── Ein Kaufpreis je Tag, Element und Benutzer — jetzt als Index ────────────
--
-- Die Regel gibt es seit hardened-94; durchgesetzt hat sie bisher allein
-- recordAcquisitionForDay() in utils/acquisitions.ts. Im Code stand dazu die
-- Notiz, ein UNIQUE-Index sei unmöglich, weil `timestamptz::date` nicht
-- IMMUTABLE ist. Das stimmt — aber `(created_at AT TIME ZONE 'UTC')::date` ist
-- es, und genau dieser Kniff steht seit 0007 schon in price_history.
--
-- Warum das mehr ist als Kosmetik: Der Helfer liest erst und schreibt dann.
-- Zwei gleichzeitige Anfragen lesen beide „keine Zeile für heute" und legen
-- beide eine an. Am laufenden Server nachgestellt — zehn parallele Erfassungen
-- desselben Sets ergaben:
--
--   sets.quantity     = 10        (richtig)
--   set_acquisitions  = 3 Zeilen, Summe 7
--
-- Also drei Tageszeilen statt einer, und drei verlorene Exemplare. Die
-- Finanzzahlen kommen aus den Erfassungen — der Bestand sagte 10, die
-- Kaufpreise sagten 7.
--
-- Die Sperre im Erfassen-Pfad (routes/sets.ts, withInventoryLock) verhindert
-- das Rennen. Der Index ist das Netz darunter: Er gilt auch für Wege, die
-- jemand später hinzufügt und dabei die Sperre vergisst.
--
-- Altbestand: Doppelte Tageszeilen werden vorher zusammengefasst — Mengen
-- addiert, Preis mengengewichtet gemittelt, Zustand nach Projektregel
-- (gebraucht gewinnt). Das ist dieselbe Rechnung, die recordAcquisitionForDay()
-- beim Aufstocken anwendet; es geht nichts verloren.

-- ── Sets ────────────────────────────────────────────────────────────────────
WITH gruppen AS (
  SELECT user_id, set_number, (created_at AT TIME ZONE 'UTC')::date AS tag,
         MIN(id)                                                     AS behalten,
         SUM(quantity)                                               AS menge,
         SUM(COALESCE(purchase_price,0) * quantity)
           / NULLIF(SUM(CASE WHEN purchase_price IS NULL THEN 0 ELSE quantity END), 0) AS preis,
         MAX(CASE WHEN condition = 'U' THEN 1 ELSE 0 END)             AS gebraucht
    FROM set_acquisitions
   GROUP BY 1,2,3 HAVING COUNT(*) > 1
)
UPDATE set_acquisitions a
   SET quantity       = g.menge,
       purchase_price = ROUND(g.preis, 4),
       condition      = CASE WHEN g.gebraucht = 1 THEN 'U' ELSE 'N' END
  FROM gruppen g
 WHERE a.id = g.behalten;

DELETE FROM set_acquisitions a
 USING set_acquisitions b
 WHERE a.user_id = b.user_id AND a.set_number = b.set_number
   AND (a.created_at AT TIME ZONE 'UTC')::date = (b.created_at AT TIME ZONE 'UTC')::date
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_set_acq_tag
  ON set_acquisitions (user_id, set_number, ((created_at AT TIME ZONE 'UTC')::date));

-- ── Manuelle Teile ──────────────────────────────────────────────────────────
WITH gruppen AS (
  SELECT user_id, part_number, color_id, (created_at AT TIME ZONE 'UTC')::date AS tag,
         MIN(id) AS behalten, SUM(quantity) AS menge,
         SUM(COALESCE(unit_price,0) * quantity)
           / NULLIF(SUM(CASE WHEN unit_price IS NULL THEN 0 ELSE quantity END), 0) AS preis,
         MAX(CASE WHEN condition = 'U' THEN 1 ELSE 0 END) AS gebraucht
    FROM part_acquisitions
   GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
)
UPDATE part_acquisitions a
   SET quantity   = g.menge,
       unit_price = ROUND(g.preis, 4),
       condition  = CASE WHEN g.gebraucht = 1 THEN 'U' ELSE 'N' END
  FROM gruppen g
 WHERE a.id = g.behalten;

DELETE FROM part_acquisitions a
 USING part_acquisitions b
 WHERE a.user_id = b.user_id AND a.part_number = b.part_number AND a.color_id = b.color_id
   AND (a.created_at AT TIME ZONE 'UTC')::date = (b.created_at AT TIME ZONE 'UTC')::date
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_part_acq_tag
  ON part_acquisitions (user_id, part_number, color_id, ((created_at AT TIME ZONE 'UTC')::date));

-- ── Manuelle Minifiguren ────────────────────────────────────────────────────
WITH gruppen AS (
  SELECT user_id, fig_number, (created_at AT TIME ZONE 'UTC')::date AS tag,
         MIN(id) AS behalten, SUM(quantity) AS menge,
         SUM(COALESCE(unit_price,0) * quantity)
           / NULLIF(SUM(CASE WHEN unit_price IS NULL THEN 0 ELSE quantity END), 0) AS preis,
         MAX(CASE WHEN condition = 'U' THEN 1 ELSE 0 END) AS gebraucht
    FROM minifig_acquisitions
   GROUP BY 1,2,3 HAVING COUNT(*) > 1
)
UPDATE minifig_acquisitions a
   SET quantity   = g.menge,
       unit_price = ROUND(g.preis, 4),
       condition  = CASE WHEN g.gebraucht = 1 THEN 'U' ELSE 'N' END
  FROM gruppen g
 WHERE a.id = g.behalten;

DELETE FROM minifig_acquisitions a
 USING minifig_acquisitions b
 WHERE a.user_id = b.user_id AND a.fig_number = b.fig_number
   AND (a.created_at AT TIME ZONE 'UTC')::date = (b.created_at AT TIME ZONE 'UTC')::date
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_minifig_acq_tag
  ON minifig_acquisitions (user_id, fig_number, ((created_at AT TIME ZONE 'UTC')::date));
