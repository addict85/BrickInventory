-- Indizes, deren Spalten der Anfang eines anderen Index derselben Tabelle
-- sind: Jede Suche, die sie bedienen, bedient der längere genauso, aber jeder
-- Schreibvorgang pflegt beide. Ermittelt über pg_index (gleiche Spalten in
-- gleicher Reihenfolge und Operatorklasse, B-Baum, ohne Teilbedingung).
DROP INDEX IF EXISTS idx_account_links_main;        -- account_links_pkey (main_user_id, sub_user_id)
DROP INDEX IF EXISTS idx_minifig_acq_gruppe;         -- idx_minifig_acq_tag_merkmale (user_id, fig_number, …)
DROP INDEX IF EXISTS idx_minifigs_user;              -- idx_minifigs_eindeutig (user_id, …)
DROP INDEX IF EXISTS idx_part_acq_gruppe;            -- idx_part_acq_tag_merkmale (user_id, part_number, color_id, …)
DROP INDEX IF EXISTS idx_parts_user;                 -- idx_parts_set, idx_parts_gruppe, idx_parts_color_id, idx_parts_eindeutig
DROP INDEX IF EXISTS idx_acq_user_set;               -- idx_set_acq_tag_merkmale (user_id, set_number, …)
DROP INDEX IF EXISTS idx_smc_set;                    -- set_minifigs_catalog_pkey (set_number, fig_number)
DROP INDEX IF EXISTS idx_set_teile_set;              -- set_teile_pkey (set_number, part_number, color_id)
DROP INDEX IF EXISTS idx_sets_user;                  -- sets_user_id_set_number_key (user_id, set_number)
DROP INDEX IF EXISTS idx_shared_instructions_set;    -- shared_instructions_set_number_url_key (set_number, url)
DROP INDEX IF EXISTS idx_vouchers_user;              -- vouchers_user_id_number_key (user_id, number)

-- minifigs_set_fk (user_id, set_number) → sets hatte keinen Index: Das
-- Löschen eines Sets suchte seine Figuren per Tabellenscan. Der eindeutige
-- Index führt set_number nur als COALESCE-Ausdruck und hilft dabei nicht.
CREATE INDEX idx_minifigs_set ON minifigs (user_id, set_number);

-- Dasselbe für pdf_auftraege_user_id_fkey: Der vorhandene Index gilt nur für
-- laufende Aufträge und hilft beim Löschen eines Kontos nicht.
CREATE INDEX idx_pdf_auftraege_user ON pdf_auftraege (user_id);
