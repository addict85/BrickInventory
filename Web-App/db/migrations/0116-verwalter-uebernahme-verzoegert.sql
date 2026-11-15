-- Setzt ein Verwalter Passwort oder zweiten Faktor eines anderen Verwalters zurück, gilt das
-- erst nach 24 Stunden: Eine erbeutete Verwaltersitzung übernähme sonst sofort die übrigen
-- Verwalterkonten. Meldet sich das Ziel vorher an, entfällt die Änderung.
CREATE TABLE verwalter_uebernahmen (
  ziel_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('passwort', 'zweiter_faktor')),
  durch_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passwort_hash text,
  angelegt_am timestamptz NOT NULL DEFAULT now(),
  wirksam_ab timestamptz NOT NULL,
  PRIMARY KEY (ziel_id, art),
  CHECK ((art = 'passwort') = (passwort_hash IS NOT NULL))
);

-- Ein gelöschter Verwalter nimmt seine Ankündigungen mit; ohne Index suchte das jede Zeile ab.
CREATE INDEX idx_verwalter_uebernahmen_durch ON verwalter_uebernahmen (durch_id);

-- Nur im Systemrahmen: RLS ohne Policy verbirgt jede Zeile vor der Laufzeitrolle.
ALTER TABLE verwalter_uebernahmen ENABLE ROW LEVEL SECURITY;
