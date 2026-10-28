-- Ein aus Teilepreisen geschätzter Figurenpreis ist als solcher markiert,
-- samt Anteil der Teile, die einen Preis hatten. Ohne die Spalte las
-- fetchMinifigPrice() eine Schätzung aus dem Cache als BrickLink-Preis.
ALTER TABLE minifig_price_cache   ADD COLUMN IF NOT EXISTS geschaetzt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE minifig_price_cache   ADD COLUMN IF NOT EXISTS abdeckung  NUMERIC(4,3);
ALTER TABLE minifig_price_history ADD COLUMN IF NOT EXISTS geschaetzt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE minifig_price_history ADD COLUMN IF NOT EXISTS abdeckung  NUMERIC(4,3);

-- Bisherige Schätzungen stehen unter der Rebrickable-Nummer (fig-…); unter
-- diesen Nummern liefert BrickLink nichts, ein echter Preis liegt dort nie.
UPDATE minifig_price_cache   SET geschaetzt = TRUE WHERE fig_number LIKE 'fig-%';
UPDATE minifig_price_history SET geschaetzt = TRUE WHERE fig_number LIKE 'fig-%';
