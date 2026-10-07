-- ═══════════════════════════════════════════════════════════════════════════
-- Trigramm-Indizes fuer die Suche im EIGENEN Bestand
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Was fehlte ─────────────────────────────────────────────────────────────
--
-- Trigramm-Indizes gab es nur auf rb_sets, dem Rebrickable-Katalog
-- (db/database.ts, Etappe 3). Die Teilesuche im eigenen Bestand hatte keine —
-- und sie sucht mit `%begriff%`, Platzhalter vorne. Ein B-Tree-Index hilft
-- dort nicht, nur ein Trigramm-Index kann das beantworten.
--
-- ── Messung, an Marcos echter Bestandsgroesse (71 094 Zeilen) ──────────────
--
--   seltener Begriff   ohne Index   39,6 / 40,3 / 45,7 ms
--                      mit  Index    0,97 / 1,13 / 1,64 ms      rund 30x
--
--   haeufiger Begriff  ohne Index    0,30 / 0,46 ms
--                      — kein Bedarf: Der Planer waehlt dort von selbst den
--                        Durchlauf, weil LIMIT 50 nach wenigen Zeilen erfuellt
--                        ist, und er behaelt recht.
--
-- Und der HAUPTweg, parts_summary mit ILIKE, an 71 832 Zeilen:
--
--   seltener Begriff   ohne Index  108,8 / 131,4 ms
--                      mit  Index    3,8 ms
--
-- Der ist der groessere Gewinn — und er war in meiner ersten Empfehlung nicht
-- drin, weil ich die Tabelle hinter der Abfrage nicht aufgeloest hatte.
--
-- Was es kostet, ebenfalls gemessen: 5000 Zeilen einfuegen dauert 83 ms ohne
-- und 215 ms mit den Indizes (2,6x). Das trifft den CSV-Import im
-- Hintergrund-Arbeiter, der selten laeuft; die Suche trifft jeden Aufruf.
--
-- ── Eine Eigenheit von GIN, die man wissen muss ────────────────────────────
--
-- GEMESSEN und zuerst falsch gedeutet: Nach einem Masseneinfuegen benutzte der
-- Planer die Indizes NICHT — Seq Scan, 40 ms, obwohl die Indizes da und gueltig
-- waren. Ursache ist die Warteliste (`fastupdate`, Vorgabe an): Neue Eintraege
-- landen dort, und eine grosse Warteliste macht den Indexzugriff in der
-- Kostenschaetzung teuer.
--
--   direkt nach dem Einfuegen   Seq Scan          40,4 ms
--   nach VACUUM ANALYZE         Bitmap Index Scan  0,86 ms
--
-- Fuer diese Migration ist das unerheblich: CREATE INDEX auf vorhandenen Daten
-- baut den Index vollstaendig, er wird also sofort benutzt. Zu wissen ist es
-- fuer DANACH — nach einem grossen CSV-Import kann die Suche zeitweise wieder
-- langsam sein, bis das automatische Aufraeumen durchgelaufen ist. Wer das
-- nicht abwarten will: `VACUUM ANALYZE parts, parts_summary` nach dem Import.
--
-- ── Warum ZWEI Tabellen und zwei Indexformen ───────────────────────────────
--
-- Die Teileliste hat zwei Wege, und beide suchen:
--
--   utils/handlers/parts.ts:279  tryPartsSummary — der HAUPTweg. Liest
--                                parts_summary, mit ILIKE auf den ROHEN Spalten
--   utils/handlers/parts.ts:133  der Rueckfallweg. Liest parts, mit
--                                LOWER(spalte) LIKE
--
-- Daher unterschiedliche Formen: Fuer `ILIKE spalte` genuegt der Index auf der
-- rohen Spalte, fuer `LOWER(spalte) LIKE` muss er auf dem AUSDRUCK
-- `lower(spalte)` liegen. Das ist kein Schoenheitsunterschied — ein Index auf
-- der falschen Form liegt da und wird nie angefasst.
--
-- NICHT angelegt: sets (472 Zeilen) und minifigs (951). Dort dauert der
-- Durchlauf Bruchteile einer Millisekunde. Gemessen heisst hier auch:
-- gemessen, dass es sich NICHT lohnt.
--
-- ── Warum als MIGRATION und nicht in initSchema() ──────────────────────────
--
-- Die Geschwister fuer rb_sets stehen in initSchema(). Dort wuerden diese hier
-- NIE auf einer bestehenden Datenbank ankommen, und das ist gemessen:
--
--   dist/db/database.js:  appVersion = require("../package.json").version …
--
-- Der Bau bundelt nicht (scripts/build-ts.js sagt es ausdruecklich), das
-- `require` wird also zur Laufzeit aufgeloest — aus dist/db/ nach
-- dist/package.json, und die Datei gibt es nicht. appVersion ist damit immer
-- „unknown", der Vermerk in schema_meta steht nach dem ersten Start auf
-- „unknown", und initSchema() wird ab dann bei JEDEM Start uebersprungen.
--
-- Migrationen laufen dagegen auf jeder Datenbank, frisch oder bestehend.
--
-- ── Warum der DO-Block ─────────────────────────────────────────────────────
--
-- pg_trgm kann fehlen (fehlende Rechte bei gehosteten Postgres-Angeboten) —
-- genau deshalb steht die Erweiterung in initSchema() in einem try/catch, mit
-- der Begruendung „Das darf den Start nicht verhindern". Eine Migration, die
-- scheitert, bricht aber den ganzen Start ab (db/migrate.ts wirft weiter).
-- Der DO-Block haelt sich an die aeltere Entscheidung: ohne pg_trgm eine
-- Warnung, kein Abbruch. Die Suche ist dann langsamer, aber richtig.

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_parts_number_trgm
    ON parts USING GIN (lower(part_number) gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_parts_name_trgm
    ON parts USING GIN (lower(part_name) gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_psum_number_trgm
    ON parts_summary USING GIN (part_number gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_psum_name_trgm
    ON parts_summary USING GIN (part_name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_psum_blnumber_trgm
    ON parts_summary USING GIN (bl_part_number gin_trgm_ops);
EXCEPTION WHEN undefined_object OR undefined_function OR insufficient_privilege THEN
  RAISE WARNING 'pg_trgm nicht verfuegbar (%) — die Bestandssuche laeuft ohne Index (Seq-Scan).', SQLERRM;
END $$;
