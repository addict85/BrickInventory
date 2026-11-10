-- Name, Jahr, Thema und Teilezahl eines Sets stehen nur noch in rb_sets; zwei
-- Quellen widersprachen sich, und Sets aus der Katalogsuche hatten keine
-- set_catalog-Zeile (also kein lokales Bild). set_catalog ergänzt je rb_sets-Zeile
-- Bild, Brickset-ID und Figurenzahl (Figuren bleiben hier: Sets ausserhalb des
-- CSV haben kein Inventar). Sets, die das CSV nicht kennt, legt die Erfassung als
-- herkunft 'api' an; der Abgleich behält sie, solange ein Konto auf sie verweist.
ALTER TABLE rb_sets ADD COLUMN herkunft text NOT NULL DEFAULT 'csv'
  CONSTRAINT rb_sets_herkunft CHECK (herkunft IN ('csv', 'api'));

-- Bisher nur in set_catalog: die alten Werte ziehen um, das Thema über seinen Namen.
INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, herkunft)
SELECT sc.set_number, COALESCE(sc.name, 'Set ' || sc.set_number), sc.year,
       (SELECT t.id FROM rb_themes t WHERE t.name = sc.theme
         ORDER BY t.parent_id NULLS FIRST, t.id LIMIT 1),
       sc.pieces, 'api'
  FROM set_catalog sc
 WHERE NOT EXISTS (SELECT 1 FROM rb_sets r WHERE r.set_num = sc.set_number);

INSERT INTO set_catalog (set_number)
SELECT set_num FROM rb_sets WHERE set_num ~ '-[0-9]+$'
ON CONFLICT (set_number) DO NOTHING;

DROP VIEW set_stamm;
ALTER TABLE set_catalog
  DROP COLUMN name, DROP COLUMN year, DROP COLUMN theme, DROP COLUMN pieces,
  ADD CONSTRAINT set_catalog_rb_sets_fkey FOREIGN KEY (set_number)
    REFERENCES rb_sets (set_num) ON DELETE CASCADE;
