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
    -- ── MAX, nicht die Summe — und das ist eine KORREKTUR ───────────────
    --
    -- Hier stand die Summe je Konto. Die Annahme dahinter: Zwei Zeilen fuer
    -- dieselbe Position seien zwei Anteile, die sich addieren (so stand es im
    -- damaligen Aufbau von test/verwendende-sets-db.test.js: 10 + 5 = 15).
    --
    -- Diese Annahme war FALSCH, und Marcos Installation hat sie widerlegt.
    -- `parts.quantity` hiess fuer ein Set-Teil „so viele stecken in EINEM
    -- Exemplar dieses Sets" — ein Wert, kein Anteil. Zwei Zeilen sind also
    -- KOPIEN derselben Aussage: utils/partsImport.ts schreibt bei jedem Lauf
    -- dieselbe Zahl, und weil das `ON CONFLICT DO NOTHING` ohne eindeutigen
    -- Index wirkungslos war, legte ein zweiter Import eine zweite Zeile mit
    -- DERSELBEN Zahl an.
    --
    -- GEMESSEN auf Marcos Installation (64403 Gruppen, 6684 mit Doppelten,
    -- hoechstens zwei Zeilen je Gruppe): 1776 Gruppen trugen zweimal
    -- dieselbe Zahl, und in keiner einzigen Gruppe wich eine EINZELNE Zeile
    -- vom Katalog ab. Die Summe hat daraus 6684 Scheinabweichungen gemacht —
    -- z. B. „Bestand 6, Katalog 3" fuer zwei Zeilen mit je 3.
    --
    -- Der alte Testaufbau war eine erfundene Vorlage, keine Beschreibung der
    -- Wirklichkeit. Ich habe ihn als Letzteres gelesen; das steht hier, damit
    -- es nicht noch einmal passiert.
    EXECUTE $sql$
      INSERT INTO set_parts_catalog (set_number, part_number, color_id, quantity)
      SELECT p.set_number, p.part_number, COALESCE(p.color_id, 0),
             GREATEST(MAX(COALESCE(p.quantity, 1)), 1)
        FROM parts p
       WHERE COALESCE(p.source, 'set') = 'set'
         AND p.set_number IS NOT NULL AND p.set_number <> ''
         AND NOT EXISTS (SELECT 1 FROM set_parts_catalog c
                          WHERE c.set_number  = p.set_number
                            AND c.part_number = p.part_number
                            AND c.color_id    = COALESCE(p.color_id, 0))
       GROUP BY p.set_number, p.part_number, COALESCE(p.color_id, 0)
      ON CONFLICT (set_number, part_number, color_id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'quantity') THEN
    -- Dieselbe Rechnung wie bei den Teilen darueber.
    EXECUTE $sql$
      INSERT INTO set_minifigs_catalog (set_number, fig_number, quantity)
      SELECT m.set_number, m.fig_number, GREATEST(MAX(COALESCE(m.quantity, 1)), 1)
        FROM minifigs m
       WHERE COALESCE(m.source, 'set') = 'set'
         AND m.set_number IS NOT NULL AND m.set_number <> ''
         AND NOT EXISTS (SELECT 1 FROM set_minifigs_catalog c
                          WHERE c.set_number = m.set_number
                            AND c.fig_number = m.fig_number)
       GROUP BY m.set_number, m.fig_number
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
  orte_streit    INTEGER := 0;
  orte_beispiel  TEXT    := '';
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

    -- ── Die Katalogzahl muss im Bestand VORKOMMEN ───────────────────────
    --
    -- Hier stand die Gruppensumme gegen den Katalog. Mit der Summe (siehe
    -- den Nachtrag oben) war das zweifach falsch:
    --
    --   * Zwei Kopien mit je 3 ergaben 6 und wurden als Abweichung von
    --     Katalog 3 gemeldet — 6684 Scheinbefunde auf Marcos Installation,
    --     obwohl dort KEINE einzelne Zeile vom Katalog abweicht.
    --   * Umgekehrt rutschte echte Uneinigkeit DURCH, wenn die Summe zufaellig
    --     passte: zwei Zeilen mit 6 und 4 bei Katalog 10 ergeben 10, und die
    --     Pruefung sah nichts. GEMESSEN an der eigenen Probe „doppelt".
    --
    -- Die Frage, auf die es ankommt, ist eine andere: Nach Schritt 4 gilt die
    -- KATALOGZAHL. Sie darf keine sein, die der Bestand nie gesehen hat. Also
    -- wird gezaehlt, in wie vielen Gruppen die Katalogzahl bei KEINER Zeile
    -- vorkommt.
    --
    -- Damit ist beides abgedeckt: Kopien, die mit dem Katalog einig sind,
    -- laufen durch; zwei Zeilen 6 und 4 bei Katalog 10 halten an, weil weder
    -- 6 noch 4 die 10 ist.
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT p.user_id, p.set_number, p.part_number, COALESCE(p.color_id,0) AS farbe,
               BOOL_OR(COALESCE(p.quantity, 1) = COALESCE(c.quantity, 1)) AS trifft
          FROM parts p
          JOIN set_parts_catalog c ON c.set_number  = p.set_number
                                  AND c.part_number = p.part_number
                                  AND c.color_id    = COALESCE(p.color_id, 0)
         WHERE COALESCE(p.source,'set') = 'set'
         GROUP BY 1,2,3,4
      ) g
       WHERE NOT g.trifft
    $sql$ INTO teile_drift;

    IF teile_drift > 0 THEN
      -- Ein Beispiel mit BEIDEN Zahlen: „3 Zeilen weichen ab" sagt nicht, wo
      -- man nachsieht und was zur Wahl steht.
      -- Das Beispiel nennt ALLE Zahlen des Bestands, nicht ihre Summe: Bei
      -- zwei Zeilen soll dastehen „Bestand 6, 4 — Katalog 10", damit zu sehen
      -- ist, dass keine der beiden die Katalogzahl ist. „Bestand 10" waere
      -- hier die irrefuehrendste Auskunft von allen.
      EXECUTE $sql$
        SELECT g.set_number || ' / ' || g.part_number || ' Farbe ' || g.farbe
               || ' (Konto ' || g.user_id || '): Bestand ' || g.zahlen
               || ', Katalog ' || g.kat
          FROM (
            SELECT p.user_id, p.set_number, p.part_number, COALESCE(p.color_id,0) AS farbe,
                   STRING_AGG(DISTINCT COALESCE(p.quantity, 1)::text, ', ') AS zahlen,
                   COALESCE(c.quantity, 1) AS kat,
                   BOOL_OR(COALESCE(p.quantity, 1) = COALESCE(c.quantity, 1)) AS trifft
              FROM parts p
              JOIN set_parts_catalog c ON c.set_number  = p.set_number
                                      AND c.part_number = p.part_number
                                      AND c.color_id    = COALESCE(p.color_id, 0)
             WHERE COALESCE(p.source,'set') = 'set'
             GROUP BY 1,2,3,4, COALESCE(c.quantity, 1)
          ) g
         WHERE NOT g.trifft
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

  -- ── Doppelte, die in VERSCHIEDENEN Kisten liegen ─────────────────────────
  --
  -- Schritt 3 legt die Doppelten zusammen und rettet dabei einen Lagerort,
  -- wenn nur eine der Zeilen einen traegt. Tragen sie VERSCHIEDENE, ist das
  -- keine Rettung mehr: Eine Zeile kann nur an einem Ort liegen, und welcher
  -- gilt, kann diese Migration nicht wissen. Also anhalten.
  --
  -- Ohne Spaltenpruefung, denn storage_id bleibt — aber nur, solange es
  -- ueberhaupt Doppelte geben kann, und die gibt es nach Schritt 5 nicht mehr.
  SELECT COUNT(*) INTO orte_streit FROM (
    SELECT p.user_id, COALESCE(p.set_number, '') AS setnr, p.part_number,
           COALESCE(p.color_id, 0) AS farbe
      FROM parts p
     GROUP BY 1,2,3,4
    HAVING COUNT(DISTINCT p.storage_id) > 1
  ) g;

  IF orte_streit > 0 THEN
    SELECT g.setnr || ' / ' || g.part_number || ' Farbe ' || g.farbe
           || ' (Konto ' || g.user_id || '): Orte ' || g.orte
      INTO orte_beispiel
      FROM (
        SELECT p.user_id, COALESCE(p.set_number, '') AS setnr, p.part_number,
               COALESCE(p.color_id, 0) AS farbe,
               STRING_AGG(DISTINCT COALESCE(l.name, '(ohne)'), ', ') AS orte
          FROM parts p
          LEFT JOIN storage_locations l ON l.id = p.storage_id
         GROUP BY 1,2,3,4
        HAVING COUNT(DISTINCT p.storage_id) > 1
      ) g
     ORDER BY g.setnr, g.part_number, g.farbe, g.user_id
     LIMIT 1;
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

    -- Dieselbe Frage wie bei den Teilen darueber.
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT m.user_id, m.set_number, m.fig_number,
               BOOL_OR(COALESCE(m.quantity, 1) = COALESCE(c.quantity, 1)) AS trifft
          FROM minifigs m
          JOIN set_minifigs_catalog c ON c.set_number = m.set_number
                                     AND c.fig_number = m.fig_number
         WHERE COALESCE(m.source,'set') = 'set'
         GROUP BY 1,2,3
      ) g
       WHERE NOT g.trifft
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
    RAISE EXCEPTION 'Bei % Set-Teilen kommt die Katalogzahl im Bestand nicht vor, z. B. %. Bitte von Hand entscheiden, welche Zahl gilt — nichts geaendert.',
      teile_drift, beispiel;
  END IF;
  IF figs_drift > 0 THEN
    RAISE EXCEPTION 'Bei % Set-Figuren kommt die Katalogzahl im Bestand nicht vor — nichts geaendert.', figs_drift;
  END IF;
  IF man_drift > 0 THEN
    RAISE EXCEPTION 'Bei % manuellen Teilen weicht quantity von der Summe der Erfassungen ab — nichts geaendert.', man_drift;
  END IF;
  IF man_figs_drift > 0 THEN
    RAISE EXCEPTION 'Bei % manuellen Figuren weicht quantity von der Summe der Erfassungen ab — nichts geaendert.', man_figs_drift;
  END IF;
  IF orte_streit > 0 THEN
    RAISE EXCEPTION '% Positionen stehen doppelt im Bestand und liegen an VERSCHIEDENEN Lagerorten, z. B. %. Zusammengelegt kann nur einer bleiben — bitte von Hand entscheiden; nichts geaendert.',
      orte_streit, orte_beispiel;
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

