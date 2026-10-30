-- Name und Bild einer Figur stehen in minifigs_catalog, einmal je Figur.
-- set_minifigs_catalog führte sie je Set noch einmal, und Schreiber füllten
-- mal die eine, mal die andere Tabelle (das PDF nur die Setliste). Wie 0062
-- für Teile: Werte der Setliste füllen Lücken im Figurenkatalog und ersetzen
-- einen eingetippten Platzhalter; danach behält die Setliste nur die Menge.
INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local)
SELECT DISTINCT ON (fig_number) fig_number, NULLIF(fig_name, ''), NULLIF(image_url, ''), NULLIF(image_local, '')
  FROM set_minifigs_catalog
 ORDER BY fig_number, (NULLIF(image_local, '') IS NULL), (NULLIF(fig_name, '') IS NULL), updated_at DESC
ON CONFLICT (fig_number) DO UPDATE SET
  fig_name = CASE WHEN minifigs_catalog.name_von IS NOT NULL AND EXCLUDED.fig_name IS NOT NULL THEN EXCLUDED.fig_name ELSE COALESCE(minifigs_catalog.fig_name, EXCLUDED.fig_name) END,
  name_von = CASE WHEN minifigs_catalog.name_von IS NOT NULL AND EXCLUDED.fig_name IS NOT NULL OR minifigs_catalog.fig_name IS NULL THEN NULL ELSE minifigs_catalog.name_von END,
  image_url = CASE WHEN minifigs_catalog.bild_von IS NOT NULL AND EXCLUDED.image_url IS NOT NULL THEN EXCLUDED.image_url ELSE COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url) END,
  bild_von = CASE WHEN minifigs_catalog.bild_von IS NOT NULL AND EXCLUDED.image_url IS NOT NULL OR minifigs_catalog.image_url IS NULL THEN NULL ELSE minifigs_catalog.bild_von END,
  image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local);

CREATE TABLE set_figuren (
  set_number text NOT NULL,
  fig_number text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT set_figuren_pkey PRIMARY KEY (set_number, fig_number),
  CONSTRAINT set_figuren_menge_positiv CHECK (quantity > 0)
);
INSERT INTO set_figuren (set_number, fig_number, quantity, updated_at)
SELECT set_number, fig_number, GREATEST(COALESCE(quantity, 1), 1), COALESCE(updated_at, now())
  FROM set_minifigs_catalog;
CREATE INDEX idx_set_figuren_fig ON set_figuren (fig_number);

DROP TABLE set_minifigs_catalog;

-- Die Lesestellen sehen dieselben Spalten wie vorher, wie bei set_parts_catalog
-- nur geprüfte Werte: Ein eingetippter Platzhalter erscheint hier nicht.
CREATE VIEW set_minifigs_catalog AS
SELECT f.set_number, f.fig_number,
       CASE WHEN mc.name_von IS NULL THEN mc.fig_name END  AS fig_name,
       f.quantity,
       CASE WHEN mc.bild_von IS NULL THEN mc.image_url END AS image_url,
       mc.image_local, f.updated_at
  FROM set_figuren f
  LEFT JOIN minifigs_catalog mc ON mc.fig_number = f.fig_number;
