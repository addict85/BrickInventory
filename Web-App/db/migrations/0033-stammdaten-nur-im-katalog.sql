-- ═══════════════════════════════════════════════════════════════════════════
-- Name, Jahr, Thema, Teile, Minifiguren und Bilder stehen nur im Katalog
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Marcos Frage ───────────────────────────────────────────────────────────
--
--   „Ich verstehe noch immer nicht, wieso es name, year, theme, pieces,
--    minifigs und quantity in der sets, parts und minifig-Tabelle gibt. Ich
--    kann die Daten gar nicht erfassen, die Erfassung erfolgt immer nur über
--    die Setnummer."
--
--   „Entfernst du die Spalten name, year, theme, pieces, minifigs, quantity,
--    image_url, image_local ebenfalls noch?"
--
-- Er hat recht, und der Grund ist genau der genannte: Es gibt keinen Weg,
-- diese Felder zu ERFASSEN. Jede Erfassung geht über die Setnummer, und was
-- danach in `sets` landete, war eine Abschrift dessen, was Rebrickable und
-- Brickset geliefert haben — abgelegt in `set_catalog` UND gleich daneben noch
-- einmal in `sets`, aus denselben Variablen (utils/setService.ts, addSet).
--
-- `quantity` ist davon ausgenommen und bleibt: Sie ist keine Abschrift,
-- sondern die materialisierte Summe der Erfassungen, und sie wird in jeder
-- Galerie-, Statistik- und Finanzabfrage gelesen. Ihre Doppelpflege ist ein
-- eigener Schritt.
--
-- ── Was die Abschrift gekostet hat ─────────────────────────────────────────
--
-- Sie lief auseinander, und zwar in der Richtung, die am meisten auffällt:
-- `parts` nimmt Katalogdaten mit `ON CONFLICT DO NOTHING` entgegen, Namen
-- werden dort also nie aufgefrischt. Bei den Sets hat es Marco als fehlendes
-- Bild gemeldet (Nachtrag 36): In `sets.image_url` stand nichts, weil der
-- Bild-Download in seine Frist lief oder das Set über CSV oder Barcode kam —
-- und die Antwort lieferte `image_url: null`, obwohl die Adresse im
-- `set_catalog` längst bekannt war. Die Abhilfe war damals ein
-- `COALESCE(s.image_url, sc.image_url)` in EINER Abfrage. Danach gab es drei
-- Wahrheiten: die eigene Spalte, der Katalog, und die Frage, welche Abfrage
-- den Rückfall kennt.
--
-- ── Was hier passiert ──────────────────────────────────────────────────────
--
--  1. NACHTRAGEN: Jede Setnummer aus `sets` bekommt eine Katalogzeile, und
--     leere Katalogfelder werden aus dem Bestand gefüllt. Der Katalog gewinnt,
--     wo er etwas weiss — er ist die Quelle, der Bestand war die Abschrift.
--  2. PRÜFEN: Bleibt eine Setnummer ohne Katalogzeile, oder verliert ein Set
--     dabei seinen Namen, bricht das Skript ab. In einer Transaktion, es wird
--     also nichts gelöscht.
--  3. LÖSCHEN: Die sieben Spalten fallen weg.
--
-- Hier stand als Schritt 3 eine Sicht `sets_mit_katalog`, die die alte Form
-- lieferte, damit die Abfragen im Code unveraendert bleiben konnten. Sie ist
-- wieder weg — Marcos Einwand: „es gibt nur sets aus dem Katalog, somit macht
-- die View aus meiner Sicht wenig Sinn." Er hat recht: Weil die Zuordnung
-- garantiert eins-zu-eins ist, verbarg die Sicht keine Entscheidung, sondern
-- nur Tipparbeit — und dafuer stand im Schema ein 54. Objekt, das in jedem
-- Werkzeug wie eine Tabelle aussieht. Jede Abfrage schreibt ihren JOIN jetzt
-- selbst aus und sagt damit, woher Name, Jahr und Bild kommen.
--
-- ── Was es NICHT anfasst ───────────────────────────────────────────────────
--
-- `parts` und `minifigs` behalten ihre Abschriften vorerst (`part_name`,
-- `color_name`, `color_hex`, `category_name`, `fig_name`, Bilder). Dort gibt es
-- einen Fall, den es bei Sets nicht gibt: MANUELL erfasste Stücke
-- (`source='manual'`) ohne Katalogzeile. Das ist eine eigene Frage und gehört
-- in einen eigenen Schritt.
--
-- ── Warum db/schema.sql die Spalten weiter anlegt ──────────────────────────
--
-- Dieselbe Lage wie bei Migration 0032, nur mit einer anderen Vormigration:
-- 0014 schreibt `UPDATE sets SET image_url = …` (Bild-Proxy-Adressen
-- umschreiben). Auf einer frischen Datenbank laufen alle Migrationen der
-- Reihe nach; fehlte die Spalte, bräche der erste Start ab. Die Begründung
-- steht ausführlich in db/schema.sql an der sets-Tabelle.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Schritt 1: Katalog aus dem Bestand nachtragen ──────────────────────────
--
-- MAX() und nicht die Zeile eines bestimmten Kontos: Im Haushalt halten
-- mehrere Konten dieselbe Setnummer, und die Abschriften sind dort gleich.
-- MAX() übergeht dabei NULL-Werte — hat eines der Konten einen Namen und das
-- andere nicht, gewinnt der Name. Ein `DISTINCT ON (set_number) … ORDER BY id`
-- täte das NICHT: Es nähme die älteste Zeile mitsamt ihrer Lücken.
--
-- COALESCE in der richtigen Richtung: Der KATALOG gewinnt, wo er etwas weiss.
-- Er ist die Quelle (Rebrickable/Brickset), der Bestand war die Abschrift.
-- Nur Lücken werden von dort gefüllt.
INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs, image_url, image_local)
SELECT s.set_number,
       MAX(s.name), MAX(s.year), MAX(s.theme), MAX(s.pieces), MAX(s.minifigs),
       MAX(s.image_url), MAX(s.image_local)
  FROM sets s
 GROUP BY s.set_number
