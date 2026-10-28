-- price_market liest kein Code mehr; die Marktpreise stehen in price_cache.
DROP TABLE IF EXISTS price_market;

-- Die Setliste führte Name, Kategorie, Farbe und Bild je Set noch einmal,
-- obwohl part_catalog und part_color_catalog sie je Teil bzw. Teil und Farbe
-- halten. Ihre Werte stammen aus Rebrickable: Sie füllen dort Lücken und
-- ersetzen einen eingetippten Platzhalter (dieselbe Regel wie mitHerkunft() in
-- utils/katalogPflege.ts). Danach behält die Setliste nur, was zum Set gehört.
INSERT INTO part_catalog (part_number, part_name, category_name)
SELECT DISTINCT ON (part_number) part_number, NULLIF(part_name, ''), NULLIF(NULLIF(category_name, ''), 'Unknown')
  FROM set_parts_catalog
 ORDER BY part_number, (NULLIF(part_name, '') IS NULL), updated_at DESC
ON CONFLICT (part_number) DO UPDATE SET
  part_name = CASE WHEN part_catalog.name_von IS NOT NULL AND EXCLUDED.part_name IS NOT NULL THEN EXCLUDED.part_name ELSE COALESCE(part_catalog.part_name, EXCLUDED.part_name) END,
  name_von = CASE WHEN part_catalog.name_von IS NOT NULL AND EXCLUDED.part_name IS NOT NULL OR part_catalog.part_name IS NULL THEN NULL ELSE part_catalog.name_von END,
  category_name = CASE WHEN part_catalog.kategorie_von IS NOT NULL AND EXCLUDED.category_name IS NOT NULL THEN EXCLUDED.category_name ELSE COALESCE(part_catalog.category_name, EXCLUDED.category_name) END,
  kategorie_von = CASE WHEN part_catalog.kategorie_von IS NOT NULL AND EXCLUDED.category_name IS NOT NULL OR part_catalog.category_name IS NULL THEN NULL ELSE part_catalog.kategorie_von END;

INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
SELECT DISTINCT ON (part_number, color_id) part_number, color_id, NULLIF(color_name, ''), NULLIF(color_hex, ''),
       NULLIF(image_url, ''), NULLIF(image_local, '')
  FROM set_parts_catalog
 ORDER BY part_number, color_id, (NULLIF(image_local, '') IS NULL), updated_at DESC
ON CONFLICT (part_number, color_id) DO UPDATE SET
  color_name = CASE WHEN part_color_catalog.farbname_von IS NOT NULL AND EXCLUDED.color_name IS NOT NULL THEN EXCLUDED.color_name ELSE COALESCE(part_color_catalog.color_name, EXCLUDED.color_name) END,
  farbname_von = CASE WHEN part_color_catalog.farbname_von IS NOT NULL AND EXCLUDED.color_name IS NOT NULL OR part_color_catalog.color_name IS NULL THEN NULL ELSE part_color_catalog.farbname_von END,
  color_hex = CASE WHEN part_color_catalog.farbcode_von IS NOT NULL AND EXCLUDED.color_hex IS NOT NULL THEN EXCLUDED.color_hex ELSE COALESCE(part_color_catalog.color_hex, EXCLUDED.color_hex) END,
  farbcode_von = CASE WHEN part_color_catalog.farbcode_von IS NOT NULL AND EXCLUDED.color_hex IS NOT NULL OR part_color_catalog.color_hex IS NULL THEN NULL ELSE part_color_catalog.farbcode_von END,
  image_url = CASE WHEN part_color_catalog.bild_von IS NOT NULL AND EXCLUDED.image_url IS NOT NULL THEN EXCLUDED.image_url ELSE COALESCE(part_color_catalog.image_url, EXCLUDED.image_url) END,
  bild_von = CASE WHEN part_color_catalog.bild_von IS NOT NULL AND EXCLUDED.image_url IS NOT NULL OR part_color_catalog.image_url IS NULL THEN NULL ELSE part_color_catalog.bild_von END,
  image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local);

ALTER TABLE set_parts_catalog RENAME TO set_teile;
ALTER INDEX set_parts_catalog_pkey RENAME TO set_teile_pkey;
ALTER INDEX idx_spc_set RENAME TO idx_set_teile_set;
ALTER TABLE set_teile
  DROP COLUMN part_name, DROP COLUMN color_name, DROP COLUMN color_hex,
  DROP COLUMN category_name, DROP COLUMN image_url, DROP COLUMN image_local;

-- Die Lesestellen sehen dieselben Spalten wie vorher — und wie vorher nur
-- geprüfte Werte: Ein eingetippter Platzhalter eines Kontos erscheint hier nicht.
CREATE VIEW set_parts_catalog AS
SELECT t.set_number, t.part_number,
       CASE WHEN pc.name_von IS NULL THEN pc.part_name END             AS part_name,
       t.color_id,
       CASE WHEN pcc.farbname_von IS NULL THEN pcc.color_name END      AS color_name,
       CASE WHEN pcc.farbcode_von IS NULL THEN pcc.color_hex END       AS color_hex,
       CASE WHEN pc.kategorie_von IS NULL THEN pc.category_name END    AS category_name,
       CASE WHEN pcc.bild_von IS NULL THEN pcc.image_url END           AS image_url,
       pcc.image_local,
       t.is_spare, t.quantity, t.updated_at
  FROM set_teile t
  LEFT JOIN part_catalog pc ON pc.part_number = t.part_number
  LEFT JOIN part_color_catalog pcc ON pcc.part_number = t.part_number AND pcc.color_id = t.color_id;