-- ── Erst den LAGERORT retten, dann loeschen ────────────────────────────────
--
-- Die kleinste id bleibt — aber sie ist nicht unbedingt die Zeile mit dem
-- Lagerort. Traegt die bleibende Zeile keinen und eine der Doppelten schon,
-- ginge er beim Loeschen verloren, und zwar stumm: Der Vorrat (Migration
-- 0031) zeigte den Ort weiter, nur stuende kein Teil mehr darin.
--
-- Das ist ein Befund an Marcos Daten, kein gedachter Fall — deshalb steht die
-- Frage danach auch im Riegel oben: Tragen die Doppelten VERSCHIEDENE Orte,
-- ist das keine Rettung mehr, sondern eine Entscheidung, und die trifft ein
-- Mensch. Hier wird nur der Fall „die eine hat einen, die andere keinen"
-- aufgeloest.
UPDATE parts z
   SET storage_id = (
     SELECT MIN(w.storage_id) FROM parts w
      WHERE w.user_id = z.user_id
        AND COALESCE(w.set_number, '') = COALESCE(z.set_number, '')
        AND w.part_number = z.part_number
        AND COALESCE(w.color_id, 0) = COALESCE(z.color_id, 0)
        AND w.storage_id IS NOT NULL)
 WHERE z.storage_id IS NULL
   AND EXISTS (
     SELECT 1 FROM parts w
      WHERE w.user_id = z.user_id
        AND COALESCE(w.set_number, '') = COALESCE(z.set_number, '')
        AND w.part_number = z.part_number
        AND COALESCE(w.color_id, 0) = COALESCE(z.color_id, 0)
        AND w.storage_id IS NOT NULL);

DELETE FROM parts a
 USING parts b
 WHERE a.user_id = b.user_id
   AND COALESCE(a.set_number, '') = COALESCE(b.set_number, '')
   AND a.part_number = b.part_number
   AND COALESCE(a.color_id, 0) = COALESCE(b.color_id, 0)
   AND a.id > b.id;

-- Derselbe Schutz fuer die Figuren.
UPDATE minifigs z
   SET storage_id = (
     SELECT MIN(w.storage_id) FROM minifigs w
      WHERE w.user_id = z.user_id
        AND COALESCE(w.set_number, '') = COALESCE(z.set_number, '')
        AND w.fig_number = z.fig_number
        AND w.storage_id IS NOT NULL)
 WHERE z.storage_id IS NULL
   AND EXISTS (
     SELECT 1 FROM minifigs w
      WHERE w.user_id = z.user_id
        AND COALESCE(w.set_number, '') = COALESCE(z.set_number, '')
        AND w.fig_number = z.fig_number
        AND w.storage_id IS NOT NULL);

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
