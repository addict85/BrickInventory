-- 0034 — Stammdaten von Teilen und Minifiguren in eigene Kataloge
--
-- ── Worum es geht ───────────────────────────────────────────────────────────
--
-- `parts` und `minifigs` sind BESTANDStabellen: eine Zeile sagt, WER WELCHES
-- Teil in welcher Farbe aus welchem Set hat. Sie trugen daneben aber auch die
-- Beschreibung des Teils mit — Name, Farbbezeichnung, Farbcode, Kategorie,
-- Bild — und zwar je Konto neu. Dieselbe Beschreibung desselben Teils lag
-- damit so oft in der Datenbank, wie es Konten gibt, die es besitzen.
--
-- Diese Angaben haengen nicht am Konto. Sie gehoeren in einen Katalog, genau
-- wie die Set-Stammdaten seit Migration 0033 in `set_catalog` stehen.
--
-- ── Warum eigene Tabellen und nicht rb_parts/rb_colors ──────────────────────
--
-- Naheliegend waere, die Beschreibung in den vorhandenen Rebrickable-Spiegeln
-- `rb_parts` und `rb_colors` unterzubringen. Das geht nicht, und das ist
-- NACHGESEHEN, nicht vermutet: jobs/csvImportWorker.ts fuellt beide ueber
-- importiereMitTausch(), und dieses Verfahren macht `DELETE FROM <tabelle>`
-- und schreibt den CSV-Inhalt neu. Alles, was wir dort nachtragen, waere beim
-- naechsten Tageslauf weg. Die Spiegel bleiben also reine Spiegel.
--
-- ── Die drei neuen Tabellen ─────────────────────────────────────────────────
--
-- part_catalog        je Teilenummer:          Name, Kategorie
-- part_color_catalog  je Teilenummer + Farbe:  Farbname, Farbcode, Bild
-- minifigs_catalog    je Figurennummer:        Name, Bild
--
-- Warum das Bild an der FARBE haengt und nicht am Teil: Ein 2x4-Stein in Rot
-- und derselbe in Blau haben verschiedene Bilder. `set_parts_catalog` fuehrt
-- es deshalb schon heute je (set_number, part_number, color_id).
--
-- `part_color_catalog` ist bewusst genau `set_parts_catalog` ohne set_number,
-- is_spare und quantity — eine Form, die im Baum vorhanden und erprobt ist.
-- Farbname und Farbcode stehen darin je (Teil, Farbe) und nicht in einer
-- vierten, farbreinen Tabelle: Die kleine Wiederholung gibt es in
-- `set_parts_catalog` bereits, und eine weitere Tabelle waere ein zweiter
-- Ort fuer dieselbe Entscheidung.
--
-- ── Was NICHT hierher wandert ───────────────────────────────────────────────
--
-- is_spare   steht je (Set, Teil, Farbe) schon in `set_parts_catalog` — es ist
--            eine Eigenschaft der TEILELISTE eines Sets, nicht des Teils.
-- created_at war in `parts` die zweite Spalte neben `added_at`, mit derselben
--            Bedeutung. Sie fliegt, nachdem added_at daraus nachgefuellt ist.
--
-- Kaufpreis, Einzelpreis, Zustand und Menge bleiben in diesem Schritt stehen;
-- sie gehoeren in die Erfassungstabellen und sind der naechste Schritt.
--
-- ── Reihenfolge ─────────────────────────────────────────────────────────────
--
-- Schritt 1 fuellt die Kataloge aus allem, was da ist.
-- Schritt 2 ist der Riegel: Er bricht ab, wenn ein Bestand seinen Namen
--           verlieren wuerde. Lieber eine Migration, die stehenbleibt, als
--           eine Teileliste ohne Teilenamen.
-- Schritt 3 loescht die Spalten.

-- ── Schritt 1: Kataloge anlegen ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS part_catalog (
  part_number   TEXT PRIMARY KEY,
  part_name     TEXT,
  category_name TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_color_catalog (
  part_number   TEXT NOT NULL,
  color_id      INTEGER NOT NULL,
  color_name    TEXT,
  color_hex     TEXT,
  image_url     TEXT,
  image_local   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (part_number, color_id)
);

CREATE TABLE IF NOT EXISTS minifigs_catalog (
  fig_number    TEXT PRIMARY KEY,
  fig_name      TEXT,
  image_url     TEXT,
  image_local   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Schritt 1b: aus dem Set-Teilekatalog fuellen ────────────────────────────
--
-- Zuerst `set_parts_catalog`: Das ist die gepflegte Quelle (die Importe
-- schreiben sie mit DO UPDATE, `parts` nur mit DO NOTHING). MAX() uebergeht
-- NULL-Werte, und ueber mehrere Sets hinweg ist der Name derselbe.

INSERT INTO part_catalog (part_number, part_name, category_name)
SELECT spc.part_number, MAX(spc.part_name), MAX(NULLIF(spc.category_name, 'Unknown'))
  FROM set_parts_catalog spc
 WHERE spc.part_number IS NOT NULL AND spc.part_number <> ''
 GROUP BY spc.part_number
    ON CONFLICT (part_number) DO UPDATE
   SET part_name     = COALESCE(part_catalog.part_name,     EXCLUDED.part_name),
       category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name);

INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
SELECT spc.part_number, spc.color_id,
       MAX(spc.color_name), MAX(spc.color_hex), MAX(spc.image_url), MAX(spc.image_local)
  FROM set_parts_catalog spc
 WHERE spc.part_number IS NOT NULL AND spc.part_number <> '' AND spc.color_id IS NOT NULL
 GROUP BY spc.part_number, spc.color_id
    ON CONFLICT (part_number, color_id) DO UPDATE
   SET color_name  = COALESCE(part_color_catalog.color_name,  EXCLUDED.color_name),
       color_hex   = COALESCE(part_color_catalog.color_hex,   EXCLUDED.color_hex),
       image_url   = COALESCE(part_color_catalog.image_url,   EXCLUDED.image_url),
       image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local);

INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local)
SELECT smc.fig_number, MAX(smc.fig_name), MAX(smc.image_url), MAX(smc.image_local)
  FROM set_minifigs_catalog smc
 WHERE smc.fig_number IS NOT NULL AND smc.fig_number <> ''
 GROUP BY smc.fig_number
    ON CONFLICT (fig_number) DO UPDATE
   SET fig_name    = COALESCE(minifigs_catalog.fig_name,    EXCLUDED.fig_name),
       image_url   = COALESCE(minifigs_catalog.image_url,   EXCLUDED.image_url),
       image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local);

-- ── Schritt 1c: aus dem Bestand nachfuellen ─────────────────────────────────
--
-- Manuell erfasste Positionen haben keine Set-Nummer und stehen in keinem
-- Set-Teilekatalog. Ihre Beschreibung gibt es nur in `parts`/`minifigs` — sie
-- muss hier herueber, sonst loescht Schritt 3 sie weg.
--
-- In einem DO-Block mit Spaltenpruefung: Auf einer Datenbank, die diese
-- Migration schon einmal gesehen hat, sind die Spalten weg, und die Abfrage
-- waere ein harter Fehler. Dieselbe Bauart wie der Nachtrag in 0032.

DO $nachtrag$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'part_name') THEN
    EXECUTE $sql$
      INSERT INTO part_catalog (part_number, part_name, category_name)
      SELECT p.part_number, MAX(p.part_name), MAX(NULLIF(p.category_name, 'Unknown'))
        FROM parts p
       WHERE p.part_number IS NOT NULL AND p.part_number <> ''
       GROUP BY p.part_number
          ON CONFLICT (part_number) DO UPDATE
         SET part_name     = COALESCE(part_catalog.part_name,     EXCLUDED.part_name),
             category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name)
    $sql$;

    EXECUTE $sql$
      INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
      SELECT p.part_number, p.color_id,
             MAX(p.color_name), MAX(p.color_hex), MAX(p.image_url), MAX(p.image_local)
        FROM parts p
       WHERE p.part_number IS NOT NULL AND p.part_number <> '' AND p.color_id IS NOT NULL
       GROUP BY p.part_number, p.color_id
          ON CONFLICT (part_number, color_id) DO UPDATE
         SET color_name  = COALESCE(part_color_catalog.color_name,  EXCLUDED.color_name),
             color_hex   = COALESCE(part_color_catalog.color_hex,   EXCLUDED.color_hex),
             image_url   = COALESCE(part_color_catalog.image_url,   EXCLUDED.image_url),
             image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local)
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'fig_name') THEN
    EXECUTE $sql$
      INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local)
      SELECT m.fig_number, MAX(m.fig_name), MAX(m.image_url), MAX(m.image_local)
        FROM minifigs m
       WHERE m.fig_number IS NOT NULL AND m.fig_number <> ''
       GROUP BY m.fig_number
          ON CONFLICT (fig_number) DO UPDATE
         SET fig_name    = COALESCE(minifigs_catalog.fig_name,    EXCLUDED.fig_name),
             image_url   = COALESCE(minifigs_catalog.image_url,   EXCLUDED.image_url),
             image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local)
    $sql$;
  END IF;
END $nachtrag$;

-- ── Schritt 1d: added_at aus created_at nachziehen ──────────────────────────
--
-- Beide Spalten bedeuteten dasselbe. added_at kam spaeter dazu (db/database.ts,
-- ALTER TABLE parts ADD COLUMN added_at) und steht auf allen Zeilen, die es
-- vorher schon gab, auf dem Zeitpunkt DIESES ALTERs — created_at ist dort der
-- genauere Wert. Deshalb der kleinere von beiden.

DO $zeiten$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'created_at')
 AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'added_at') THEN
    EXECUTE $sql$
      UPDATE parts SET added_at = LEAST(COALESCE(added_at, created_at), COALESCE(created_at, added_at))
       WHERE created_at IS NOT NULL
    $sql$;
  END IF;
END $zeiten$;

