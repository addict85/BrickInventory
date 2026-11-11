-- Set-Stammdaten standen dreifach (rb_sets, set_catalog, catalog_cache) und
-- widersprachen sich je nach Leser. Name, Jahr, Thema und Teile führt rb_sets,
-- das Bild set_catalog; catalog_cache behält nur, was BrickLink über die Nummer
-- sagt (is_gear, bl_type) und wann gefragt wurde.

-- Was nur ein Abruf kannte, zieht vorher um. Ein Platzhalter „Set …“ ohne weitere
-- Angabe ist keine; CSV-Zeilen bleiben, wie sie sind.
INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, herkunft)
SELECT cc.set_number, COALESCE(NULLIF(cc.name, ''), 'Set ' || cc.set_number), cc.year,
       (SELECT t.id FROM rb_themes t WHERE t.name = cc.theme
         ORDER BY t.parent_id NULLS FIRST, t.id LIMIT 1),
       cc.pieces, 'api'
  FROM catalog_cache cc
 WHERE COALESCE(cc.name, 'Set ' || cc.set_number) <> 'Set ' || cc.set_number
    OR cc.year IS NOT NULL OR cc.theme IS NOT NULL OR cc.pieces IS NOT NULL
ON CONFLICT (set_num) DO UPDATE SET
  name      = CASE WHEN rb_sets.name IS NULL OR rb_sets.name = 'Set ' || rb_sets.set_num
                   THEN EXCLUDED.name ELSE rb_sets.name END,
  year      = COALESCE(rb_sets.year, EXCLUDED.year),
  theme_id  = COALESCE(rb_sets.theme_id, EXCLUDED.theme_id),
  num_parts = COALESCE(rb_sets.num_parts, EXCLUDED.num_parts)
WHERE rb_sets.herkunft = 'api';

-- Die Bildadresse: set_catalog zuerst, dann das CSV, dann der Abruf — dieselbe
-- Reihenfolge, in der der Set-Stamm bisher las.
INSERT INTO set_catalog (set_number, image_url)
SELECT rs.set_num, COALESCE(NULLIF(rs.set_img_url, ''), NULLIF(cc.image_url, ''))
  FROM rb_sets rs
  LEFT JOIN catalog_cache cc ON cc.set_number = rs.set_num
 WHERE rs.set_num ~ '-[0-9]+$'
ON CONFLICT (set_number) DO UPDATE SET image_url = EXCLUDED.image_url, updated_at = NOW()
WHERE set_catalog.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL;

ALTER TABLE catalog_cache
  DROP COLUMN name, DROP COLUMN year, DROP COLUMN theme, DROP COLUMN pieces, DROP COLUMN image_url;
