-- ── Grundlage ────────────────────────────────────────────────────────────────
--
-- Diese Datei ist absichtlich LEER an Änderungen. Sie markiert den Stand, den
-- initSchema() in db/database.ts herstellt, als Ausgangspunkt für alles, was
-- danach kommt.
--
-- Warum nicht die 700 Zeilen aus initSchema() hierher kopieren? Weil jede
-- bestehende Installation sie längst angewandt hat — nur weiss das niemand
-- eintragsweise. Ein Nachziehen hiesse raten, und Raten auf einem Schema mit
-- echten Daten ist die teuerste Sorte Fehler. initSchema() bleibt deshalb die
-- Grundlage; ab 0002 wird sauber nummeriert.
--
-- Konkret heisst das für neue Änderungen: NICHT mehr in initSchema() eintragen,
-- sondern eine neue Datei db/migrations/0002-….sql anlegen. Siehe db/migrate.ts.

SELECT 1;
