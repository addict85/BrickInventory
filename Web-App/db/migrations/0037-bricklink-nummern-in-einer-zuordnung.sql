-- 0037 — Die BrickLink-Nummern stehen in EINER Zuordnungstabelle
--
-- ── Marcos Vorgabe ──────────────────────────────────────────────────────────
--
--   „ich würde mir für die bl_*_number Spalten eine Mapping-Tabelle vorstellen
--    mit der Spalte RB_id und BL_id dort werden alle alle Minifiguren, Parts
--    und Sets mit den Mappings abgelegt."
--
-- Und auf die Rückfrage, ob eine Tabelle mit Art-Unterscheidung oder drei:
-- „ja, eigene Tabelle mit Art-Unterscheidung ist richtig".
--
-- ── Was heute wo steht (GEMESSEN) ───────────────────────────────────────────
--
--   rb_bl_mapping(part_num, bl_part_num)   katalogweit   die Zuordnung selbst
--   parts.bl_part_number                   JE KONTO      Abschrift
--   set_parts_catalog.bl_part_number       je Set+Teil   Abschrift
--   minifigs.bl_fig_number                 JE KONTO      Abschrift
--   parts_summary.bl_part_number           vorberechnet   bleibt (Zwischenspeicher)
--   rb_colors.bl_color_id                  katalogweit   bleibt (Farben)
--
-- Dass die drei Abschriften genau das sind, steht im Baum selbst:
-- utils/partsImport.ts trug eine Funktion namens syncBlPartNumbers(), deren
-- ganze Aufgabe darin bestand, rb_bl_mapping in parts und set_parts_catalog
-- zu KOPIEREN. Der Kommentar darüber: „Sync bl_part_number from rb_bl_mapping
-- table (called after CSV sync)". Mit dieser Migration fällt die Funktion weg,
-- weil es nichts mehr zu kopieren gibt.
--
-- Eine BrickLink-Nummer sagt: „dieses Teil heisst dort so". Das ist eine
-- Eigenschaft DES TEILS, nicht meines Exemplars. Deshalb gehört sie neben
-- part_catalog und minifigs_catalog (Migration 0034) in eine gemeinsame
-- Tabelle, nicht an die Bestandszeile.
--
-- ── Sets ────────────────────────────────────────────────────────────────────
--
-- GEMESSEN: Für Sets gibt es nirgends eine BrickLink-Nummer — BrickLink
-- benutzt dieselben Setnummern wie Rebrickable. Die Art 'set' wird deshalb
-- angelegt und bleibt zunächst leer. Sie ist da, wenn sich das für ein
-- einzelnes Set einmal unterscheidet, und sie kostet nichts: Eine Tabelle mit
-- Art-Unterscheidung wächst um Zeilen, nicht um Spalten.
--
-- ── Reihenfolge ─────────────────────────────────────────────────────────────
--
-- Schritt 1 legt die Tabelle an und trägt alle vier Quellen zusammen.
-- Schritt 2 ist der Riegel: Er bricht ab, wenn eine Nummer verloren ginge
--           ODER wenn zwei Konten derselben Nummer VERSCHIEDENE
--           BrickLink-Nummern gegeben haben.
-- Schritt 3 löscht die drei Abschriften und die alte Teil-Tabelle.

-- ── Schritt 1: Tabelle und Nachtrag ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bl_zuordnung (
  -- 'part', 'fig' oder 'set'. Text und kein Aufzählungstyp: Eine neue Art
  -- dazuzunehmen soll kein ALTER TYPE brauchen, und der CHECK sagt dasselbe.
  art        TEXT NOT NULL,
  rb_id      TEXT NOT NULL,
  -- NULL ist erlaubt und bedeutet etwas: „nachgesehen, es gibt keine
  -- abweichende Nummer". Genau diese Notiz hielt rb_bl_mapping bisher als
  -- `bl_part_num = part_num` fest (merkeBlNummerUnveraendert), damit dasselbe
  -- Teil nicht immer wieder abgefragt wird.
  bl_id      TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (art, rb_id),
  CONSTRAINT bl_zuordnung_art CHECK (art IN ('part', 'fig', 'set'))
);

