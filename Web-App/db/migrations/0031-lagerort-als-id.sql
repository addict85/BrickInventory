-- ═══════════════════════════════════════════════════════════════════════════
-- Der Lagerort am Bestand ist eine ID, nicht mehr ein Name
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Marcos Frage, und was sie aufgedeckt hat ───────────────────────────────
--
--   „Wäre es nicht schöner wenn auf den Sets eine id für storage abgelegt
--    wäre?"
--
-- Ja — und zwar nicht aus Geschmack. Mit dem NAMEN als Zuordnung gab es eine
-- Lücke, die nachgestellt wurde (nicht vermutet):
--
--   Vorrat enthält  : ['Estrich']
--   am Set getippt  : "estrich"            ← kleines e, das Textfeld lässt es zu
--   nach Umbenennen → Set: "estrich"  | Vorrat: ['Dachboden']
--   Löschen         : GELUNGEN
--   Set trägt jetzt : "estrich"
--   Auswahlliste    : []
--
-- Drei Symptome, eine Ursache: Die Zuordnung wurde ZEICHENGENAU verglichen
-- (`storage = $2`), die Eindeutigkeit im Vorrat aber ohne Rücksicht auf
-- Gross-/Kleinschreibung (`lower(name)`, Migration 0020). Also konnte am Set
-- eine Schreibweise stehen, die der Vorrat nicht führt — dann wanderte sie beim
-- Umbenennen nicht mit, und die Belegt-Prüfung beim Löschen zählte null,
-- obwohl ein Set darin lag. Am Ende stand genau das, wovor 0020 selbst warnt:
-- ein Wert, den die Oberfläche nicht zur Wahl stellt.
--
-- Mit einer ID ist das keine Regel, die man einhalten muss, sondern eine Form,
-- die den Fehler nicht zulässt. Dazu entfällt in [benenneOrtUm] die Schleife,
-- die den neuen Namen in drei Tabellen nachschreibt — es gibt nichts
-- nachzuschreiben.
--
-- ── Warum die bestehenden Zuordnungen WEGGEWORFEN werden ───────────────────
--
-- Marcos Ansage: „Du kannst die bereits erfassten storages löschen damit es
-- keine Migration benötigt." Also kein Nachfüllen aus dem Namen, sondern ein
-- klarer Schnitt: Die Spalte `storage` fällt weg, `storage_id` fängt leer an.
--
-- Das ist die EINE Stelle, an der dieses Skript Daten verliert, und es tut es
-- ausdrücklich auf Ansage. Wer sie behalten will, muss vor dem Lauf
-- nachfüllen; der Weg dafür steht unten im abgeschalteten Block.
--
-- ── Was NICHT umgestellt wird: parts_summary.storage ───────────────────────
--
-- Die Spalte dort ist KEINE Zuordnung, sondern ein berechnetes Etikett: Ein
-- Teil steckt in mehreren Sets, die in verschiedenen Kisten liegen können —
-- deshalb steht dort ein STRING_AGG („Kiste 3, Regal A"), siehe
-- utils/partsSummary.ts. Ein einzelner Verweis könnte das gar nicht
-- ausdrücken. Sie bleibt TEXT und wird beim Bauen aus den Namen der
-- verknüpften Orte zusammengesetzt.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Die neue Spalte, je Tabelle ────────────────────────────────────────────
--
-- ON DELETE SET NULL und nicht RESTRICT: Die freundliche Absage beim Löschen
-- eines belegten Ortes macht weiter die Anwendung (loescheOrt in
-- utils/lagerort.ts, mit der Meldung `lagerort_in_benutzung`). Diese Regel hier
-- ist der Riegel darunter, für den Fall, dass jemand mit SQL am Vorrat
-- aufräumt: Dann hat der Bestand hinterher KEINEN Ort — und nicht einen
-- Verweis auf eine Zeile, die es nicht mehr gibt. Genau dieser verwaiste
-- Verweis war der Fehler, der mit dem Namen möglich war.
-- Die SPALTEN stehen auch in db/schema.sql (die laeuft bei jedem Start und ist
-- der Ausgangszustand einer neuen Datenbank), die INDIZES ausschliesslich
-- dort. Dieselbe Aufteilung wie in 0018: Ein ADD COLUMN IF NOT EXISTS
-- beschreibt eine Zielform und darf zweimal dastehen, ein CREATE INDEX
-- beschreibt eine Entscheidung und hat genau einen Ort
-- (test/schema-am-start.test.js meldet das Gegenteil, und hat den ersten
-- Entwurf dieser Datei prompt abgelehnt — wie damals den von 0018).
ALTER TABLE sets     ADD COLUMN IF NOT EXISTS storage_id INTEGER;
ALTER TABLE parts    ADD COLUMN IF NOT EXISTS storage_id INTEGER;
ALTER TABLE minifigs ADD COLUMN IF NOT EXISTS storage_id INTEGER;

-- ── Die Fremdschluessel-Regel ──────────────────────────────────────────────
--
-- Sie steht HIER und nicht in schema.sql, weil der Vorrat dort noch nicht
-- existiert: storage_locations legt Migration 0020 an, und schema.sql laeuft
-- bei einer neuen Datenbank davor. In einem DO-Block, damit die Datei auch
-- dann durchlaeuft, wenn sie ein zweites Mal angesehen wird — ADD CONSTRAINT
-- kennt kein IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sets_storage_id_fkey') THEN
    ALTER TABLE sets ADD CONSTRAINT sets_storage_id_fkey
      FOREIGN KEY (storage_id) REFERENCES storage_locations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parts_storage_id_fkey') THEN
    ALTER TABLE parts ADD CONSTRAINT parts_storage_id_fkey
      FOREIGN KEY (storage_id) REFERENCES storage_locations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'minifigs_storage_id_fkey') THEN
    ALTER TABLE minifigs ADD CONSTRAINT minifigs_storage_id_fkey
      FOREIGN KEY (storage_id) REFERENCES storage_locations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Wer die Zuordnungen BEHALTEN will ──────────────────────────────────────
--
-- Dann diese drei Anweisungen vor dem DROP einschalten. Sie treffen die
-- Zeilen, deren Name im Vorrat des eigenen Kontos steht — ohne Rücksicht auf
-- Gross-/Kleinschreibung, denn genau daran scheiterte der alte Weg. Was auch
-- dann nicht zugeordnet werden kann, hatte schon vorher keinen Ort in der
-- Auswahlliste.
--
--   UPDATE sets s SET storage_id = l.id
--     FROM storage_locations l
--    WHERE l.user_id = s.user_id AND lower(l.name) = lower(btrim(s.storage))
--      AND s.storage IS NOT NULL;
--   (dasselbe für parts und minifigs)

-- ── Der Schnitt ────────────────────────────────────────────────────────────
--
-- Die Teilindizes auf der alten Spalte fallen mit ihr weg (Postgres löscht
-- Indizes einer gelöschten Spalte mit). Sie hier einzeln zu löschen wäre eine
-- zweite Stelle, die stimmen muss.
ALTER TABLE sets     DROP COLUMN IF EXISTS storage;
ALTER TABLE parts    DROP COLUMN IF EXISTS storage;
ALTER TABLE minifigs DROP COLUMN IF EXISTS storage;
