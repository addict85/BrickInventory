-- ═══════════════════════════════════════════════════════════════════════════
-- Die Wunschliste
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Marcos Vorgabe:
--
--   „Eine Wunschliste. Aus dem Katalog sollen in der Detailansicht Sets in die
--    Wunschliste hinzugefuegt werden koennen inkl. Zustand und einem
--    Preisalarm. In der Wunschliste soll analog den Sets, neue Eintraege per
--    Barcodescanner oder Setnummern hinzugefuegt werden koennen. In der
--    Wunschliste sollen Eintraege geloescht oder direkt in die Galerie
--    uebernommen werden koennen."
--
-- ── Warum eine eigene Tabelle und nicht ein Merker an `sets` ────────────────
--
-- Naheliegend waere eine Spalte `gewuenscht` an `sets` gewesen. Sie waere
-- falsch: `sets` ist der BESITZ. Jede Zeile dort zaehlt in die Galerie, in die
-- Teileliste, in den Portfolio-Wert und in die Finanzansicht. Ein Wunsch ist
-- nichts davon — er wuerde ueberall mitgerechnet, und jede dieser Ansichten
-- braeuchte ab dann einen Filter, den sie heute nicht hat.
--
-- ── Warum der Zustand in den Schluessel gehoert ─────────────────────────────
--
-- Weil neu und gebraucht verschiedene Wuensche sind. Wer ein gebrauchtes
-- Exemplar zum Bauen sucht UND ein verpacktes zum Aufheben, hat zwei Wuensche
-- mit zwei Schwellen. Genau so fuehrt price_alerts den Zustand seit 0019 im
-- Schluessel; eine Wunschliste, die das nicht koennte, passte nicht dazu.
--
-- ── Warum KEINE Stammdaten hier stehen ──────────────────────────────────────
--
-- Kein name, kein year, kein theme, kein Bild. `sets` fuehrt diese Spalten,
-- weil sie beim Erfassen aus externen Quellen geholt und angereichert werden
-- (jobs/nachErfassung.ts). Ein Wunsch braucht das nicht: rb_sets liegt lokal
-- und wird taeglich nachgezogen, und der Katalog liest seine Anzeige seit
-- jeher von dort. Eine zweite Kopie derselben Namen waere eine zweite
-- Wahrheit, die beim naechsten Katalogdurchlauf veraltet.
--
-- Der Preis dafuer: Ein Set, das rb_sets nicht kennt, zeigt in der
-- Wunschliste nur seine Nummer. Das ist sichtbar und harmlos — und es ist
-- ehrlicher als ein Name, der aus einer Quelle stammt, die niemand mehr
-- nachfuehrt.
--
-- ── Warum der Preisalarm NICHT hier steht ───────────────────────────────────
--
-- price_alerts haengt seit 0019 an (user_id, set_number, condition) und hat
-- den Besitz nie vorausgesetzt — ein Alarm auf ein fremdes Set war immer
-- moeglich. Der Schluessel der Wunschliste ist derselbe. Beide Tabellen
-- treffen sich also ueber ihren Schluessel, ohne dass eine die andere kennen
-- muss, und der stuendliche Abruf aus 0019 meldet Wunsch-Alarme mit, ohne
-- dass an ihm eine Zeile geaendert wird.
--
-- Eine Spalte `schwelle` hier haette eine zweite Stelle geschaffen, an der
-- eine Preisschwelle steht.

CREATE TABLE IF NOT EXISTS wishlist (
  id          SERIAL      PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_number  TEXT        NOT NULL,
  -- 'N' = neu, 'U' = gebraucht. Dieselben zwei Werte wie ueberall im Baum;
  -- die Vorgabe folgt der Einstellung des Nutzers, nicht dieser Zeile.
  condition   TEXT        NOT NULL DEFAULT 'N',
  -- Wofuer der Wunsch da ist („Geschenk Enkel", „fehlt in der Reihe").
  -- Freitext und optional — es ist eine Notiz, kein Feld mit Bedeutung.
  notiz       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, set_number, condition)
);

-- Die Liste wird IMMER fuer ein Blickfeld von Konten gelesen
-- (`user_id = ANY($1)`) und nach Aufnahmedatum sortiert. Genau dafuer.
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id, created_at DESC);
