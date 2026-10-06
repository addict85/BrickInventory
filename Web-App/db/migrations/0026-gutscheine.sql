-- ════════════════════════════════════════════════════════════════════════════
-- LEGO-Geschenkkarten im eigenen Profil.
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── Marcos Vorgabe ──────────────────────────────────────────────────────────
--
-- „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
-- Betrag hinterlegt werden können." Erfassung manuell ODER aus dem PDF des
-- Gutscheins, das PDF soll wieder herunterladbar sein, und zwar in BEIDEN
-- Apps ueber dieselben Dienste des Backends.
--
-- ── Warum `vouchers` und nicht `gutscheine` ─────────────────────────────────
--
-- Dieselbe Begruendung wie bei 0023: Die Datenbank dieses Baums spricht
-- Englisch (sets, parts, minifigs, price_alerts, wanted). Die Oberflaeche
-- heisst „Gutscheine", die Tabelle heisst `vouchers`.
--
-- ── Warum die Zahlen im Klartext stehen ─────────────────────────────────────
--
-- Nummer und PIN sind das, was den Gutschein einloesbar macht — also Geld.
-- Sie liegen trotzdem unverschluesselt, und das ist eine Entscheidung, keine
-- Nachlaessigkeit: Der Nutzer muss sie LESEN koennen, sonst ist die ganze
-- Funktion sinnlos. Eine Verschluesselung, deren Schluessel daneben auf
-- demselben Server liegt, schuetzt gegen nichts und kostet nur.
--
-- Was stattdessen schuetzt, steht in der Route: Gutscheine sind streng
-- EIGENTUEMER-gebunden. Kein Haushalts-Blickfeld (scopeIds), kein
-- Admin-Durchgriff, keine Aufnahme in den Einstellungs-Export. Das ist die
-- einzige Stelle im Baum mit dieser Schaerfe, und sie ist hier richtig:
-- Ueberall sonst geht es um die Frage, WER WAS besitzt. Hier geht es um
-- Zahlen, die jeder einloesen kann, der sie sieht.
CREATE TABLE IF NOT EXISTS vouchers (
  id          SERIAL      PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Die aufgedruckte Kartennummer. TEXT und nicht BIGINT: Sie ist eine
  -- Kennung, keine Zahl — fuehrende Nullen muessen erhalten bleiben, und die
  -- 19 Stellen des Beispiels passen zwar noch in BIGINT, aber darauf zu
  -- bauen hiesse, auf das Format einer fremden Firma zu wetten.
  number      TEXT        NOT NULL,

  -- Der PIN. NULL erlaubt: Nicht jede Karte traegt einen, und beim
  -- Auslesen aus dem PDF kann genau dieses Feld fehlen, waehrend Nummer und
  -- Betrag stehen. Dann soll die Erfassung trotzdem gelingen.
  pin         TEXT,

  -- NUMERIC, nicht REAL — dieselbe Regel wie bei allen Geldspalten des
  -- Baums; die Begruendung steht in test/money-numeric-db.test.js.
  -- Zwei Nachkommastellen statt der sonst ueblichen vier: Ein Gutschein wird
  -- auf Rappen genau ausgestellt, nie feiner. Vier Stellen wuerden eine
  -- Genauigkeit vortaeuschen, die es nicht gibt.
  amount      NUMERIC(12,2) NOT NULL,

  -- Waehrungscode wie ueberall im Baum (CHF, EUR, …).
  currency    TEXT        NOT NULL DEFAULT 'CHF',

  -- Freitext: „Geburtstag Oma", „noch nicht eingeloest".
  note        TEXT,

  -- Pfad der hochgeladenen PDF-Datei, relativ zum data-Verzeichnis, oder
  -- NULL bei rein manueller Erfassung. KEIN Pfad unter data/uploads/:
  -- Der dortige Ausliefer-Weg (serveDataFile) gibt Haushaltsmitgliedern und
  -- Admins Zugriff. Gutscheine liegen deshalb unter data/vouchers/<user>/
  -- und sind AUSSCHLIESSLICH ueber die eigene Route erreichbar.
  pdf_path    TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Dieselbe Karte nicht zweimal im selben Konto. Ohne das legt ein zweimal
  -- hochgeladenes PDF stillschweigend einen zweiten Eintrag an, und der
  -- Bestand stimmt nicht mehr.
  UNIQUE (user_id, number)
);

-- Gelesen wird immer „alle Gutscheine EINES Kontos", nie quer ueber alle.
CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers(user_id);
