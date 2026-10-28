-- Teile und Figuren: ein Verlaufspunkt je Schlüssel und Tag (UTC), wie bei
-- Sets seit idx_price_history_tag. Ohne den Index lief ON CONFLICT DO NOTHING
-- ins Leere, und jeder Abruf setzte einen weiteren Punkt in die Kurve.
-- Behalten wird der erste Punkt des Tages — so, wie ihn der Index künftig
-- hält.
DELETE FROM part_price_history h
 USING part_price_history n
 WHERE n.part_number   = h.part_number
   AND n.color_id      = h.color_id
   AND n.condition     = h.condition
   AND n.currency_code = h.currency_code
   AND (n.recorded_at AT TIME ZONE 'UTC')::date = (h.recorded_at AT TIME ZONE 'UTC')::date
   AND (n.recorded_at, n.id) < (h.recorded_at, h.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_part_price_history_tag
  ON part_price_history (part_number, color_id, condition, currency_code,
                         ((recorded_at AT TIME ZONE 'UTC')::date));

DELETE FROM minifig_price_history h
 USING minifig_price_history n
 WHERE n.fig_number    = h.fig_number
   AND n.condition     = h.condition
   AND n.currency_code = h.currency_code
   AND (n.recorded_at AT TIME ZONE 'UTC')::date = (h.recorded_at AT TIME ZONE 'UTC')::date
   AND (n.recorded_at, n.id) < (h.recorded_at, h.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_minifig_price_history_tag
  ON minifig_price_history (fig_number, condition, currency_code,
                            ((recorded_at AT TIME ZONE 'UTC')::date));
