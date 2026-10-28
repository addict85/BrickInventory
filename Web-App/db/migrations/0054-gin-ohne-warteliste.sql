-- Ohne Warteliste brauchen die Trigramm-Indizes der Teile-Zusammenfassung
-- kein VACUUM nach jedem Neuaufbau: Jeder Eintrag landet sofort im Index.
-- Das kostet beim Schreiben etwas, erspart aber den Lauf über die Tabelle
-- aller Konten.
ALTER INDEX idx_psum_blnumber_trgm SET (fastupdate = off);
ALTER INDEX idx_psum_name_trgm     SET (fastupdate = off);
ALTER INDEX idx_psum_number_trgm   SET (fastupdate = off);
