-- ── Haushalt: Konten verknüpfen ─────────────────────────────────────────────
--
-- Hintergrund: Eine Familie verwaltet die Sammlung je Kind in einem eigenen
-- Konto; ein Elternteil braucht die Gesamtsicht über den Haushalt.
--
-- ── account_links ───────────────────────────────────────────────────────────
-- Eine Zeile je Unterkonto. Die Verknüpfung ist bestätigt, sobald die Zeile
-- existiert — sie entsteht ausschliesslich dadurch, dass der Hauptaccount
-- einen Einladungscode erzeugt UND das Unterkonto ihn einlöst. Beide Seiten
-- haben damit zugestimmt, und es braucht keinen Status.
--
-- UNIQUE auf sub_user_id: Ein Konto gehört zu höchstens EINEM Haushalt. Ohne
-- das würde ein Set in zwei Haushaltssichten gleichzeitig auftauchen, und beim
-- Verschieben wäre nicht mehr klar, wer es darf.
--
-- Nur EINE Stufe: Ein Hauptaccount darf nirgends Unterkonto sein und
-- umgekehrt. Das lässt sich in Postgres nicht als CHECK ausdrücken (es müsste
-- die eigene Tabelle abfragen), deshalb prüft es utils/household.ts beim
-- Einlösen. Der Kommentar steht hier, damit beim nächsten Blick ins Schema
-- niemand denkt, die Regel fehle.
--
-- ON DELETE CASCADE auf beiden Seiten: Wird ein Konto gelöscht, verschwindet
-- die Verknüpfung mit. Die Daten des Unterkontos gehen dabei ohnehin mit dem
-- Konto — sie werden NICHT an den Hauptaccount vererbt.
CREATE TABLE IF NOT EXISTS account_links (
  main_user_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_user_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (main_user_id, sub_user_id),
  CONSTRAINT account_links_sub_unique UNIQUE (sub_user_id),
  -- Ein Konto kann sich nicht selbst verknüpfen.
  CONSTRAINT account_links_no_self CHECK (main_user_id <> sub_user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_links_main ON account_links (main_user_id);

-- ── account_link_invites ────────────────────────────────────────────────────
-- Einladungscodes, die der Hauptaccount in den Einstellungen erzeugt und die
-- im Unterkonto eingegeben werden.
--
-- Gespeichert wird nur der SHA-256 des Codes — dasselbe Vorgehen wie bei den
-- QR-Anmeldecodes und den API-Tokens. Wer die Datenbank liest, kann damit
-- keine Einladung einlösen.
--
-- Einmalig einlösbar (used_at) und mit Ablauf: Ein Code, der in einem Chat
-- liegen bleibt, ist sonst dauerhaft ein Zugang zur eigenen Sammlung.
CREATE TABLE IF NOT EXISTS account_link_invites (
  token_hash   TEXT        PRIMARY KEY,
  main_user_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_link_invites_main
  ON account_link_invites (main_user_id, expires_at);
