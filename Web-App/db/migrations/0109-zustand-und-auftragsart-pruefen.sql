-- Zustand ist überall 'N' oder 'U'; die Erfassungstabellen prüfen das seit
-- langem, Merkliste, Preisalarm und die Preisspeicher nicht. Ein 'n' oder 'u '
-- verfehlte jeden Vergleich und stand neben dem richtigen Eintrag als zweiter.

-- Merkliste und Preisalarm: dieselbe Angabe in anderer Schreibweise wird
-- berichtigt, ausser es gibt den richtigen Eintrag schon (dann gilt dieser).
UPDATE wanted w SET condition = upper(btrim(w.condition))
 WHERE w.condition NOT IN ('N', 'U') AND upper(btrim(w.condition)) IN ('N', 'U')
   AND NOT EXISTS (SELECT 1 FROM wanted x WHERE x.user_id = w.user_id AND x.set_number = w.set_number
                      AND x.condition = upper(btrim(w.condition)))
   AND w.id = (SELECT min(y.id) FROM wanted y WHERE y.user_id = w.user_id AND y.set_number = w.set_number
                  AND upper(btrim(y.condition)) = upper(btrim(w.condition)));

UPDATE price_alerts a SET condition = upper(btrim(a.condition))
 WHERE a.condition NOT IN ('N', 'U') AND upper(btrim(a.condition)) IN ('N', 'U')
   AND NOT EXISTS (SELECT 1 FROM price_alerts x WHERE x.user_id = a.user_id AND x.set_number = a.set_number
                      AND x.condition = upper(btrim(a.condition)))
   AND a.ctid = (SELECT min(y.ctid) FROM price_alerts y WHERE y.user_id = a.user_id AND y.set_number = a.set_number
                    AND upper(btrim(y.condition)) = upper(btrim(a.condition)));

-- Was danach nicht passt, kann kein Leser finden; Preisspeicher füllt der nächste Abruf.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wanted', 'price_alerts', 'price_cache', 'price_history', 'part_price_cache',
                           'part_price_history', 'minifig_price_cache', 'minifig_price_history'] LOOP
    EXECUTE format('DELETE FROM %I WHERE condition NOT IN (''N'', ''U'')', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (condition IN (''N'', ''U''))', t, t || '_zustand');
  END LOOP;
END $$;

-- Auftragsarten als Nachschlagetabelle: Eine unbekannte Art fände keinen
-- Bearbeiter und bliebe für immer offen. Neue Arten kommen mit einer Migration
-- (der Test auftragsarten-db vergleicht mit AUFTRAGS_ARTEN).
CREATE TABLE auftrags_arten (art text PRIMARY KEY);
INSERT INTO auftrags_arten (art) VALUES
  ('nacharbeit'), ('bilder'), ('pdf'), ('csv_import'), ('wechselkurse'), ('anleitung'), ('brickset'),
  ('bildbedarf'), ('bilder_neu_laden'), ('nachlauf'), ('csv_sync'), ('preise'), ('bild_nachlauf'),
  ('aufraeumen'), ('aufraeumen_taeglich'), ('preise_nachladen'), ('konto_dateien');

DELETE FROM auftraege WHERE art NOT IN (SELECT art FROM auftrags_arten);
DELETE FROM auftrag_pausen WHERE art NOT IN (SELECT art FROM auftrags_arten);
ALTER TABLE auftraege ADD CONSTRAINT auftraege_art_fkey FOREIGN KEY (art) REFERENCES auftrags_arten (art);
ALTER TABLE auftrag_pausen ADD CONSTRAINT auftrag_pausen_art_fkey FOREIGN KEY (art) REFERENCES auftrags_arten (art);