-- Die Suche nach der BL-Nummer geht auch rückwärts: utils/finance/preise.ts
-- fragt „welches Rebrickable-Teil ist das hier?", wenn BrickLink antwortet.
CREATE INDEX IF NOT EXISTS idx_bl_zuordnung_bl ON bl_zuordnung(art, bl_id);

-- Im DO-Block mit Spaltenprüfung: Auf einer Datenbank, die diese Migration
-- schon gesehen hat, sind die Spalten weg und die Abfragen wären ein harter
-- Fehler. Dieselbe Bauart wie in 0032 bis 0036.

DO $nachtrag$
BEGIN
  -- ── Quelle 1: rb_bl_mapping, die Zuordnung selbst ────────────────────────
  --
  -- Zuerst, weil sie die verlässlichste ist: Sie wird ausschliesslich über
  -- utils/blZuordnung.ts geschrieben, aus den Rebrickable- und
  -- BrickLink-Antworten. Die drei Abschriften darunter dürfen sie nicht
  -- überschreiben (DO NOTHING), sie dürfen nur ergänzen.
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'rb_bl_mapping') THEN
    -- NULLIF(bl_part_num, part_num): EINE Schreibweise fuer „es gibt keine
    -- abweichende Nummer". rb_bl_mapping hielt diese Notiz als
    -- `bl_part_num = part_num` fest (merkeBlNummerUnveraendert), die beiden
    -- Abschriften als dieselbe Nummer oder als NULL. Wuerden beide Formen
    -- uebernommen, stuenden in einer Spalte zwei Schreibweisen fuer dieselbe
    -- Aussage — und die naechste Abfrage muesste beide kennen.
    --
    -- Die ZEILE bleibt dabei stehen, nur ihr Wert wird NULL. Das ist der
    -- Unterschied, auf den es ankommt: „Zeile da, bl_id leer" heisst
    -- nachgesehen, „keine Zeile" heisst noch nicht nachgesehen. Nur das erste
    -- verhindert, dass dasselbe Teil wieder abgefragt wird.
    EXECUTE $sql$
      INSERT INTO bl_zuordnung (art, rb_id, bl_id, fetched_at)
      SELECT 'part', part_num, NULLIF(bl_part_num, part_num), COALESCE(fetched_at, NOW())
        FROM rb_bl_mapping
       WHERE part_num IS NOT NULL AND part_num <> ''
      ON CONFLICT (art, rb_id) DO NOTHING
    $sql$;
  END IF;

  -- ── Quelle 2: der Set-Teile-Katalog ─────────────────────────────────────
  --
  -- NULLIF auf die Gleichheit mit der Rebrickable-Nummer: Steht dort dieselbe
  -- Nummer, ist das die Notiz „keine abweichende" und keine Zuordnung. Als
  -- bl_id NULL geschrieben heisst sie dasselbe und sagt es deutlicher.
  --
  -- DISTINCT ON: Dasselbe Teil steckt in vielen Sets, also stehen dort viele
  -- Zeilen dazu. Die Abweichung zwischen ihnen faengt der Riegel, nicht dieser
  -- Nachtrag.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'set_parts_catalog' AND column_name = 'bl_part_number') THEN
    EXECUTE $sql$
      INSERT INTO bl_zuordnung (art, rb_id, bl_id)
      SELECT DISTINCT ON (part_number) 'part', part_number,
             NULLIF(NULLIF(bl_part_number, ''), part_number)
        FROM set_parts_catalog
       WHERE part_number IS NOT NULL AND part_number <> ''
         AND bl_part_number IS NOT NULL AND bl_part_number <> ''
       ORDER BY part_number, (bl_part_number = part_number), bl_part_number
      ON CONFLICT (art, rb_id) DO NOTHING
    $sql$;
  END IF;

  -- ── Quelle 3: die Bestandszeilen der Teile ──────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'bl_part_number') THEN
    EXECUTE $sql$
      INSERT INTO bl_zuordnung (art, rb_id, bl_id)
      SELECT DISTINCT ON (part_number) 'part', part_number,
             NULLIF(NULLIF(bl_part_number, ''), part_number)
        FROM parts
       WHERE part_number IS NOT NULL AND part_number <> ''
         AND bl_part_number IS NOT NULL AND bl_part_number <> ''
       ORDER BY part_number, (bl_part_number = part_number), bl_part_number
      ON CONFLICT (art, rb_id) DO NOTHING
    $sql$;
  END IF;

  -- ── Quelle 4: die Minifiguren ───────────────────────────────────────────
  --
  -- Hier ist die Nummer oft von Hand eingegeben (routes/minifigs.ts nimmt
  -- bl_fig_number aus der Eingabe), und zwar je Konto. Genau deshalb prueft
  -- der Riegel unten auf Widerspruch: Zwei Konten koennen derselben Figur
  -- verschiedene Nummern gegeben haben, und dann darf diese Migration nicht
  -- die eine gewinnen lassen.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'bl_fig_number') THEN
    EXECUTE $sql$
      INSERT INTO bl_zuordnung (art, rb_id, bl_id)
      SELECT DISTINCT ON (fig_number) 'fig', fig_number,
             NULLIF(NULLIF(bl_fig_number, ''), fig_number)
        FROM minifigs
       WHERE fig_number IS NOT NULL AND fig_number <> ''
         AND bl_fig_number IS NOT NULL AND bl_fig_number <> ''
       ORDER BY fig_number, (bl_fig_number = fig_number), bl_fig_number
      ON CONFLICT (art, rb_id) DO NOTHING
    $sql$;
  END IF;
