-- ── Preisalarm: sag Bescheid, wenn ein Set eine Schwelle reisst ──────────────
--
-- Hintergrund: Der Marktpreis wird ohnehin regelmaessig geholt (jobs/priceJob)
-- und taeglich in price_history festgeschrieben. Wer wissen will, wann ein Set
-- unter einen Preis faellt oder ueber einen steigt, musste bisher selbst
-- nachsehen — die Zahl war da, nur niemand hat hingeschaut.
--
-- ── Warum je ZUSTAND und nicht je Set ───────────────────────────────────────
--
-- Neu und gebraucht liegen bei Sets oft um ein Vielfaches auseinander. Ein
-- Alarm „unter 200" ohne Zustand haette entweder bei jedem gebrauchten
-- Exemplar ausgeloest oder bei keinem neuen — in beiden Faellen waere er
-- nutzlos, ohne dass es jemandem auffiele.
--
-- ── Warum die Waehrung mitgespeichert wird ──────────────────────────────────
--
-- Die Schwelle ist ein BETRAG, und ein Betrag ohne Waehrung ist keine Zahl.
-- Aendert jemand spaeter seine Waehrung, bliebe die Schwelle sonst stehen und
-- meinte ploetzlich etwas anderes — 200 CHF sind nicht 200 EUR. Gepruft wird
-- deshalb gegen den Preis in GENAU dieser Waehrung.
--
-- ── ausgeloest: warum ein Merker und keine Sperrfrist ───────────────────────
--
-- Ohne ihn meldete der Alarm bei JEDEM Lauf, solange der Preis unter der
-- Schwelle bleibt — bei stuendlichem Job also stuendlich. Eine Sperrfrist
-- („hoechstens einmal pro Woche") waere die naheliegende Antwort und die
-- falsche: Sie verschluckt das zweite Unterschreiten nach einer Erholung,
-- also genau den Fall, der wieder interessant ist.
--
-- Der Merker macht daraus eine Hysterese: gemeldet wird beim UEBERGANG. Faellt
-- der Preis zurueck auf die andere Seite, wird er zurueckgesetzt und der
-- naechste Uebergang meldet wieder.
CREATE TABLE IF NOT EXISTS price_alerts (
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_number    TEXT        NOT NULL,
  condition     TEXT        NOT NULL DEFAULT 'N',
  -- 'unter' = melden, wenn der Preis die Schwelle UNTERschreitet; 'ueber'
  -- entsprechend. Als CHECK und nicht als eigene Tabelle: zwei Werte, die sich
  -- nie vermehren.
  richtung      TEXT        NOT NULL,
  schwelle      NUMERIC(12,4) NOT NULL,
  currency_code TEXT        NOT NULL,
  ausgeloest    BOOLEAN     NOT NULL DEFAULT FALSE,
  zuletzt_am    TIMESTAMPTZ,
  zuletzt_preis NUMERIC(12,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, set_number, condition),
  CONSTRAINT price_alerts_richtung CHECK (richtung IN ('unter', 'ueber')),
  CONSTRAINT price_alerts_schwelle CHECK (schwelle > 0)
);

-- Der Job geht die Alarme nach SET durch: Er hat gerade die Preise dieses Sets
-- geholt und fragt dann, wer darauf wartet.
CREATE INDEX IF NOT EXISTS idx_price_alerts_set ON price_alerts (set_number, condition);
