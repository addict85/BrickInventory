-- 0036 — Die Stückzahl eines Sets steht nur noch in den Erfassungen
--
-- ── Marcos Frage ────────────────────────────────────────────────────────────
--
--   „Wieso hat Sets ebenfalls noch quantity?"
--
-- Weil die Spalte eine zweite Kopie war. Die Ableitung stand bereits im Baum
-- (routes/api_v1/acquisitions.ts, parentQuantitySql):
--
--     UPDATE sets SET quantity = COALESCE(
--       (SELECT SUM(quantity) FROM set_acquisitions WHERE …), 0)
--
-- Jedes Bearbeiten einer Erfassung rechnete die Menge also schon aus den
-- Erfassungen neu. Daneben standen aber SIEBEN weitere Schreibstellen, die sie
-- fortschrieben (`quantity = quantity + $1`) oder setzten (`quantity = $1`).
--
-- ── Und sie sind auseinandergelaufen ────────────────────────────────────────
--
-- GEMESSEN am laufenden Server (der Befund steht in utils/setService.ts): Zehn
-- gleichzeitige Erfassungen desselben Sets ergaben `sets.quantity = 10`, aber
-- drei Erfassungszeilen mit Summe 7 — drei Exemplare, die es laut der einen
-- Tabelle gab und laut der anderen nicht.
--
-- Migration 0032 hat denselben Schnitt für Kaufpreis und Zustand gemacht. Das
-- hier ist der dritte Wert derselben Zeile, und der letzte.
--
-- ── Was an die Stelle tritt ─────────────────────────────────────────────────
--
-- Die Rechnung steht EINMAL, in utils/bestandsmenge.ts, und wird von den
-- neunzehn Lesestellen eingesetzt — als gruppierte JOIN-Quelle, wo es um viele
-- Zeilen geht, und als Unterabfrage, wo es um eine geht. Dieselbe Bauart wie
-- ersatzteilSql() in utils/validate.ts, aus demselben Grund: `is_spare` ist in
-- diesem Baum schon einmal an sechs Stellen in vier Lesarten zerfallen.
--
-- ── Was `sets` danach noch ist ──────────────────────────────────────────────
--
-- Eine Zeile sagt: DIESES Konto hält DIESES Set, seit DANN, an DEM Ort.
-- Wie viele, wofür bezahlt und in welchem Zustand — das steht je Kauf in
-- set_acquisitions.
--
-- ── Reihenfolge ─────────────────────────────────────────────────────────────
--
-- Schritt 1 trägt fehlende Erfassungen aus der Spalte nach. Migration 0032 hat
--           das schon getan und danach nachgeprüft — aber zwischen 0032 und
--           hier lief die Anwendung, und ein Set konnte eine Bestandszeile
--           ohne Erfassung bekommen (wenn das INSERT der Erfassung ausfiel).
-- Schritt 2 ist der Riegel: Er bricht ab, wenn eine Set-Zeile ihre Stückzahl
--           verlieren würde.
-- Schritt 3 löscht die Spalte.

-- ── Schritt 1: fehlende Erfassungen nachtragen ──────────────────────────────
--
-- Im DO-Block mit Spaltenprüfung: Auf einer Datenbank, die diese Migration
-- schon gesehen hat, ist die Spalte weg und die Abfrage wäre ein harter
-- Fehler. Dieselbe Bauart wie in 0032, 0034 und 0035.

DO $nachtrag$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sets' AND column_name = 'quantity') THEN
    -- GREATEST(…, 1): Eine Bestandszeile mit Menge 0 ist kein Bestand. Sie
    -- kann entstanden sein, bevor der Aufräumschritt in
    -- routes/api_v1/acquisitions.ts (cleanupWhenEmpty) sie entfernte. Mit 0
    -- hätte die Erfassung keine Wirkung, und der Riegel darunter schlüge an.
    EXECUTE $sql$
      INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
      SELECT s.user_id, s.set_number, GREATEST(COALESCE(s.quantity, 1), 1),
             NULL, 'N', COALESCE(s.added_at, NOW())
        FROM sets s
       WHERE NOT EXISTS (SELECT 1 FROM set_acquisitions a
                          WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
    $sql$;
  END IF;
END $nachtrag$;

-- ── Schritt 2: Riegel ───────────────────────────────────────────────────────
--
-- Zwei Fragen, und beide müssen mit 0 beantwortet werden:
--
--   1. Hat jede Set-Zeile eine Erfassung? Ohne wäre ihre Stückzahl nach
--      Schritt 3 verloren — und zwar nicht auf 1, sondern auf 0: Das Set
--      verschwände aus jeder Mengenangabe.
--   2. Stimmt die Summe mit der Spalte überein? Weicht sie ab, ist das genau
--      der Drift, um den es hier geht — und dann soll ein Mensch
--      entscheiden, welche der beiden Zahlen gilt, nicht diese Migration.
--
-- Die zweite Frage ist der Grund, warum hier nicht einfach gelöscht wird.
-- Marcos Server ist der Fall, an dem der Drift gemessen wurde.

DO $pruefung$
DECLARE
  ohne_erfassung INTEGER := 0;
  abweichend     INTEGER := 0;
  beispiel       TEXT    := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sets' AND column_name = 'quantity') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM sets s
       WHERE NOT EXISTS (SELECT 1 FROM set_acquisitions a
                          WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
    $sql$ INTO ohne_erfassung;

    EXECUTE $sql$
      SELECT COUNT(*) FROM sets s
       WHERE COALESCE(s.quantity, 0) <> COALESCE(
               (SELECT SUM(a.quantity) FROM set_acquisitions a
                 WHERE a.user_id = s.user_id AND a.set_number = s.set_number), 0)
    $sql$ INTO abweichend;

    IF abweichend > 0 THEN
      -- Ein Beispiel in die Meldung: „3 Zeilen weichen ab" sagt nicht, wo man
      -- nachsehen soll.
      EXECUTE $sql$
        SELECT s.set_number || ' (Konto ' || s.user_id || '): Spalte '
               || COALESCE(s.quantity, 0) || ', Erfassungen ' || COALESCE(
                  (SELECT SUM(a.quantity) FROM set_acquisitions a
                    WHERE a.user_id = s.user_id AND a.set_number = s.set_number), 0)
          FROM sets s
         WHERE COALESCE(s.quantity, 0) <> COALESCE(
                 (SELECT SUM(a.quantity) FROM set_acquisitions a
                   WHERE a.user_id = s.user_id AND a.set_number = s.set_number), 0)
         ORDER BY s.user_id, s.set_number
         LIMIT 1
      $sql$ INTO beispiel;
    END IF;
  END IF;

  IF ohne_erfassung > 0 THEN
    RAISE EXCEPTION '% Set-Zeilen haben keine Erfassung — nichts geaendert.', ohne_erfassung;
  END IF;
  IF abweichend > 0 THEN
    RAISE EXCEPTION 'Bei % Set-Zeilen weicht sets.quantity von der Summe der Erfassungen ab, z. B. %. Bitte von Hand entscheiden, welche Zahl gilt — nichts geaendert.',
      abweichend, beispiel;
  END IF;
END $pruefung$;

-- ── Schritt 3: Spalte loeschen ──────────────────────────────────────────────

ALTER TABLE sets DROP COLUMN IF EXISTS quantity;
