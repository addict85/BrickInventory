-- Fehlende Bilddatei → CDN-Adresse: gesucht wird nach dem Dateinamen ohne
-- Ordner und Endung. Als LIKE '%/stamm.%' über alle Bildtabellen konnte das
-- keinen Index nutzen; mit dem Stamm als Ausdrucksindex ist es ein Indexzugriff
-- je Tabelle. Die Funktion ist IMMUTABLE und ohne Tabellenzugriff, damit sie
-- im Index stehen darf.
CREATE FUNCTION bild_stamm(pfad text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT regexp_replace(regexp_replace(pfad, '^.*/', ''), '\.[^.]*$', '') $$;

CREATE INDEX idx_part_color_catalog_bild_stamm ON part_color_catalog (bild_stamm(image_local)) WHERE image_local IS NOT NULL;
CREATE INDEX idx_minifigs_catalog_bild_stamm ON minifigs_catalog (bild_stamm(image_local)) WHERE image_local IS NOT NULL;
CREATE INDEX idx_set_minifigs_catalog_bild_stamm ON set_minifigs_catalog (bild_stamm(image_local)) WHERE image_local IS NOT NULL;
CREATE INDEX idx_set_catalog_bild_stamm ON set_catalog (bild_stamm(image_local)) WHERE image_local IS NOT NULL;
