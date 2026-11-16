-- Deaktivieren, Rechte entziehen und Löschen eines anderen Verwalters gelten wie Passwort und
-- zweiter Faktor (0116) erst nach 24 Stunden: Eine erbeutete Verwaltersitzung räumte sonst die
-- übrigen Verwalter sofort und ohne Mail ab. Das Ziel bricht ab, indem es sich anmeldet oder den
-- Link aus der Mail öffnet; gespeichert ist nur der Hash dieses Links. Wiederholbar.
ALTER TABLE verwalter_uebernahmen DROP CONSTRAINT IF EXISTS verwalter_uebernahmen_art_check;
ALTER TABLE verwalter_uebernahmen ADD CONSTRAINT verwalter_uebernahmen_art_check
  CHECK (art IN ('passwort', 'zweiter_faktor', 'deaktivieren', 'rolle_entziehen', 'loeschen'));
ALTER TABLE verwalter_uebernahmen ADD COLUMN IF NOT EXISTS abbruch_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_verwalter_uebernahmen_abbruch ON verwalter_uebernahmen (abbruch_hash);
