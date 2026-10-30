-- Die Zeitzone des Erfassungstags steht in global_settings statt in einer
-- Sitzungseinstellung: Die setzte nur der Pool des Servers; eigene
-- Verbindungen, Skripte und psql rechneten in UTC und legten denselben Kauf
-- auf einen anderen Tag. Der Server schreibt den konfigurierten Wert beim Start.
CREATE OR REPLACE FUNCTION erfassung_tag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.tag IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at
         AND NEW.tag IS NOT DISTINCT FROM OLD.tag) THEN
    NEW.tag := (NEW.created_at AT TIME ZONE
                COALESCE((SELECT NULLIF(value, '') FROM global_settings WHERE key = 'erfassung_zeitzone'), 'UTC'))::date;
  END IF;
  RETURN NEW;
END $$;
