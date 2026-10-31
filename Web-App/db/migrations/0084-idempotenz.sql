-- Idempotenzschlüssel schreibender Anfragen (Kopfzeile Idempotency-Key): Der
-- Offline-Ausgang der App wiederholt eine Anfrage, deren Antwort verloren
-- ging; die Wiederholung bekommt die gespeicherte Antwort statt einer zweiten
-- Wirkung. Je Konto, weil Schlüssel nur auf einem Gerät eindeutig sind.
-- `status` NULL heisst: die erste Anfrage läuft noch.
CREATE TABLE idempotenz (
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schluessel  TEXT        NOT NULL,
  anfrage     TEXT        NOT NULL,
  status      INTEGER,
  antwort     TEXT,
  angelegt    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, schluessel),
  CHECK (length(schluessel) BETWEEN 1 AND 100)
);
-- Das Aufräumen sucht nach Alter.
CREATE INDEX idx_idempotenz_angelegt ON idempotenz (angelegt);
