-- ── Pro Tag eine Erfassung — Altbestand zusammenfassen ──────────────────────
--
-- ── Warum ───────────────────────────────────────────────────────────────────
-- Ab utils/acquisitions.ts (recordAcquisitionForDay) entsteht je Eintrag und
-- Tag nur noch EINE Zeile: Wird am selben Tag erneut erfasst, wächst die
-- bestehende. Die Datums-Endpunkte für Sets, Teile und Minifiguren wiesen einen
-- zweiten Eintrag am selben Tag schon immer ab — die Anlege-Pfade taten es
-- nicht, und so sind Doppelzeilen entstanden.
--
-- Gemeldet an einem manuell erfassten Teil: zweimal „×1 · Neu · CHF 0.60 ·
-- 9.8.2026" untereinander im Detail-Dialog, richtig wäre eine Zeile mit
-- Menge 2. Diese Zeilen verschwinden nicht von selbst — die neue Regel greift
-- erst beim nächsten Schreiben. Deshalb dieser einmalige Lauf.
--
-- ── Wie zusammengefasst wird ────────────────────────────────────────────────
--   Menge     Summe.
--   Preis     Mengengewichteter Schnitt über die Zeilen MIT Preis. Zeilen ohne
--             Preis zählen nicht in den Nenner, sonst zöge eine preislose
--             Erfassung den Schnitt gegen null.
--   Zustand   „Gebraucht", sobald eine der Zeilen gebraucht war — dieselbe
--             Regel wie überall sonst (conditionFromAcquisitions in
--             utils/handlers.ts).
--   Zeit      Der früheste Zeitstempel des Tages; behalten wird die Zeile mit
--             der kleinsten id, die übrigen werden gelöscht.
--
-- ── Was NICHT passiert ──────────────────────────────────────────────────────
-- Es werden nur Zeilen desselben Tages und desselben Eintrags berührt. Käufe an
-- verschiedenen Tagen bleiben getrennt — sie sind der Grund, warum es die
-- Erfassungshistorie überhaupt gibt.
--
-- Der Lauf ist verlustbehaftet: Zwei Zustände am selben Tag werden zu einem.
-- Genau das ist die Vorgabe („zwei Erfassungen mit unterschiedlichen Zuständen
-- an einem Tag darf es gar nicht geben"), und ohne diesen Schritt bliebe der
-- Bestand in einem Zustand, den der Code nicht mehr erzeugen kann.

-- ── Sets ────────────────────────────────────────────────────────────────────
WITH gruppen AS (
  SELECT user_id, set_number, created_at::date AS tag,
         MIN(id)                                AS behalten,
         SUM(quantity)                          AS menge,
         SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL)::numeric
           / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL), 0) AS preis,
         MAX(CASE WHEN condition = 'U' THEN 1 ELSE 0 END) AS gebraucht,
         MIN(created_at)                        AS zeitpunkt
    FROM set_acquisitions
   GROUP BY user_id, set_number, created_at::date
  HAVING COUNT(*) > 1
)
UPDATE set_acquisitions a
   SET quantity       = g.menge,
       purchase_price = COALESCE(g.preis, a.purchase_price),
       condition      = CASE WHEN g.gebraucht = 1 THEN 'U' ELSE 'N' END,
       created_at     = g.zeitpunkt
  FROM gruppen g
 WHERE a.id = g.behalten;

DELETE FROM set_acquisitions a
 USING (
   SELECT user_id, set_number, created_at::date AS tag, MIN(id) AS behalten
     FROM set_acquisitions
    GROUP BY user_id, set_number, created_at::date
   HAVING COUNT(*) > 1
 ) g
 WHERE a.user_id = g.user_id AND a.set_number = g.set_number
   AND a.created_at::date = g.tag AND a.id <> g.behalten;

-- ── Manuell erfasste Teile ──────────────────────────────────────────────────
WITH gruppen AS (
  SELECT user_id, part_number, color_id, created_at::date AS tag,
         MIN(id)                                AS behalten,
         SUM(quantity)                          AS menge,
         SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL)::numeric
           / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL), 0) AS preis,
         MAX(CASE WHEN condition = 'U' THEN 1 ELSE 0 END) AS gebraucht,
         MIN(created_at)                        AS zeitpunkt
    FROM part_acquisitions
   GROUP BY user_id, part_number, color_id, created_at::date
  HAVING COUNT(*) > 1
)
UPDATE part_acquisitions a
   SET quantity   = g.menge,
       unit_price = COALESCE(g.preis, a.unit_price),
       condition  = CASE WHEN g.gebraucht = 1 THEN 'U' ELSE 'N' END,
       created_at = g.zeitpunkt
  FROM gruppen g
 WHERE a.id = g.behalten;

DELETE FROM part_acquisitions a
 USING (
   SELECT user_id, part_number, color_id, created_at::date AS tag, MIN(id) AS behalten
     FROM part_acquisitions
    GROUP BY user_id, part_number, color_id, created_at::date
   HAVING COUNT(*) > 1
 ) g
 WHERE a.user_id = g.user_id AND a.part_number = g.part_number
   AND a.color_id = g.color_id
   AND a.created_at::date = g.tag AND a.id <> g.behalten;

-- ── Manuell erfasste Minifiguren ────────────────────────────────────────────
WITH gruppen AS (
  SELECT user_id, fig_number, created_at::date AS tag,
         MIN(id)                                AS behalten,
         SUM(quantity)                          AS menge,
         SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL)::numeric
           / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL), 0) AS preis,
         MAX(CASE WHEN condition = 'U' THEN 1 ELSE 0 END) AS gebraucht,
         MIN(created_at)                        AS zeitpunkt
    FROM minifig_acquisitions
   GROUP BY user_id, fig_number, created_at::date
  HAVING COUNT(*) > 1
)
UPDATE minifig_acquisitions a
   SET quantity   = g.menge,
       unit_price = COALESCE(g.preis, a.unit_price),
       condition  = CASE WHEN g.gebraucht = 1 THEN 'U' ELSE 'N' END,
       created_at = g.zeitpunkt
  FROM gruppen g
 WHERE a.id = g.behalten;

DELETE FROM minifig_acquisitions a
 USING (
   SELECT user_id, fig_number, created_at::date AS tag, MIN(id) AS behalten
     FROM minifig_acquisitions
    GROUP BY user_id, fig_number, created_at::date
   HAVING COUNT(*) > 1
 ) g
 WHERE a.user_id = g.user_id AND a.fig_number = g.fig_number
   AND a.created_at::date = g.tag AND a.id <> g.behalten;
