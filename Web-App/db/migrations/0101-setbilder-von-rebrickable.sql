-- Set-Bilder kommen von Rebrickable: Nur dort legt der Bild-Proxy sie samt
-- Vorschau unter images/sets ab. Frühere Rückfälle auf BrickLink oder Brickset
-- zeigen auf dieselbe feste CDN-Adresse des Sets; ein lokal abgelegtes Bild
-- bleibt, wie es ist.
UPDATE set_catalog
   SET image_url = 'https://cdn.rebrickable.com/media/sets/' || set_number || '.jpg',
       updated_at = NOW()
 WHERE image_url LIKE 'https://img.bricklink.com/%'
    OR image_url LIKE 'https://images.brickset.com/%';
