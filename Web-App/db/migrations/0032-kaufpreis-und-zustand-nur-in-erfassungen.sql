-- ═══════════════════════════════════════════════════════════════════════════
-- Kaufpreis und Zustand stehen nur noch in den Erfassungen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Marcos Frage ───────────────────────────────────────────────────────────
--
--   „Kaufpreise und Zustand können doch mehrere pro Set erfasst werden, müsste
--    das nicht in einer eigenen Tabelle sein?"
--
-- Sie IST in einer eigenen Tabelle, seit Langem: `set_acquisitions`, eine
-- Zeile je Kauf, mit Menge, Preis, Zustand und Datum. `sets.purchase_price`
-- und `sets.condition` sind älter als diese Tabelle und wurden beim Umbau
-- nicht entfernt, sondern zum SPIEGEL der jeweils neuesten Erfassung erklärt
-- (so steht es wörtlich in db/schema.sql).
--
-- ── Was der Spiegel gekostet hat ───────────────────────────────────────────
--
-- Drei gemeldete Fehler, alle dieselbe Ursache — zwei Wahrheiten, die der Code
-- von Hand gleichhalten muss:
--
--   Nachtrag 51  `parentPriceSql` zog den Preis nicht nach.
--   Nachtrag 75  „Kaufpreis entfernt, die Kachel zeigt ihn weiter": Beim
--                Löschen der neuesten Erfassung blieb deren Preis in der
--                Elternzeile stehen — sichtbar in Kachel, Galerie und
--                Finanzübersicht (gemeldet mit 9.48 statt 7.41).
--   später       Der Android-Weg hatte `resolvePrice: null`; der leere Wert
--                wurde gespiegelt, danach stand „in der ganzen App ein Strich".
--
-- Die Leseseite hat sich längst gelöst: Galerie, Bewertung und Gewinnrechnung
-- rechnen aus den Erfassungen und nahmen die Spalte nur noch als `COALESCE`-
-- Rückfall „für Altbestände ohne Erfassungen". Genau diesen Rückfall macht
-- dieses Skript überflüssig.
--
-- ── Was hier passiert ──────────────────────────────────────────────────────
--
--  1. NACHTRAGEN: Jede Set-Zeile ohne Erfassung bekommt eine, aus ihren
--     eigenen Werten (Menge, Kaufpreis, Zustand, Aufnahmedatum). Das sind die
--     Altbestände, für die der Rückfall gebaut war.
--  2. PRÜFEN: Bleibt danach eine Zeile ohne Erfassung, bricht das Skript ab —
--     in einer Transaktion, es wird also nichts gelöscht.
--  3. LÖSCHEN: `sets.purchase_price` und `sets.condition` fallen weg.
--
-- ── Was es NICHT anfasst ───────────────────────────────────────────────────
--
-- `parts` und `minifigs` behalten ihre Spalten vorerst. Dort gilt der Spiegel
-- nur für MANUELL erfasste Zeilen (`source='manual'`); Teile aus einem Set
-- bekommen Preis und Zustand beim Import und haben gar keine Erfassungen. Das
-- ist eine eigene Frage und gehört in einen eigenen Schritt.
--
-- `sets.quantity` bleibt ebenfalls: Sie ist eine materialisierte Summe, die in
-- jeder Galerie-, Statistik- und Finanzabfrage gelesen wird. Sie zu entfernen
-- ist eine Frage der Rechenzeit, nicht der Richtigkeit — und sie hat einen
-- eigenen Schritt verdient.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Schritt 1: Altbestände nachtragen ──────────────────────────────────────
--
-- `created_at` bekommt das Aufnahmedatum des Sets und nicht NOW(): Die
-- Erfassungen sind die Kaufhistorie, und ein Kauf von 2019 gehört nicht auf
-- heute. Die Tagesregel (eine Zeile je Tag und Eintrag, Migration 0004) bleibt
-- dabei gewahrt — es gibt ja noch gar keine Zeile für dieses Set.
--
-- Die Menge wird übernommen WIE SIE IST, auch eine 0. Eine Zeile mit Menge 0
-- ist ein gültiger Zustand (Mengenregler), und sie hier auf 1 zu heben hiesse,
-- Bestand zu erfinden.
--
-- ── Warum der Nachtrag in einem DO-Block mit EXECUTE steckt ────────────────
--
-- Auf einer frischen Datenbank legt db/schema.sql die beiden Spalten weiterhin
-- an — sie MUSS das, weil Migration 0007 ein `ALTER COLUMN purchase_price
-- TYPE NUMERIC` enthält und ein ALTER COLUMN auf eine fehlende Spalte hart
-- abbricht (GEMESSEN: „Migration 0007-geld-als-numeric.sql fehlgeschlagen:
-- column "purchase_price" does not exist"). Die ausführliche Begründung steht
-- in db/schema.sql an der sets-Tabelle.
--
-- Dieses Skript hier läuft also immer mit vorhandenen Spalten. Der DO-Block
-- steht trotzdem, und zwar gegen EINEN bestimmten Fall: Stünde das
-- INSERT offen da, prüfte Postgres es schon beim Einlesen der Datei gegen das
-- Schema — eine Datenbank, auf der die Spalten aus irgendeinem Grund schon
-- fehlen, käme nicht einmal bis zum DROP darunter, und der Start wäre kaputt,
-- obwohl nichts zu tun ist. EXECUTE umgeht die Prüfung beim Einlesen; geparst
-- wird erst, wenn der Katalog die Spalte wirklich nennt.
DO $nachtrag$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sets' AND column_name = 'purchase_price') THEN
    EXECUTE $sql$
      INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
      SELECT s.user_id, s.set_number, COALESCE(s.quantity, 0), s.purchase_price,
             COALESCE(s.condition, 'N'), COALESCE(s.added_at, NOW())
        FROM sets s
       WHERE NOT EXISTS (SELECT 1 FROM set_acquisitions a
                          WHERE a.user_id = s.user_id AND a.set_number = s.set_number)
    $sql$;
  END IF;
END $nachtrag$;

-- ── Schritt 2: Die Bedingung, unter der gelöscht werden darf ───────────────
--
-- Ohne diese Prüfung wäre das Löschen ein Datenverlust mit Ansage: Eine
-- Set-Zeile ohne Erfassung hätte danach weder Kaufpreis noch Zustand, und
-- beides liesse sich aus nichts mehr herleiten.
DO $$
DECLARE offen INTEGER;
BEGIN
  SELECT COUNT(*) INTO offen
    FROM sets s
   WHERE NOT EXISTS (SELECT 1 FROM set_acquisitions a
                      WHERE a.user_id = s.user_id AND a.set_number = s.set_number);
  IF offen > 0 THEN
    RAISE EXCEPTION '% Set-Zeilen haben keine Erfassung — nichts geaendert.', offen;
  END IF;
END $$;

-- ── Schritt 3: Der Schnitt ─────────────────────────────────────────────────
--
-- Danach gibt es die zwei Spalten auf keiner laufenden Datenbank mehr. Dass
-- db/schema.sql und spaltenMigrationen() sie weiterhin anlegen, ändert daran
-- nichts: Beides läuft NUR beim allerersten Start einer Datenbank (siehe
-- initSchemaOnce in db/database.ts), und zwar VOR dieser Datei. Ein zweites
-- Mal kommt dort niemand vorbei.
--
-- `IF EXISTS`, damit die Datei auch auf einer Datenbank durchläuft, auf der
-- die Spalten schon fehlen — dasselbe Motiv wie beim DO-Block oben.
ALTER TABLE sets DROP COLUMN IF EXISTS purchase_price;
ALTER TABLE sets DROP COLUMN IF EXISTS condition;
