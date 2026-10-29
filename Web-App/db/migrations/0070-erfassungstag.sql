-- Der Tag einer Erfassung in der Zeitzone der Installation statt in UTC.
-- Mit (created_at AT TIME ZONE 'UTC')::date fiel ein Kauf um 00:30 in
-- Zürich (22:30/23:30 UTC) auf den Vortag und wurde mit dessen Käufen
-- zusammengelegt. Der Tag steht jetzt in `tag`; der Trigger füllt ihn aus der
-- Sitzungseinstellung brickinventory.zeitzone, die der Server je Verbindung
-- setzt (db/database.ts), ohne sie in UTC. Alte Zeilen behalten tag = NULL
-- und damit ihren bisherigen UTC-Tag: Ein Nachtragen wäre ein UPDATE jeder
-- Zeile und scheiterte an Altbestand, den 0065 bewusst ungeprüft liess.
CREATE FUNCTION erfassung_tag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.tag IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at
         AND NEW.tag IS NOT DISTINCT FROM OLD.tag) THEN
    NEW.tag := (NEW.created_at AT TIME ZONE
                COALESCE(NULLIF(current_setting('brickinventory.zeitzone', true), ''), 'UTC'))::date;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE set_acquisitions ADD COLUMN tag date;
ALTER TABLE part_acquisitions ADD COLUMN tag date;
ALTER TABLE minifig_acquisitions ADD COLUMN tag date;

DROP INDEX idx_set_acq_tag_merkmale;
DROP INDEX idx_part_acq_tag_merkmale;
DROP INDEX idx_minifig_acq_tag_merkmale;
CREATE UNIQUE INDEX idx_set_acq_tag_merkmale ON set_acquisitions
  (user_id, set_number, (COALESCE(tag, (created_at AT TIME ZONE 'UTC')::date)), condition,
   COALESCE(purchase_price, -1), price_estimated, currency);
CREATE UNIQUE INDEX idx_part_acq_tag_merkmale ON part_acquisitions
  (user_id, part_number, color_id, (COALESCE(tag, (created_at AT TIME ZONE 'UTC')::date)), condition,
   COALESCE(unit_price, -1), price_estimated, currency);
CREATE UNIQUE INDEX idx_minifig_acq_tag_merkmale ON minifig_acquisitions
  (user_id, fig_number, (COALESCE(tag, (created_at AT TIME ZONE 'UTC')::date)), condition,
   COALESCE(unit_price, -1), price_estimated, currency);

CREATE TRIGGER set_acquisitions_tag BEFORE INSERT OR UPDATE ON set_acquisitions
  FOR EACH ROW EXECUTE FUNCTION erfassung_tag();
CREATE TRIGGER part_acquisitions_tag BEFORE INSERT OR UPDATE ON part_acquisitions
  FOR EACH ROW EXECUTE FUNCTION erfassung_tag();
CREATE TRIGGER minifig_acquisitions_tag BEFORE INSERT OR UPDATE ON minifig_acquisitions
  FOR EACH ROW EXECUTE FUNCTION erfassung_tag();
