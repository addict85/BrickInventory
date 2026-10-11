-- 0035 — Preis und Zustand von Teilen und Figuren nur in den Erfassungen
--
-- ── Marcos Vorgabe ──────────────────────────────────────────────────────────
--
--   „Ich muss dir bei unit_price, purchase_price und condition widersprechen.
--    Diese Informationen gehören in die set_acuisitions tabelle, da sie pro
--    Kauf hinterlegt werden."
--
-- Fuer Sets hat Migration 0032 das gemacht. Dies ist dasselbe fuer Teile und
-- Minifiguren: `part_acquisitions` und `minifig_acquisitions` fuehren Menge,
-- Einzelpreis, Zustand und Datum JE KAUF. An der Bestandszeile stand daneben
-- eine Abschrift der letzten Erfassung — und aus genau diesem Nebeneinander
-- sind bei den Sets drei gemeldete Fehler entstanden (Nachtraege 51, 75 und
-- der Android-Weg mit resolvePrice: null).
--
-- ── Was die drei Spalten bedeuteten ─────────────────────────────────────────
--
-- Nachgesehen in utils/preisRegel.ts (manuellerKaufpreis):
--
--   unit_price      Was der Mensch als Preis/Stueck eingegeben hat, sonst NULL.
--   purchase_price  Ein ANZEIGEWERT fuer die Stammzeile: der eingegebene Preis,
--                   sonst der Marktpreis, sonst 0. Nie NULL.
--   condition       Zustand der letzten Erfassung.
--
-- In der Erfassung heisst 0 „fuer null Franken gekauft", in der Stammzeile
-- heisst 0 „nichts bekannt". Die Unterscheidung steht in preisRegel.ts
-- ausgeschrieben (`erfassungsPreis` gegen `kaufpreis`) und bleibt erhalten:
-- Die Leseabfragen bilden den Anzeigewert jetzt aus der Erfassung
-- (COALESCE(..., 0)), statt ihn ein zweites Mal zu speichern.
--
-- ── Was mit SET-Teilen passiert ─────────────────────────────────────────────
--
-- Teile und Figuren aus einem Set haben keine eigene Erfassung — es gibt fuer
-- sie keinen eigenen Kauf, gekauft wurde das Set. Ihre condition stand
-- deshalb seit jeher auf dem Vorgabewert 'N' und wurde NIE geschrieben:
-- GEMESSEN an allen Schreibwegen von parts.condition (routes/parts.ts und
-- routes/api_v1/acquisitions.ts) — beide fassen nur `source='manual'` an, und
-- der Set-Import nennt die Spalte gar nicht.
--
-- Nach dem Loeschen liefern die Leseabfragen fuer sie weiterhin 'N'. Das ist
-- nicht derselbe Weg, aber dasselbe Ergebnis.
--
-- ── Der Nachtrag stand an der falschen Stelle ───────────────────────────────
--
-- db/database.ts trug diese Erfassungen in initSchema() nach. Das ist aus
-- demselben Grund wirkungslos, der dort beim Sets-Nachtrag schon
-- ausgeschrieben steht: initSchema() laeuft nur beim allerersten Start einer
-- Datenbank, und dort ist `parts` leer. Fuer Altbestaende war er gedacht und
-- hat sie nie erreicht. Schlimmer noch: Nach DIESER Migration wuerde er bei
-- einer Versionsaenderung gegen geloeschte Spalten laufen — und sein
-- logAndContinue() wuerde das verschlucken.
--
-- Deshalb steht er jetzt hier, einmalig, mit Riegel danach.

-- ── Schritt 1: Erfassungen nachtragen ───────────────────────────────────────
--
-- Im DO-Block mit Spaltenpruefung: Auf einer Datenbank, die diese Migration
-- schon gesehen hat, sind die Spalten weg und die Abfrage waere ein harter
-- Fehler. Dieselbe Bauart wie in 0032 und 0034.

DO $nachtrag$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'unit_price') THEN
    -- COALESCE(unit_price, purchase_price): Der eingegebene Preis gewinnt, der
    -- Anzeigewert ist der Rueckfall. NULLIF(..., 0) danach, weil die 0 der
    -- Stammzeile „nichts bekannt" heisst — in der Erfassung waere sie eine
    -- Behauptung.
    EXECUTE $sql$
      INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity,
                                     unit_price, condition, created_at)
      SELECT p.user_id, p.part_number, COALESCE(p.color_id, 0), COALESCE(p.quantity, 1),
             NULLIF(COALESCE(p.unit_price, p.purchase_price), 0),
             COALESCE(p.condition, 'N'),
             COALESCE(p.added_at, NOW())
        FROM parts p
       WHERE p.source = 'manual'
         AND NOT EXISTS (SELECT 1 FROM part_acquisitions a
                          WHERE a.user_id = p.user_id
                            AND a.part_number = p.part_number
                            AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0))
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'unit_price') THEN
    -- NOW() statt eines Aufnahmedatums: Die Tabelle minifigs hat GAR KEINE
    -- Zeitspalte — weder im Schema noch in einer Migration. Ein Datum zu
    -- erfinden waere schlechter als „jetzt": Der Portfolio-Verlauf ordnet nach
    -- created_at, und ein frei gewaehltes Datum verschoebe eine Kurve, die nie
    -- so verlaufen ist. Dieselbe Begruendung stand schon in db/database.ts.
    EXECUTE $sql$
      INSERT INTO minifig_acquisitions (user_id, fig_number, quantity,
                                        unit_price, condition, created_at)
      SELECT m.user_id, m.fig_number, COALESCE(m.quantity, 1),
             NULLIF(COALESCE(m.unit_price, m.purchase_price), 0),
             COALESCE(m.condition, 'N'),
             NOW()
        FROM minifigs m
       WHERE m.source = 'manual'
         AND NOT EXISTS (SELECT 1 FROM minifig_acquisitions a
                          WHERE a.user_id = m.user_id
                            AND a.fig_number = m.fig_number)
    $sql$;
  END IF;
