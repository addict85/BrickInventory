-- Die Teile-Zusammenfassung kopiert Lagerortnamen und Katalogtexte. Die
-- Versionszähler hingen bisher nur an parts, sets und set_acquisitions —
-- ein umbenannter Lagerort oder ein neuer Teilename blieb in der Liste
-- stehen, bis zufällig etwas anderes den Zähler erhöhte.
--
-- * Katalogtabellen erhöhen einen gemeinsamen Katalogstand; jede
--   Zusammenfassung merkt sich, mit welchem sie gebaut wurde.
-- * Ein umbenannter Lagerort erhöht den Zähler seines Kontos.
-- * set_acquisitions zählt nur noch, wenn sich Menge, Konto oder Set
--   ändern — ein geänderter Kaufpreis löste bisher einen Neuaufbau aus.
-- Die Trigger stehen hier vollständig, damit es für sie nur diese eine
-- Quelle gibt (initPartsSummary legt sie nicht mehr an).

CREATE TABLE IF NOT EXISTS parts_katalog_stand (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  v  BIGINT NOT NULL DEFAULT 0
);
INSERT INTO parts_katalog_stand (id, v) VALUES (1, 0) ON CONFLICT DO NOTHING;
ALTER TABLE parts_summary_state ADD COLUMN IF NOT EXISTS katalog_stand BIGINT NOT NULL DEFAULT -1;

CREATE OR REPLACE FUNCTION bump_parts_katalog() RETURNS trigger AS $$
BEGIN
  UPDATE parts_katalog_stand SET v = v + 1 WHERE id = 1;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['part_catalog', 'part_color_catalog', 'set_parts_catalog', 'bl_zuordnung'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_parts_katalog ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_katalog()', t);
  END LOOP;
END $$;

-- Konto-Zähler: dieselbe Fassung wie 0050, dazu eigene Funktionen für
-- Erfassungen (nur Menge/Konto/Set) und Lagerorte (nur der Name).
CREATE OR REPLACE FUNCTION bump_parts_version_ins() RETURNS trigger AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM neu WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_parts_version_del() RETURNS trigger AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM alt WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_parts_version_upd() RETURNS trigger AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM (
    SELECT user_id FROM alt UNION SELECT user_id FROM neu
  ) x WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_parts_version_erfassung_upd() RETURNS trigger AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM (
    SELECT a.user_id FROM alt a JOIN neu n ON n.id = a.id
     WHERE (a.quantity, a.user_id, a.set_number) IS DISTINCT FROM (n.quantity, n.user_id, n.set_number)
    UNION
    SELECT n.user_id FROM alt a JOIN neu n ON n.id = a.id
     WHERE (a.quantity, a.user_id, a.set_number) IS DISTINCT FROM (n.quantity, n.user_id, n.set_number)
  ) x WHERE user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_parts_version_lagerort_upd() RETURNS trigger AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT n.user_id, 1 FROM alt a JOIN neu n ON n.id = a.id
   WHERE a.name IS DISTINCT FROM n.name AND n.user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['parts', 'sets', 'set_acquisitions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_parts_version ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_parts_version_ins ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_parts_version_del ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_parts_version_upd ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON %I
                    REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins()', t);
    EXECUTE format('CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON %I
                    REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del()', t);
    EXECUTE format('CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON %I
                    REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION %I()',
                   t, CASE WHEN t = 'set_acquisitions' THEN 'bump_parts_version_erfassung_upd' ELSE 'bump_parts_version_upd' END);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_bump_parts_version_upd ON storage_locations;
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON storage_locations
  REFERENCING OLD TABLE AS alt NEW TABLE AS neu
  FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_lagerort_upd();

DROP FUNCTION IF EXISTS bump_parts_version();
