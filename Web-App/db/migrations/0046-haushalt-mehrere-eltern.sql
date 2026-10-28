-- Haushalt: Ein Konto darf mehrere Elternkonten haben, und Rechte gelten nur
-- entlang einer direkten Verknüpfung. Jede Sicht auf ein Konto beruht damit
-- auf dessen eigener Zustimmung (eingelöste Einladung); über eine Kette
-- A → B → C sieht C das Konto A nicht mehr.
--
-- Wer bisher über eine Kette sah, bekommt einen Hinweis: Die bisher nur
-- mittelbar erreichten Konten stehen in household_former_links, bis sie die
-- Einladung direkt einlösen oder der Hinweis verworfen wird.

CREATE TABLE IF NOT EXISTS household_former_links (
  main_user_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_user_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  via_user_id  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (main_user_id, sub_user_id)
);
-- Für das Löschen eines Kontos: Die Fremdschlüssel werden über diese Spalten gesucht.
CREATE INDEX IF NOT EXISTS idx_household_former_sub ON household_former_links (sub_user_id);
CREATE INDEX IF NOT EXISTS idx_household_former_via ON household_former_links (via_user_id);

-- via = das direkte Unterkonto, über das die Sicht lief; das kennt der Leser.
INSERT INTO household_former_links (main_user_id, sub_user_id, via_user_id)
WITH RECURSIVE baum(wurzel, id, via, tiefe, pfad) AS (
    SELECT main_user_id, sub_user_id, sub_user_id, 1, ARRAY[main_user_id, sub_user_id]
      FROM account_links
  UNION ALL
    SELECT b.wurzel, l.sub_user_id, b.via, b.tiefe + 1, b.pfad || l.sub_user_id
      FROM account_links l
      JOIN baum b ON l.main_user_id = b.id
     WHERE NOT (l.sub_user_id = ANY(b.pfad)) AND b.tiefe < 10
)
SELECT DISTINCT ON (wurzel, id) wurzel, id, via
  FROM baum
 WHERE tiefe >= 2
   AND NOT EXISTS (SELECT 1 FROM account_links d WHERE d.main_user_id = baum.wurzel AND d.sub_user_id = baum.id)
 ORDER BY wurzel, id, tiefe
ON CONFLICT DO NOTHING;

ALTER TABLE account_links DROP CONSTRAINT IF EXISTS account_links_sub_unique;
CREATE INDEX IF NOT EXISTS idx_account_links_sub ON account_links (sub_user_id);
