-- 0038 — Die Stückzahl von Teilen und Figuren steht nicht mehr an der Zeile
--
-- ── Marcos Befund ───────────────────────────────────────────────────────────
--
--   „Bei den Minifigs und parts gibt es noch immer ein quantity"
--
-- Richtig. Migration 0036 hat sets.quantity geloescht; bei Teilen und Figuren
-- blieb die Spalte stehen, weil sie ZWEI Bedeutungen traegt:
--
--   source='manual'  wie viele ich besitze   → Summe der Erfassungen
--   source='set'     wie viele im SET stecken → set_parts_catalog.quantity
--                                                bzw. set_minifigs_catalog
--
-- Beide sind Abschriften, und das ist GEMESSEN, nicht vermutet:
--
--   * utils/partsImport.ts schreibt denselben Wert (row[9]) in DERSELBEN
--     Schleife nach parts.quantity UND nach set_parts_catalog.quantity.
--     utils/minifigsImport.ts macht es wortgleich mit fig.quantity.
--   * Fuer manuelle Positionen war utils/bestandsmenge.ts (mengeNeuRechnen)
--     der einzige Schreiber, und der rechnete die Summe der Erfassungen.
--
-- Und der Set-Zweig ist nirgends aenderbar: Jeder Schreibweg
-- (updateManualPart, updateManualFig und die beiden v1-Routen) traegt
-- `source='manual'` in seiner Bedingung. Es gibt also keine kontoeigene
-- Stueckzahl, die hier verloren gehen koennte.
--
-- ── Was an die Stelle tritt ─────────────────────────────────────────────────
--
-- EINE Fallunterscheidung, einmal hingeschrieben, in utils/bestandsmenge.ts
-- (teilmengeJoin/teilmengeAus) — dieselbe Bauart wie mengeJoin/mengeAus fuer
-- die Sets und ersatzteilSql() in utils/validate.ts.
--
-- ── Reihenfolge ─────────────────────────────────────────────────────────────
--
-- Schritt 1 traegt fehlende Katalogzeilen aus den Bestandszeilen nach. Ein
--           Set-Teil ohne Katalogzeile verloere sonst seine Stueckzahl.
-- Schritt 2 ist der Riegel: Er bricht ab, wenn eine Stueckzahl verloren ginge
--           ODER wenn Abschrift und Quelle auseinanderliegen.
-- Schritt 3 legt doppelte Bestandszeilen zusammen. Das ist NEU gegenueber den
--           Migrationen davor und noetig, weil ab Schritt 4 jede Zeile
--           dieselbe Katalogzahl liest — zwei Zeilen zaehlten doppelt.
-- Schritt 4 loescht die beiden Spalten.
-- Schritt 5 setzt eindeutige Indizes, damit die Doppelung nicht zurueckkommt.
--           Erst dadurch greift das `ON CONFLICT DO NOTHING` der Importe, das
--           bisher wirkungslos war.
-- Schritt 6 setzt die Indizes fuer die beiden neuen JOINs.

-- ── Schritt 1: fehlende Katalogzeilen nachtragen ────────────────────────────
--
-- Im DO-Block mit Spaltenpruefung: Auf einer Datenbank, die diese Migration
-- schon gesehen hat, sind die Spalten weg und die Abfragen waeren ein harter
-- Fehler. Dieselbe Bauart wie in 0032 bis 0037.

