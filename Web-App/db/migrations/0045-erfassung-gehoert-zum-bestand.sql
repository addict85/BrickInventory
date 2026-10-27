-- Eine Set-Erfassung gehört zu einer Bestandszeile desselben Kontos. Bisher
-- hielten das drei Löschstellen von Hand zusammen; jetzt prüft es die
-- Datenbank. DEFERRABLE INITIALLY DEFERRED: Verschieben und Wiederherstellen
-- schreiben Bestand und Erfassungen in beliebiger Reihenfolge, geprüft wird
-- beim COMMIT. NO ACTION statt CASCADE: Das Löschen bleibt, wie es ist.
--
-- Vorher aufräumen, was die Regeln verletzt; eine Kopie liegt in der Sicherung
-- vor dieser Migration (Schema vor_migration_…).

-- Erfassungen ohne Bestandszeile sind unsichtbar — keine Ansicht zeigt sie.
DELETE FROM set_acquisitions a
 WHERE NOT EXISTS (SELECT 1 FROM sets s WHERE s.user_id = a.user_id AND s.set_number = a.set_number);

UPDATE set_acquisitions SET quantity = 1 WHERE quantity IS NULL;
DELETE FROM set_acquisitions WHERE quantity <= 0;
UPDATE set_acquisitions SET condition = 'N' WHERE condition IS NULL OR condition NOT IN ('N', 'U');

-- Ohne Datum umging eine Zeile den eindeutigen Index „eine Erfassung je Tag
-- und Zustand". Sie bekommt das Datum der Bestandszeile; gibt es an dem Tag
-- schon eine, wird sie dort hineingerechnet.
DO $$
DECLARE r RECORD; tag TIMESTAMPTZ; ziel INTEGER;
BEGIN
  FOR r IN SELECT a.* FROM set_acquisitions a WHERE a.created_at IS NULL LOOP
    SELECT COALESCE(s.added_at, NOW()) INTO tag FROM sets s
     WHERE s.user_id = r.user_id AND s.set_number = r.set_number;
    SELECT id INTO ziel FROM set_acquisitions
     WHERE user_id = r.user_id AND set_number = r.set_number AND id <> r.id
       AND created_at IS NOT NULL
       AND (created_at AT TIME ZONE 'UTC')::date = (tag AT TIME ZONE 'UTC')::date
       AND condition = r.condition;
    IF ziel IS NULL THEN
      UPDATE set_acquisitions SET created_at = tag WHERE id = r.id;
    ELSE
      UPDATE set_acquisitions SET quantity = quantity + r.quantity,
             purchase_price = COALESCE(purchase_price, r.purchase_price)
       WHERE id = ziel;
      DELETE FROM set_acquisitions WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE set_acquisitions
  ALTER COLUMN quantity   SET NOT NULL,
  ALTER COLUMN condition  SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ADD CONSTRAINT set_acquisitions_menge_positiv CHECK (quantity > 0),
  ADD CONSTRAINT set_acquisitions_zustand CHECK (condition IN ('N', 'U')),
  ADD CONSTRAINT set_acquisitions_bestand_fkey FOREIGN KEY (user_id, set_number)
    REFERENCES sets (user_id, set_number) DEFERRABLE INITIALLY DEFERRED;

-- Doppelt: database.ts legte sie an, Migration 0038 dieselben unter neuem Namen.
DROP INDEX IF EXISTS idx_part_acq_user_part;
DROP INDEX IF EXISTS idx_minifig_acq_user_fig;

-- Der Fremdschlüssel auf storage_locations (ON DELETE SET NULL) sucht beim
-- Löschen eines Lagerorts nach storage_id; die bestehenden Indizes beginnen
-- mit user_id und helfen dabei nicht.
CREATE INDEX IF NOT EXISTS idx_sets_storage_ref     ON sets     (storage_id) WHERE storage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parts_storage_ref    ON parts    (storage_id) WHERE storage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_minifigs_storage_ref ON minifigs (storage_id) WHERE storage_id IS NOT NULL;
