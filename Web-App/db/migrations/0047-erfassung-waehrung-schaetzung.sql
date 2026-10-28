-- Erfassungen verlieren keine Information mehr:
--   * Jede Erfassung trägt ihre Währung. Ein Wechsel der Einstellung macht
--     alte Kaufpreise sonst stillschweigend zu Beträgen in der neuen Währung.
--   * price_estimated kennzeichnet einen Marktpreis, der als Kaufpreis
--     eingesetzt wurde — er ist eine Schätzung, kein bezahlter Betrag.
--   * Käufe desselben Tages werden nur noch zusammengelegt, wenn Preis,
--     Herkunft und Währung gleich sind; bisher entstand ein Mischpreis, aus
--     dem sich die Einzelkäufe nicht mehr zurückrechnen liessen.
-- Dazu bekommen Teile- und Figurenerfassungen die Prüfregeln, die Sets seit
-- 0045 haben, und Lagerorte gehören per Fremdschlüssel zum selben Konto.

-- ── Teile- und Figurenerfassungen bereinigen ────────────────────────────────
DELETE FROM part_acquisitions    WHERE quantity <= 0;
DELETE FROM minifig_acquisitions WHERE quantity <= 0;
UPDATE part_acquisitions    SET condition = 'N' WHERE condition IS NULL OR condition NOT IN ('N', 'U');
UPDATE minifig_acquisitions SET condition = 'N' WHERE condition IS NULL OR condition NOT IN ('N', 'U');

-- Ohne Datum umging eine Zeile die Tagesregel. Sie bekommt das Datum ihrer
-- Bestandszeile; liegt an dem Tag schon eine passende, wird sie dort addiert.
DO $$
DECLARE r RECORD; tag TIMESTAMPTZ; ziel INTEGER;
BEGIN
  FOR r IN SELECT * FROM part_acquisitions WHERE created_at IS NULL LOOP
    SELECT COALESCE(MIN(p.added_at), NOW()) INTO tag FROM parts p
     WHERE p.user_id = r.user_id AND p.part_number = r.part_number AND COALESCE(p.color_id, 0) = r.color_id;
    SELECT id INTO ziel FROM part_acquisitions
     WHERE user_id = r.user_id AND part_number = r.part_number AND color_id = r.color_id
       AND condition = r.condition AND id <> r.id
       AND (created_at AT TIME ZONE 'UTC')::date = (tag AT TIME ZONE 'UTC')::date
     LIMIT 1;
    IF ziel IS NULL THEN
      UPDATE part_acquisitions SET created_at = tag WHERE id = r.id;
    ELSE
      UPDATE part_acquisitions SET quantity = quantity + r.quantity WHERE id = ziel;
      DELETE FROM part_acquisitions WHERE id = r.id;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM minifig_acquisitions WHERE created_at IS NULL LOOP
    tag := NOW();  -- Figurenzeilen haben kein eigenes Anlagedatum.
    SELECT id INTO ziel FROM minifig_acquisitions
     WHERE user_id = r.user_id AND fig_number = r.fig_number
       AND condition = r.condition AND id <> r.id
       AND (created_at AT TIME ZONE 'UTC')::date = (tag AT TIME ZONE 'UTC')::date
     LIMIT 1;
    IF ziel IS NULL THEN
      UPDATE minifig_acquisitions SET created_at = tag WHERE id = r.id;
    ELSE
      UPDATE minifig_acquisitions SET quantity = quantity + r.quantity WHERE id = ziel;
      DELETE FROM minifig_acquisitions WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE part_acquisitions    ALTER COLUMN condition SET NOT NULL, ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE minifig_acquisitions ALTER COLUMN condition SET NOT NULL, ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE part_acquisitions    ADD CONSTRAINT part_acquisitions_menge_positiv    CHECK (quantity > 0);
ALTER TABLE minifig_acquisitions ADD CONSTRAINT minifig_acquisitions_menge_positiv CHECK (quantity > 0);
ALTER TABLE part_acquisitions    ADD CONSTRAINT part_acquisitions_zustand    CHECK (condition IN ('N', 'U'));
ALTER TABLE minifig_acquisitions ADD CONSTRAINT minifig_acquisitions_zustand CHECK (condition IN ('N', 'U'));

-- ── Währung und Schätzung ───────────────────────────────────────────────────
ALTER TABLE set_acquisitions     ADD COLUMN IF NOT EXISTS currency TEXT, ADD COLUMN IF NOT EXISTS price_estimated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE part_acquisitions    ADD COLUMN IF NOT EXISTS currency TEXT, ADD COLUMN IF NOT EXISTS price_estimated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE minifig_acquisitions ADD COLUMN IF NOT EXISTS currency TEXT, ADD COLUMN IF NOT EXISTS price_estimated BOOLEAN NOT NULL DEFAULT false;

-- Die Währung des Kontos zum Zeitpunkt der Erfassung. Ein Trigger statt
-- Pflichtangabe an jeder Schreibstelle: auch Wiederherstellen aus dem
-- Papierkorb, Verschieben und Importe bekommen sie so, ohne dass einer sie
-- vergessen kann.
CREATE OR REPLACE FUNCTION erfassung_waehrung() RETURNS trigger AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    NEW.currency := COALESCE(
      (SELECT value FROM user_settings WHERE user_id = NEW.user_id AND key = 'currency'), 'EUR');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