DO $nachtrag$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'quantity') THEN
    -- ── Die SUMME je Konto, nicht die groesste Einzelzeile ──────────────
    --
    -- GEMESSEN: `parts` traegt KEINEN eindeutigen Index ausser dem
    -- Primaerschluessel auf `id`. Dasselbe Teil kann also in derselben Farbe
    -- aus demselben Set ZWEIMAL in der Tabelle stehen, und die Listen haben
    -- die beiden Zeilen addiert. test/verwendende-sets-db.test.js trug genau
    -- diesen Aufbau (zwei Zeilen, 10 + 5 = 15); seit Schritt 5 unten ist er
    -- nicht mehr moeglich, und der Fall steht jetzt in
    -- test/teilemengen-abgeleitet-db.test.js (Lage „doppelt": 6 + 4 = 10).
    --
    -- Nimmt der Nachtrag hier nur eine der Zeilen, verliert die Installation
    -- diese Summe. Deshalb MAX ueber die Konten (jedes Konto haelt dasselbe
    -- Set, die Zahl im Set ist dieselbe) und SUMME innerhalb eines Kontos.
    EXECUTE $sql$
      INSERT INTO set_parts_catalog (set_number, part_number, color_id, quantity)
      SELECT set_number, part_number, farbe, GREATEST(MAX(je_konto), 1)
        FROM (
          SELECT p.set_number, p.part_number, COALESCE(p.color_id, 0) AS farbe,
                 p.user_id, SUM(COALESCE(p.quantity, 1))::int AS je_konto
            FROM parts p
           WHERE COALESCE(p.source, 'set') = 'set'
             AND p.set_number IS NOT NULL AND p.set_number <> ''
             AND NOT EXISTS (SELECT 1 FROM set_parts_catalog c
                              WHERE c.set_number  = p.set_number
                                AND c.part_number = p.part_number
                                AND c.color_id    = COALESCE(p.color_id, 0))
           GROUP BY 1,2,3,4
        ) k
       GROUP BY set_number, part_number, farbe
      ON CONFLICT (set_number, part_number, color_id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'quantity') THEN
    -- Dieselbe Rechnung wie bei den Teilen darueber.
    EXECUTE $sql$
      INSERT INTO set_minifigs_catalog (set_number, fig_number, quantity)
      SELECT set_number, fig_number, GREATEST(MAX(je_konto), 1)
        FROM (
          SELECT m.set_number, m.fig_number, m.user_id,
                 SUM(COALESCE(m.quantity, 1))::int AS je_konto
            FROM minifigs m
           WHERE COALESCE(m.source, 'set') = 'set'
             AND m.set_number IS NOT NULL AND m.set_number <> ''
             AND NOT EXISTS (SELECT 1 FROM set_minifigs_catalog c
                              WHERE c.set_number = m.set_number
                                AND c.fig_number = m.fig_number)
           GROUP BY 1,2,3
        ) k
       GROUP BY set_number, fig_number
      ON CONFLICT (set_number, fig_number) DO NOTHING
    $sql$;
  END IF;
END $nachtrag$;

-- ── Schritt 2: Riegel ───────────────────────────────────────────────────────
--
-- Vier Fragen, und alle vier muessen mit 0 beantwortet werden:
--
--   1./2. Hat jedes Set-Teil (jede Set-Figur) eine Katalogzeile? Ohne waere
--         die Stueckzahl nach Schritt 3 verloren — und zwar nicht auf 0,
--         sondern auf den Rueckfallwert 1, der fuer ein Set mit vier gleichen
--         Steinen falsch ist.
--   3.    Stimmen Abschrift und Katalog ueberein? Weichen sie ab, ist das
--         genau der Drift, um den es hier geht, und ein Mensch soll
--         entscheiden — nicht diese Migration.
--   4.    Dasselbe fuer die manuellen Positionen gegen ihre Erfassungen.
--         Migration 0035 garantiert fuer jede manuelle Position eine
--         Erfassung; weicht die Summe ab, ist die Spalte nachgelaufen.

DO $pruefung$
DECLARE
  teile_ohne   INTEGER := 0;
  figs_ohne    INTEGER := 0;
  teile_drift  INTEGER := 0;
  figs_drift   INTEGER := 0;
  man_drift      INTEGER := 0;
  man_figs_drift INTEGER := 0;
  beispiel       TEXT    := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'quantity') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM parts p
       WHERE COALESCE(p.source,'set') = 'set'
         AND p.set_number IS NOT NULL AND p.set_number <> ''
         AND NOT EXISTS (SELECT 1 FROM set_parts_catalog c
                          WHERE c.set_number  = p.set_number
                            AND c.part_number = p.part_number
                            AND c.color_id    = COALESCE(p.color_id, 0))
    $sql$ INTO teile_ohne;

    -- Je KONTO die Summe, nicht je Zeile: Zwei Zeilen desselben Teils im
    -- selben Set sind zusammen die Stueckzahl (siehe den Nachtrag oben).
    -- Zeilenweise verglichen meldete diese Pruefung eine Abweichung, wo gar
    -- keine ist — GEMESSEN am damaligen Aufbau von
    -- test/verwendende-sets-db.test.js (zwei Zeilen 10 + 5, Katalog 15):
    -- „Bei 2 Set-Teilen weicht parts.quantity vom Katalog ab".
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT p.user_id, p.set_number, p.part_number, COALESCE(p.color_id,0) AS farbe,
               SUM(COALESCE(p.quantity, 1))::int AS summe
          FROM parts p
         WHERE COALESCE(p.source,'set') = 'set'
         GROUP BY 1,2,3,4
      ) g
       JOIN set_parts_catalog c ON c.set_number  = g.set_number
                               AND c.part_number = g.part_number
                               AND c.color_id    = g.farbe
       WHERE g.summe <> COALESCE(c.quantity, 1)
    $sql$ INTO teile_drift;

    IF teile_drift > 0 THEN
      -- Ein Beispiel mit BEIDEN Zahlen: „3 Zeilen weichen ab" sagt nicht, wo
      -- man nachsieht und was zur Wahl steht.
      EXECUTE $sql$
        SELECT g.set_number || ' / ' || g.part_number || ' Farbe ' || g.farbe
               || ' (Konto ' || g.user_id || '): Bestand ' || g.summe
               || ', Katalog ' || COALESCE(c.quantity, 1)
          FROM (
            SELECT p.user_id, p.set_number, p.part_number, COALESCE(p.color_id,0) AS farbe,
                   SUM(COALESCE(p.quantity, 1))::int AS summe
              FROM parts p
             WHERE COALESCE(p.source,'set') = 'set'
             GROUP BY 1,2,3,4
          ) g
          JOIN set_parts_catalog c ON c.set_number  = g.set_number
                                  AND c.part_number = g.part_number
                                  AND c.color_id    = g.farbe
         WHERE g.summe <> COALESCE(c.quantity, 1)
         ORDER BY g.set_number, g.part_number, g.farbe, g.user_id
         LIMIT 1
      $sql$ INTO beispiel;
    END IF;

    EXECUTE $sql$
      SELECT COUNT(*) FROM parts p
       WHERE p.source = 'manual'
         AND COALESCE(p.quantity, 0) <> COALESCE(
               (SELECT SUM(a.quantity) FROM part_acquisitions a
                 WHERE a.user_id = p.user_id AND a.part_number = p.part_number
                   AND COALESCE(a.color_id, 0) = COALESCE(p.color_id, 0)), 0)
    $sql$ INTO man_drift;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'quantity') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM minifigs m
       WHERE COALESCE(m.source,'set') = 'set'
         AND m.set_number IS NOT NULL AND m.set_number <> ''
         AND NOT EXISTS (SELECT 1 FROM set_minifigs_catalog c
                          WHERE c.set_number = m.set_number
                            AND c.fig_number = m.fig_number)
    $sql$ INTO figs_ohne;

    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT m.user_id, m.set_number, m.fig_number,
               SUM(COALESCE(m.quantity, 1))::int AS summe
          FROM minifigs m
         WHERE COALESCE(m.source,'set') = 'set'
         GROUP BY 1,2,3
      ) g
       JOIN set_minifigs_catalog c ON c.set_number = g.set_number
                                  AND c.fig_number = g.fig_number
       WHERE g.summe <> COALESCE(c.quantity, 1)
    $sql$ INTO figs_drift;

    -- Die manuellen FIGUREN gegen ihre Erfassungen. Eigene Zaehlvariable und
    -- nicht in figs_ohne hineingerechnet: Hier stand
    -- `INTO figs_ohne USING figs_ohne` — ein Unsinn, USING uebergibt
    -- Parameter und addiert nichts; die Zahl wurde ueberschrieben und die
    -- Pruefung auf fehlende Katalogzeilen damit entwertet.
    EXECUTE $sql$
      SELECT COUNT(*) FROM minifigs m
       WHERE m.source = 'manual'
         AND COALESCE(m.quantity, 0) <> COALESCE(
               (SELECT SUM(a.quantity) FROM minifig_acquisitions a
                 WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number), 0)
    $sql$ INTO man_figs_drift;
  END IF;

  IF teile_ohne > 0 THEN
    RAISE EXCEPTION '% Set-Teile haben keine Katalogzeile — nichts geaendert.', teile_ohne;
  END IF;
  IF figs_ohne > 0 THEN
    RAISE EXCEPTION '% Set-Figuren haben keine Katalogzeile — nichts geaendert.', figs_ohne;
  END IF;
  IF teile_drift > 0 THEN
    RAISE EXCEPTION 'Bei % Set-Teilen weicht parts.quantity vom Katalog ab, z. B. %. Bitte von Hand entscheiden, welche Zahl gilt — nichts geaendert.',
      teile_drift, beispiel;
  END IF;
  IF figs_drift > 0 THEN
    RAISE EXCEPTION 'Bei % Set-Figuren weicht minifigs.quantity vom Katalog ab — nichts geaendert.', figs_drift;
  END IF;
  IF man_drift > 0 THEN
    RAISE EXCEPTION 'Bei % manuellen Teilen weicht quantity von der Summe der Erfassungen ab — nichts geaendert.', man_drift;
  END IF;
  IF man_figs_drift > 0 THEN
    RAISE EXCEPTION 'Bei % manuellen Figuren weicht quantity von der Summe der Erfassungen ab — nichts geaendert.', man_figs_drift;
  END IF;