ON CONFLICT (set_number) DO UPDATE SET
  name        = COALESCE(set_catalog.name,        EXCLUDED.name),
  year        = COALESCE(set_catalog.year,        EXCLUDED.year),
  theme       = COALESCE(set_catalog.theme,       EXCLUDED.theme),
  pieces      = COALESCE(set_catalog.pieces,      EXCLUDED.pieces),
  minifigs    = COALESCE(set_catalog.minifigs,    EXCLUDED.minifigs),
  image_url   = COALESCE(set_catalog.image_url,   EXCLUDED.image_url),
  image_local = COALESCE(set_catalog.image_local, EXCLUDED.image_local);

-- ── Schritt 2: Die Bedingung, unter der gelöscht werden darf ───────────────
--
-- Zwei Prüfungen, und die zweite ist die wichtigere: „Es gibt eine
-- Katalogzeile" heisst noch nicht, dass der Name darin steht. Ohne sie könnte
-- ein Set stumm namenlos werden, und das wäre in der Galerie sofort zu sehen —
-- aber nicht mehr zu reparieren.
DO $$
DECLARE ohne_zeile INTEGER; ohne_namen INTEGER;
BEGIN
  SELECT COUNT(DISTINCT s.set_number) INTO ohne_zeile
    FROM sets s
   WHERE NOT EXISTS (SELECT 1 FROM set_catalog c WHERE c.set_number = s.set_number);
  IF ohne_zeile > 0 THEN
    RAISE EXCEPTION '% Setnummern haben keine Katalogzeile — nichts geaendert.', ohne_zeile;
  END IF;

  SELECT COUNT(*) INTO ohne_namen
    FROM sets s JOIN set_catalog c ON c.set_number = s.set_number
   WHERE s.name IS NOT NULL AND c.name IS NULL;
  IF ohne_namen > 0 THEN
    RAISE EXCEPTION '% Sets wuerden ihren Namen verlieren — nichts geaendert.', ohne_namen;
  END IF;
END $$;

-- ── Schritt 3: Der Schnitt ─────────────────────────────────────────────────
--
-- Ein Index auf einer der sieben Spalten gibt es nicht; db/migrations/0029 hat die Trigramm-Indizes für
-- `sets` ausdrücklich nicht angelegt („NICHT angelegt: sets (472 Zeilen)").
-- Falls eine Datenbank die Sicht aus einem Zwischenstand noch traegt: weg
-- damit, sonst haengen die Spalten unten an ihr und das DROP scheitert.
DROP VIEW IF EXISTS sets_mit_katalog;

ALTER TABLE sets DROP COLUMN IF EXISTS name;
ALTER TABLE sets DROP COLUMN IF EXISTS year;
ALTER TABLE sets DROP COLUMN IF EXISTS theme;
ALTER TABLE sets DROP COLUMN IF EXISTS pieces;
ALTER TABLE sets DROP COLUMN IF EXISTS minifigs;
ALTER TABLE sets DROP COLUMN IF EXISTS image_url;
ALTER TABLE sets DROP COLUMN IF EXISTS image_local;