END $nachtrag$;

-- ── Schritt 2: Riegel ───────────────────────────────────────────────────────
--
-- Drei Fragen, und alle drei müssen mit 0 beantwortet werden:
--
--   1. Verliert ein Teil seine Nummer? Steht in parts oder
--      set_parts_catalog eine ABWEICHENDE BrickLink-Nummer, zu der es keine
--      Zeile in bl_zuordnung gibt, wäre sie nach Schritt 3 weg — und mit ihr
--      der Marktpreis dieses Teils.
--   2. Dasselbe für die Figuren.
--   3. Widersprechen sich zwei Quellen? Dann soll ein Mensch entscheiden,
--      welche Nummer gilt, nicht diese Migration. Das ist der Fall, der bei
--      den Figuren wirklich auftreten kann: Die Nummer wird dort von Hand
--      eingegeben, je Konto.

DO $pruefung$
DECLARE
  teile_offen  INTEGER := 0;
  figs_offen   INTEGER := 0;
  streitig     INTEGER := 0;
  alte_offen   INTEGER := 0;
  beispiel     TEXT    := '';
BEGIN
  -- Frage 0: Ist die alte Zuordnungstabelle vollstaendig uebernommen? Sie ist
  -- die Quelle, die Schritt 3 als GANZE Tabelle loescht — bei ihr gibt es
  -- keine Spalte, an der ein Rest haengen bliebe.
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'rb_bl_mapping') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM rb_bl_mapping r
       WHERE r.part_num IS NOT NULL AND r.part_num <> ''
         AND NOT EXISTS (SELECT 1 FROM bl_zuordnung z
                          WHERE z.art = 'part' AND z.rb_id = r.part_num)
    $sql$ INTO alte_offen;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'bl_part_number') THEN
    -- BEIDE Teil-Quellen, nicht nur die Bestandszeilen: Schritt 3 loescht
    -- auch set_parts_catalog.bl_part_number, und eine Nummer, die nur dort
    -- steht, waere danach genauso weg. Der erste Entwurf dieser Pruefung sah
    -- nur `parts` an — gemessen an einer Lage mit einer Nummer in jeder der
    -- beiden Quellen meldete sie „1 Teile" statt 2.
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT DISTINCT rb, bl FROM (
          SELECT part_number AS rb, bl_part_number AS bl FROM parts
          UNION ALL
          SELECT part_number, bl_part_number FROM set_parts_catalog
        ) q
         WHERE bl IS NOT NULL AND bl <> '' AND bl <> rb
           AND NOT EXISTS (SELECT 1 FROM bl_zuordnung z
                            WHERE z.art = 'part' AND z.rb_id = q.rb)
      ) x
    $sql$ INTO teile_offen;

    -- Widersprueche: dieselbe Rebrickable-Nummer, zwei verschiedene
    -- BrickLink-Nummern — ueber ALLE Quellen hinweg, die Zuordnung selbst
    -- eingeschlossen.
    --
    -- Die Abfrage liest parts, set_parts_catalog UND minifigs, steht aber
    -- unter der Pruefung auf parts.bl_part_number. Das ist richtig und nicht
    -- Schlamperei: Schritt 3 loescht alle drei Spalten in EINER Migration, es
    -- gibt also keinen Stand, in dem die eine da ist und die andere nicht.
    -- Wuerde das je getrennt, muesste diese Pruefung mit.
    EXECUTE $sql$
      WITH alle AS (
        SELECT 'part'::text AS art, part_number AS rb, bl_part_number AS bl FROM parts
         WHERE bl_part_number IS NOT NULL AND bl_part_number <> ''
           AND bl_part_number <> part_number
        UNION
        SELECT 'part', part_number, bl_part_number FROM set_parts_catalog
         WHERE bl_part_number IS NOT NULL AND bl_part_number <> ''
           AND bl_part_number <> part_number
        UNION
        SELECT 'fig', fig_number, bl_fig_number FROM minifigs
         WHERE bl_fig_number IS NOT NULL AND bl_fig_number <> ''
           AND bl_fig_number <> fig_number
        UNION
        SELECT art, rb_id, bl_id FROM bl_zuordnung
         WHERE bl_id IS NOT NULL AND bl_id <> rb_id
      )
      SELECT COUNT(*) FROM (
        SELECT art, rb FROM alle GROUP BY art, rb HAVING COUNT(DISTINCT bl) > 1
      ) y
    $sql$ INTO streitig;

    IF streitig > 0 THEN
      -- Ein Beispiel in die Meldung, mit BEIDEN Nummern: „3 Widersprueche"
      -- sagt nicht, wo man nachsieht und was zur Wahl steht.
      EXECUTE $sql$
        WITH alle AS (
          SELECT 'part'::text AS art, part_number AS rb, bl_part_number AS bl FROM parts
           WHERE bl_part_number IS NOT NULL AND bl_part_number <> ''
             AND bl_part_number <> part_number
          UNION
          SELECT 'part', part_number, bl_part_number FROM set_parts_catalog
           WHERE bl_part_number IS NOT NULL AND bl_part_number <> ''
             AND bl_part_number <> part_number
          UNION
          SELECT 'fig', fig_number, bl_fig_number FROM minifigs
           WHERE bl_fig_number IS NOT NULL AND bl_fig_number <> ''
             AND bl_fig_number <> fig_number
          UNION
          SELECT art, rb_id, bl_id FROM bl_zuordnung
           WHERE bl_id IS NOT NULL AND bl_id <> rb_id
        )
        SELECT art || ' ' || rb || ': ' || string_agg(DISTINCT bl, ' oder ')
          FROM alle GROUP BY art, rb HAVING COUNT(DISTINCT bl) > 1
         ORDER BY art, rb LIMIT 1
      $sql$ INTO beispiel;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'bl_fig_number') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT DISTINCT m.fig_number, m.bl_fig_number
          FROM minifigs m
         WHERE m.bl_fig_number IS NOT NULL AND m.bl_fig_number <> ''
           AND m.bl_fig_number <> m.fig_number
           AND NOT EXISTS (SELECT 1 FROM bl_zuordnung z
                            WHERE z.art = 'fig' AND z.rb_id = m.fig_number)
      ) x
    $sql$ INTO figs_offen;
  END IF;

  IF alte_offen > 0 THEN
    RAISE EXCEPTION '% Zeilen aus rb_bl_mapping sind nicht uebernommen — nichts geaendert.', alte_offen;
  END IF;
  IF teile_offen > 0 THEN
    RAISE EXCEPTION '% Teile wuerden ihre BrickLink-Nummer verlieren — nichts geaendert.', teile_offen;
  END IF;
  IF figs_offen > 0 THEN
    RAISE EXCEPTION '% Figuren wuerden ihre BrickLink-Nummer verlieren — nichts geaendert.', figs_offen;
  END IF;
  IF streitig > 0 THEN
    RAISE EXCEPTION 'Bei % Nummern widersprechen sich die Quellen, z. B. %. Bitte von Hand entscheiden, welche gilt — nichts geaendert.',
      streitig, beispiel;
  END IF;
