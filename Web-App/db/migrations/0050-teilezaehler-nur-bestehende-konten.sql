-- Die Zähler-Trigger der Teile-Zusammenfassung legt initPartsSummary() nur
-- beim Erststart an. Seit 0047 verweist parts_version_user auf users; die
-- alte Fassung schrieb beim Löschen eines Kontos (Cascade auf parts/sets)
-- einen Zähler für genau dieses Konto und scheiterte am Fremdschlüssel.
-- Hier bekommen bestehende Datenbanken dieselbe Fassung wie der Erststart.
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
