-- Schrittschutz am Server: Die App legt beim Anmelden den öffentlichen Teil
-- ihres Keystore-Schlüssels ab, je Token-Familie (Konto und created_at, das der
-- Tausch weitergibt). Heikle Schritte verlangen danach eine Signatur über eine
-- einmalige Challenge; sie öffnet für diese eine Aktion ein kurzes Fenster.
CREATE TABLE geraete_schluessel (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familie timestamptz NOT NULL,
  oeffentlich text NOT NULL,
  angelegt_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, familie)
);

CREATE TABLE schritt_challenges (
  challenge text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familie timestamptz NOT NULL,
  aktion text NOT NULL CHECK (aktion IN ('gutschein', 'verwaltung', 'zweiter_faktor')),
  angelegt_am timestamptz NOT NULL DEFAULT now(),
  ablauf timestamptz NOT NULL
);
CREATE INDEX idx_schritt_challenges_familie ON schritt_challenges (user_id, familie);

CREATE TABLE schritt_freigaben (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familie timestamptz NOT NULL,
  aktion text NOT NULL CHECK (aktion IN ('gutschein', 'verwaltung', 'zweiter_faktor')),
  bis timestamptz NOT NULL,
  hoechstens timestamptz NOT NULL,
  PRIMARY KEY (user_id, familie, aktion)
);
