-- Set-Inhalte hängen am Set ihres Kontos. Bisher hielt nur der Code die
-- Zeilen zusammen (deleteSetRows löscht vier Tabellen von Hand); ein
-- vergessener Weg hinterliess Teile ohne Set. DEFERRABLE, weil Verschieben
-- und Neuanlage Inhalt und Set in wechselnder Reihenfolge schreiben — geprüft
-- wird erst beim COMMIT.
ALTER TABLE parts ADD CONSTRAINT parts_set_fk
  FOREIGN KEY (user_id, set_number) REFERENCES sets (user_id, set_number)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE minifigs ADD CONSTRAINT minifigs_set_fk
  FOREIGN KEY (user_id, set_number) REFERENCES sets (user_id, set_number)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE instructions ADD CONSTRAINT instructions_set_fk
  FOREIGN KEY (user_id, set_number) REFERENCES sets (user_id, set_number)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;

-- Geschlossene Wertemengen. NULL bleibt bei source erlaubt: Der Code liest
-- es als 'set' (COALESCE), ältere Zeilen tragen es.
ALTER TABLE parts    ADD CONSTRAINT parts_source_check    CHECK (source IN ('set', 'manual')) NOT VALID;
ALTER TABLE minifigs ADD CONSTRAINT minifigs_source_check CHECK (source IN ('set', 'manual')) NOT VALID;
ALTER TABLE instruction_queue ADD CONSTRAINT instruction_queue_status_check
  CHECK (status IN ('pending', 'done', 'failed')) NOT VALID;
ALTER TABLE csv_import_jobs ADD CONSTRAINT csv_import_jobs_status_check
  CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')) NOT VALID;

-- Bestehende Zeilen prüfen, wo sie sauber sind. Eine Altlast (etwa Teile
-- eines längst gelöschten Sets) hält die Migration nicht an: Der Schlüssel
-- gilt dann nur für neue Zeilen, und der Start meldet, welcher offen blieb.
DO $pruefen$
DECLARE
  k RECORD;
BEGIN
  FOR k IN SELECT * FROM (VALUES
      ('parts', 'parts_set_fk'), ('minifigs', 'minifigs_set_fk'),
      ('instructions', 'instructions_set_fk'),
      ('parts', 'parts_source_check'), ('minifigs', 'minifigs_source_check'),
      ('instruction_queue', 'instruction_queue_status_check'),
      ('csv_import_jobs', 'csv_import_jobs_status_check')) AS v(tabelle, name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', k.tabelle, k.name);
    EXCEPTION WHEN foreign_key_violation OR check_violation THEN
      RAISE WARNING '% bleibt ungeprüft: Altbestand verletzt ihn (%)', k.name, SQLERRM;
    END;
  END LOOP;
END $pruefen$;