END $pruefung$;

-- ── Schritt 3: doppelte Bestandszeilen zusammenlegen ────────────────────────
--
-- GEMESSEN: `parts` und `minifigs` tragen KEINEN eindeutigen Index ausser dem
-- Primaerschluessel auf `id`. Dasselbe Teil kann in derselben Farbe aus
-- demselben Set zweimal in der Tabelle stehen. Bis hierher war das (fast)
-- harmlos: Jede Zeile trug ihre eigene Stueckzahl, und die Listen addierten
-- sie. Ab Schritt 4 liest JEDE Zeile dieselbe Katalogzahl — zwei Zeilen
-- zaehlten dann doppelt.
--
-- Deshalb muss die Doppelung hier weg, und zwar NACH dem Nachtrag (der ihre
-- Summe in den Katalog getragen hat) und VOR dem Loeschen der Spalte. Die
-- kleinste id bleibt; `added_at` der aeltesten Zeile ist damit auch das, was
-- bleibt.
--
-- Dasselbe hat Migration 0008 fuer die Erfassungen getan, mit derselben
-- Reihenfolge: zusammenlegen, dann den eindeutigen Index setzen.

DELETE FROM parts a
 USING parts b
 WHERE a.user_id = b.user_id
   AND COALESCE(a.set_number, '') = COALESCE(b.set_number, '')
   AND a.part_number = b.part_number
   AND COALESCE(a.color_id, 0) = COALESCE(b.color_id, 0)
   AND a.id > b.id;