END $nachtrag$;

-- ── Schritt 2: Riegel ───────────────────────────────────────────────────────
--
-- Schritt 3 ist nicht umkehrbar. Haette eine manuell erfasste Position danach
-- weder Preis noch Zustand, soll die Migration stehenbleiben und sagen,
-- wie viele — nicht stillschweigend eine Kaufhistorie mit einem Loch
-- hinterlassen.
--
-- Geprueft wird nur `source='manual'`: Set-Teile haben keine eigene Erfassung
-- und sollen auch keine bekommen (siehe oben).

DO $pruefung$
DECLARE
  teile_ohne  INTEGER := 0;
  figs_ohne   INTEGER := 0;
  teile_preis INTEGER := 0;
  figs_preis  INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'unit_price') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM parts p
       WHERE p.source = 'manual'
         AND NOT EXISTS (SELECT 1 FROM part_acquisitions a
                          WHERE a.user_id = p.user_id
                            AND a.part_number = p.part_number
                            AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0))
    $sql$ INTO teile_ohne;

    -- Und der Preis selbst: Eine Erfassung zu haben genuegt nicht, wenn der
    -- Betrag dabei verlorenginge.
    EXECUTE $sql$
      SELECT COUNT(*) FROM parts p
       WHERE p.source = 'manual'
         AND COALESCE(p.unit_price, p.purchase_price) > 0
         AND NOT EXISTS (SELECT 1 FROM part_acquisitions a
                          WHERE a.user_id = p.user_id
                            AND a.part_number = p.part_number
                            AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0)
                            AND a.unit_price IS NOT NULL)
    $sql$ INTO teile_preis;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'unit_price') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM minifigs m
       WHERE m.source = 'manual'
         AND NOT EXISTS (SELECT 1 FROM minifig_acquisitions a
                          WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number)
    $sql$ INTO figs_ohne;

    EXECUTE $sql$
      SELECT COUNT(*) FROM minifigs m
       WHERE m.source = 'manual'
         AND COALESCE(m.unit_price, m.purchase_price) > 0
         AND NOT EXISTS (SELECT 1 FROM minifig_acquisitions a
                          WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
                            AND a.unit_price IS NOT NULL)
    $sql$ INTO figs_preis;
  END IF;

  IF teile_ohne > 0 THEN
    RAISE EXCEPTION '% manuelle Teile haben keine Erfassung — nichts geaendert.', teile_ohne;
  END IF;
  IF figs_ohne > 0 THEN
    RAISE EXCEPTION '% manuelle Figuren haben keine Erfassung — nichts geaendert.', figs_ohne;
  END IF;
  IF teile_preis > 0 THEN
    RAISE EXCEPTION '% manuelle Teile wuerden ihren Kaufpreis verlieren — nichts geaendert.', teile_preis;
  END IF;
  IF figs_preis > 0 THEN
    RAISE EXCEPTION '% manuelle Figuren wuerden ihren Kaufpreis verlieren — nichts geaendert.', figs_preis;
  END IF;
END $pruefung$;

-- ── Schritt 3: Spalten loeschen ─────────────────────────────────────────────

ALTER TABLE parts DROP COLUMN IF EXISTS unit_price;
ALTER TABLE parts DROP COLUMN IF EXISTS purchase_price;
ALTER TABLE parts DROP COLUMN IF EXISTS condition;

ALTER TABLE minifigs DROP COLUMN IF EXISTS unit_price;
ALTER TABLE minifigs DROP COLUMN IF EXISTS purchase_price;
ALTER TABLE minifigs DROP COLUMN IF EXISTS condition;

-- Der Erfassungsweg braucht den Zugriff ueber (Konto, Teil, Farbe) — bisher
-- lief er gegen die Bestandszeile. Die beiden Indizes gibt es schon
-- (db/database.ts, idx_part_acq und idx_minifig_acq); hier steht nur, dass sie
-- ab jetzt der einzige Weg zum Preis sind.