END $pruefung$;

-- ── Schritt 3: Abschriften loeschen ─────────────────────────────────────────
--
-- Die Teil-Indizes auf den Spalten gehen mit ihnen (Postgres entfernt
-- abhaengige Indizes selbst): idx_parts_blnum aus Migration 0015 hing an
-- parts.bl_part_number. Der Trigramm-Index auf parts_summary.bl_part_number
-- (Migration 0029) bleibt — diese Spalte ist ein Zwischenspeicher und bleibt
-- stehen.

ALTER TABLE parts             DROP COLUMN IF EXISTS bl_part_number;
ALTER TABLE set_parts_catalog DROP COLUMN IF EXISTS bl_part_number;
ALTER TABLE minifigs          DROP COLUMN IF EXISTS bl_fig_number;

-- ── Und der Ersatz fuer idx_parts_group ─────────────────────────────────────
--
-- Mit der Spalte faellt auch der funktionale Index
--
--     idx_parts_group ON parts(user_id, (COALESCE(bl_part_number, part_number)), color_id)
--
-- den db/database.ts anlegte. Er stand auf genau dem Ausdruck, nach dem
-- getParts() gruppiert, und GEMESSEN an 380 Sets / 171'000 Zeilen halbierte er
-- die Zeit einer Seitenabfrage (372 ms → 190 ms).
--
-- Ein funktionaler Index darf nur Spalten SEINER Tabelle enthalten. Der
-- Gruppierungsausdruck liest jetzt bl_zuordnung, also ist dieser Index nicht
-- umgezogen, sondern unmoeglich geworden — das ist der Preis dafuer, dass die
-- Nummer nur noch an einer Stelle steht. Was bleibt, ist ein Index auf die
-- EINGAENGE der Gruppierung; die Zuordnung haengt Postgres per Hash-Join an
-- (wenige zehntausend Zeilen, passt in den Arbeitsspeicher).
--
-- Entscheidend ist ohnehin, dass der heisse Weg gar nicht hierher laeuft: Die
-- Teileansicht liest die vorberechnete Zusammenfassung, und die traegt den
-- Gruppenschluessel als fertige Spalte part_key (utils/partsSummary.ts).
CREATE INDEX IF NOT EXISTS idx_parts_gruppe ON parts(user_id, part_number, color_id);

-- Und die alte Teil-Tabelle: Ihr ganzer Inhalt steht jetzt als Art 'part' in
-- bl_zuordnung. Sie stehen zu lassen hiesse, zwei Orte fuer dieselbe Aussage
-- zu haben — genau das, was diese Reihe von Migrationen abbaut.
DROP TABLE IF EXISTS rb_bl_mapping;