DELETE FROM minifigs a
 USING minifigs b
 WHERE a.user_id = b.user_id
   AND COALESCE(a.set_number, '') = COALESCE(b.set_number, '')
   AND a.fig_number = b.fig_number
   AND a.id > b.id;

-- ── Schritt 4: Spalten loeschen ─────────────────────────────────────────────

ALTER TABLE parts    DROP COLUMN IF EXISTS quantity;
ALTER TABLE minifigs DROP COLUMN IF EXISTS quantity;

-- ── Schritt 5: und die Doppelung kann nicht zurueckkommen ───────────────────
--
-- Die Importe schreiben `INSERT INTO parts (…) ON CONFLICT DO NOTHING` — und
-- das war bisher WIRKUNGSLOS: Ohne eindeutigen Index ausser auf `id` gab es
-- keinen Konflikt, auf den es haette treffen koennen. Jeder erneute Import
-- desselben Sets legte also neue Zeilen an. Mit diesen beiden Indizes trifft
-- die Klausel endlich das, was sie seit jeher meint.
--
-- COALESCE in den Ausdruecken, weil NULL in einem eindeutigen Index nicht mit
-- NULL kollidiert: Ohne das waeren zwei manuelle Zeilen (set_number IS NULL)
-- desselben Teils weiter erlaubt — genau der Fall, den es nicht geben soll.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_eindeutig
  ON parts (user_id, COALESCE(set_number, ''), part_number, COALESCE(color_id, 0));
CREATE UNIQUE INDEX IF NOT EXISTS idx_minifigs_eindeutig
  ON minifigs (user_id, COALESCE(set_number, ''), fig_number);

-- ── Schritt 6: die Indizes fuer die beiden neuen JOINs ─────────────────────
--
-- Die Fallunterscheidung verbindet je Bestandszeile mit dem Set-Katalog (fuer
-- source='set') und mit der gruppierten Erfassung (fuer source='manual'). Die
-- Katalogseite deckt der Primaerschluessel ab; auf der Erfassungsseite fehlte
-- bisher ein Index ueber Konto, Nummer UND Farbe.
CREATE INDEX IF NOT EXISTS idx_part_acq_gruppe
  ON part_acquisitions(user_id, part_number, color_id);
CREATE INDEX IF NOT EXISTS idx_minifig_acq_gruppe
  ON minifig_acquisitions(user_id, fig_number);
