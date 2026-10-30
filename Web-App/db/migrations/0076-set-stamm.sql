-- Ein Set hat drei Kataloge: set_catalog (beim Erfassen gefüllt, mit eigenem
-- Bild), rb_sets (Rebrickable-CSV) und catalog_cache (Abrufe bei BrickLink
-- und Rebrickable). Führend ist set_catalog; die anderen füllen nur Lücken.
-- Platzhalter wie „Set 10179-1“ zählen nicht als Name.
CREATE VIEW set_stamm AS
SELECT n.set_number,
       COALESCE(NULLIF(sc.name, 'Set ' || n.set_number), rb.name,
                NULLIF(cc.name, 'Set ' || n.set_number), sc.name, cc.name) AS name,
       COALESCE(sc.year, NULLIF(rb.year, 0), cc.year)                      AS year,
       COALESCE(sc.theme, th.name, cc.theme)                               AS theme,
       COALESCE(sc.pieces, rb.num_parts, cc.pieces)                        AS pieces,
       sc.minifigs,
       COALESCE(sc.image_url, NULLIF(rb.set_img_url, ''), cc.image_url)    AS image_url,
       sc.image_local,
       CASE WHEN sc.set_number IS NOT NULL THEN 'set_catalog'
            WHEN rb.set_num    IS NOT NULL THEN 'rb_sets'
            ELSE 'catalog_cache' END                                       AS herkunft
  FROM (SELECT set_number FROM set_catalog
        UNION SELECT set_num FROM rb_sets
        UNION SELECT set_number FROM catalog_cache) n
  LEFT JOIN set_catalog   sc ON sc.set_number = n.set_number
  LEFT JOIN rb_sets       rb ON rb.set_num    = n.set_number
  LEFT JOIN rb_themes     th ON th.id         = rb.theme_id
  LEFT JOIN catalog_cache cc ON cc.set_number = n.set_number;
