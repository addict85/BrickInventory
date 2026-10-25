# Begründungen zu `db/migrate.ts`

Die ausführlichen Kommentare aus `db/migrate.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Schema-Migrationen mit nummerierten Dateien.

── Was vorher fehlte ───────────────────────────────────────────────────────
initSchema() in db/database.ts ist ein rund 700 Zeilen langes Geflecht aus
`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS` und
Datenkorrekturen, das bei JEDEM Start vollständig durchläuft. Das
funktioniert, solange jede Anweisung für sich idempotent und von keiner
anderen abhängig ist — und genau da endet es:

  • Es gibt keine Reihenfolge. Ein ALTER, das eine Spalte aus einem anderen
    ALTER braucht, funktioniert auf einer frischen Datenbank und scheitert
    auf einer alten (oder umgekehrt), je nachdem, wo man ihn einfügt.
  • Es gibt keinen Weg zurück. Eine fehlerhafte Änderung lässt sich nicht
    rückgängig machen, weil niemand weiss, was sie war.
  • Es gibt keine Schemaversion. `schema_meta` merkt sich die APP-Version des
    letzten Laufs — das beantwortet "lief initSchema schon?", nicht "welche
    Änderungen sind angewandt?".

── Wie es jetzt läuft ──────────────────────────────────────────────────────
Das Bestehende wird NICHT auseinandergerissen. initSchema() bleibt die
Grundlage (die "Baseline"): Sie stellt den Stand her, den jede Installation
heute hat. Alles DANACH kommt in nummerierte Dateien unter db/migrations/,
die genau einmal laufen und in schema_migrations vermerkt werden.

Der Grund für diesen Zuschnitt: Die 700 Zeilen nachträglich in dreissig
Migrationen zu zerlegen hiesse, für jede bestehende Installation zu raten,
welche davon dort schon gelaufen sind. Das ist genau die Sorte Umbau, die
eine funktionierende Datenbank kaputtmacht. Ab hier vorwärts sauber zu sein
kostet nichts und löst das Problem für alles Künftige.

── Eine Migration schreiben ────────────────────────────────────────────────
Datei anlegen: db/migrations/0002-beschreibender-name.sql

  -- Kommentar: warum diese Änderung nötig ist
  ALTER TABLE sets ADD COLUMN notes TEXT;

Regeln:
  • Die Nummer bestimmt die Reihenfolge. Nie eine vergebene Nummer erneut
    benutzen und nie eine bereits ausgelieferte Datei nachträglich ändern —
    sie ist auf fremden Installationen schon gelaufen.
  • Jede Datei läuft in EINER Transaktion. Schlägt eine Anweisung fehl,
    wird die ganze Datei zurückgerollt und der Start bricht ab. Das ist
    Absicht: Ein halb migriertes Schema ist schlimmer als ein Server, der
    nicht hochkommt.
  • `IF NOT EXISTS` ist hier NICHT nötig — jede Datei läuft genau einmal.
    Wer es trotzdem schreibt, verschleiert nur, dass etwas doppelt lief.
```

<a id="runmigrations"></a>
## `runMigrations`

```text
Alle noch nicht angewandten Migrationen ausführen.

Läuft innerhalb des Advisory-Locks von initSchemaOnce() — im Cluster ist
also immer nur ein Worker hier drin.

@param {any} client Eine DEDIZIERTE pg-Verbindung (nicht der Pool), damit
                    Lock und Migration auf derselben Session liegen.
@returns {Promise<string[]>} Namen der neu angewandten Migrationen
```