-- ── Schritt 2: Riegel ───────────────────────────────────────────────────────
--
-- Der Punkt des Riegels: Schritt 3 ist nicht umkehrbar. Wenn ein Teil im
-- Bestand nach dem Loeschen keinen Namen mehr haette, soll die Migration
-- stehenbleiben und sagen, welche — nicht stillschweigend eine Teileliste
-- aus leeren Zellen hinterlassen.

DO $pruefung$
DECLARE
  ohne_namen   INTEGER := 0;
  ohne_farbe   INTEGER := 0;
  ohne_figuren INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'parts' AND column_name = 'part_name') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT DISTINCT p.part_number FROM parts p
         WHERE COALESCE(p.part_name, '') <> ''
           AND NOT EXISTS (SELECT 1 FROM part_catalog pc
                            WHERE pc.part_number = p.part_number
                              AND COALESCE(pc.part_name, '') <> '')) t
    $sql$ INTO ohne_namen;

    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT DISTINCT p.part_number, p.color_id FROM parts p
         WHERE p.color_id IS NOT NULL AND COALESCE(p.color_name, '') <> ''
           AND NOT EXISTS (SELECT 1 FROM part_color_catalog pcc
                            WHERE pcc.part_number = p.part_number
                              AND pcc.color_id = p.color_id
                              AND COALESCE(pcc.color_name, '') <> '')) t
    $sql$ INTO ohne_farbe;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'minifigs' AND column_name = 'fig_name') THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT DISTINCT m.fig_number FROM minifigs m
         WHERE COALESCE(m.fig_name, '') <> ''
           AND NOT EXISTS (SELECT 1 FROM minifigs_catalog mc
                            WHERE mc.fig_number = m.fig_number
                              AND COALESCE(mc.fig_name, '') <> '')) t
    $sql$ INTO ohne_figuren;
  END IF;

  IF ohne_namen > 0 THEN
    RAISE EXCEPTION '% Teilenummern wuerden ihren Namen verlieren — nichts geaendert.', ohne_namen;
  END IF;
  IF ohne_farbe > 0 THEN
    RAISE EXCEPTION '% Teil/Farb-Paare wuerden ihre Farbbezeichnung verlieren — nichts geaendert.', ohne_farbe;
  END IF;
  IF ohne_figuren > 0 THEN
    RAISE EXCEPTION '% Figurennummern wuerden ihren Namen verlieren — nichts geaendert.', ohne_figuren;
  END IF;
END $pruefung$;

-- ── Schritt 3: Spalten loeschen ─────────────────────────────────────────────

ALTER TABLE parts DROP COLUMN IF EXISTS part_name;
ALTER TABLE parts DROP COLUMN IF EXISTS color_name;
ALTER TABLE parts DROP COLUMN IF EXISTS color_hex;
ALTER TABLE parts DROP COLUMN IF EXISTS category_name;
ALTER TABLE parts DROP COLUMN IF EXISTS image_url;
ALTER TABLE parts DROP COLUMN IF EXISTS image_local;
ALTER TABLE parts DROP COLUMN IF EXISTS is_spare;
ALTER TABLE parts DROP COLUMN IF EXISTS created_at;

ALTER TABLE minifigs DROP COLUMN IF EXISTS fig_name;
ALTER TABLE minifigs DROP COLUMN IF EXISTS image_url;
ALTER TABLE minifigs DROP COLUMN IF EXISTS image_local;

-- Der Index auf parts(user_id, color_name) ging mit der Spalte. Der Ersatz
-- liegt auf der Farb-ID — danach wird jetzt gefiltert.
CREATE INDEX IF NOT EXISTS idx_parts_color_id ON parts(user_id, color_id);

-- ── Trigramm-Index fuer die Namenssuche umziehen ────────────────────────────
--
-- db/migrations/0029-trigramm-bestandssuche.sql legt idx_parts_name_trgm auf
-- parts(lower(part_name)). Mit der Spalte ist der Index weg; der Ersatz liegt
-- auf part_catalog, wo der Name jetzt steht — und zwar OHNE user_id, denn der
-- Name haengt nicht am Konto.
--
-- Im DO-Block mit derselben Begruendung wie in 0029: pg_trgm kann fehlen
-- (fehlende Rechte bei gehosteten Postgres-Angeboten). Dann ist die Suche
-- langsamer, aber richtig — und der Start bricht nicht ab.
-- Der Kategorie-Index zieht mit um. Er stand in db/database.ts auf
-- parts(user_id, category_name) — hier, weil initSchema() nur beim
-- allerersten Start laeuft und der Index auf einer laufenden Datenbank sonst
-- nie entstuende.
CREATE INDEX IF NOT EXISTS idx_part_catalog_category ON part_catalog(category_name);

DO $trgm$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_part_catalog_name_trgm
    ON part_catalog USING GIN (lower(part_name) gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_minifigs_catalog_name_trgm
    ON minifigs_catalog USING GIN (lower(fig_name) gin_trgm_ops);
EXCEPTION WHEN undefined_object OR undefined_function OR insufficient_privilege THEN
  RAISE WARNING 'pg_trgm nicht verfuegbar (%) — die Namenssuche laeuft ohne Index (Seq-Scan).', SQLERRM;
END $trgm$;