UPDATE set_acquisitions a     SET currency = COALESCE((SELECT value FROM user_settings s WHERE s.user_id = a.user_id AND s.key = 'currency'), 'EUR') WHERE currency IS NULL;
UPDATE part_acquisitions a    SET currency = COALESCE((SELECT value FROM user_settings s WHERE s.user_id = a.user_id AND s.key = 'currency'), 'EUR') WHERE currency IS NULL;
UPDATE minifig_acquisitions a SET currency = COALESCE((SELECT value FROM user_settings s WHERE s.user_id = a.user_id AND s.key = 'currency'), 'EUR') WHERE currency IS NULL;

DROP TRIGGER IF EXISTS set_acquisitions_waehrung ON set_acquisitions;
DROP TRIGGER IF EXISTS part_acquisitions_waehrung ON part_acquisitions;
DROP TRIGGER IF EXISTS minifig_acquisitions_waehrung ON minifig_acquisitions;
CREATE TRIGGER set_acquisitions_waehrung     BEFORE INSERT OR UPDATE ON set_acquisitions     FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
CREATE TRIGGER part_acquisitions_waehrung    BEFORE INSERT OR UPDATE ON part_acquisitions    FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
CREATE TRIGGER minifig_acquisitions_waehrung BEFORE INSERT OR UPDATE ON minifig_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();

ALTER TABLE set_acquisitions     ALTER COLUMN currency SET NOT NULL;
ALTER TABLE part_acquisitions    ALTER COLUMN currency SET NOT NULL;
ALTER TABLE minifig_acquisitions ALTER COLUMN currency SET NOT NULL;

-- ── Tagesregel mit Preis, Herkunft und Währung ──────────────────────────────
-- Der neue Schlüssel umfasst den alten; beim Anlegen kann es keine Dubletten
-- geben. Neue Namen, damit jeder Index an genau einer Stelle entsteht.
DROP INDEX IF EXISTS idx_set_acq_tag_zustand;
DROP INDEX IF EXISTS idx_part_acq_tag_zustand;
DROP INDEX IF EXISTS idx_minifig_acq_tag_zustand;
CREATE UNIQUE INDEX idx_set_acq_tag_merkmale ON set_acquisitions
  (user_id, set_number, ((created_at AT TIME ZONE 'UTC')::date), condition,
   (COALESCE(purchase_price, -1)), price_estimated, currency);
CREATE UNIQUE INDEX idx_part_acq_tag_merkmale ON part_acquisitions
  (user_id, part_number, color_id, ((created_at AT TIME ZONE 'UTC')::date), condition,
   (COALESCE(unit_price, -1)), price_estimated, currency);
CREATE UNIQUE INDEX idx_minifig_acq_tag_merkmale ON minifig_acquisitions
  (user_id, fig_number, ((created_at AT TIME ZONE 'UTC')::date), condition,
   (COALESCE(unit_price, -1)), price_estimated, currency);

-- ── Lagerort gehört zum selben Konto ────────────────────────────────────────
UPDATE sets s     SET storage_id = NULL WHERE storage_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM storage_locations l WHERE l.id = s.storage_id AND l.user_id = s.user_id);
UPDATE parts p    SET storage_id = NULL WHERE storage_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM storage_locations l WHERE l.id = p.storage_id AND l.user_id = p.user_id);
UPDATE minifigs m SET storage_id = NULL WHERE storage_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM storage_locations l WHERE l.id = m.storage_id AND l.user_id = m.user_id);

ALTER TABLE storage_locations ADD CONSTRAINT storage_locations_konto_id UNIQUE (user_id, id);
ALTER TABLE sets     DROP CONSTRAINT IF EXISTS sets_storage_id_fkey;
ALTER TABLE parts    DROP CONSTRAINT IF EXISTS parts_storage_id_fkey;
ALTER TABLE minifigs DROP CONSTRAINT IF EXISTS minifigs_storage_id_fkey;
ALTER TABLE sets     ADD CONSTRAINT sets_storage_id_fkey     FOREIGN KEY (user_id, storage_id)
  REFERENCES storage_locations (user_id, id) ON DELETE SET NULL (storage_id);
ALTER TABLE parts    ADD CONSTRAINT parts_storage_id_fkey    FOREIGN KEY (user_id, storage_id)
  REFERENCES storage_locations (user_id, id) ON DELETE SET NULL (storage_id);
ALTER TABLE minifigs ADD CONSTRAINT minifigs_storage_id_fkey FOREIGN KEY (user_id, storage_id)
  REFERENCES storage_locations (user_id, id) ON DELETE SET NULL (storage_id);

-- ── Teile-Versionszähler gehört zu einem Konto ──────────────────────────────
DELETE FROM parts_version_user v WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.user_id);
ALTER TABLE parts_version_user ADD CONSTRAINT parts_version_user_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
