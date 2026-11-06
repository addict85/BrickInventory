-- Exklusive Auftragsarten: höchstens einer je Art läuft, auch über Prozesse.
-- Die Bedingung in belegeAuftrag sieht nur festgeschriebene Zeilen; zwei
-- Worker, die gleichzeitig belegen, sahen einander nicht. Der Trigger nimmt
-- je Art eine Transaktionssperre (LOCKS.AUFTRAG_EXKLUSIV = 59) und prüft
-- danach mit frischem Schnappschuss.
CREATE TABLE IF NOT EXISTS auftrag_exklusiv (
  art text PRIMARY KEY
);
INSERT INTO auftrag_exklusiv (art) VALUES
  ('anleitung'), ('brickset'), ('bildbedarf'), ('bilder_neu_laden'), ('csv_sync'),
  ('preise'), ('bild_nachlauf'), ('aufraeumen'), ('aufraeumen_taeglich')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auftrag_exklusiv_belegen() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auftrag_exklusiv e WHERE e.art = NEW.art) THEN RETURN NEW; END IF;
  -- Belegt gerade ein anderer: diese Zeile nicht, ohne zu warten.
  IF NOT pg_try_advisory_xact_lock(59, hashtext(NEW.art)) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM auftraege l
              WHERE l.art = NEW.art AND l.status = 'laeuft' AND l.frist_bis >= NOW() AND l.id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auftrag_exklusiv ON auftraege;
CREATE TRIGGER auftrag_exklusiv BEFORE UPDATE OF status, belegt_von ON auftraege
  FOR EACH ROW WHEN (NEW.status = 'laeuft' AND NEW.belegt_von IS DISTINCT FROM OLD.belegt_von)
  EXECUTE FUNCTION auftrag_exklusiv_belegen();
