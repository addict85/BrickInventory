# Begründungen zu `test/schema-migrationen-db.test.js`

Die ausführlichen Kommentare aus `test/schema-migrationen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Schema-Änderungen gehören in db/migrations/ — nicht in initSchema().

── Was im Betrieb passiert ist ─────────────────────────────────────────────

Marcos Serverprotokoll:

    [login]  Token konnte nicht gespeichert werden:
             column "sliding" of relation "api_tokens" does not exist
    [auth:me] column t.sliding does not exist
    [route-error] 500: at async createToken (dist/src/konto/auth.js:267)

Die ANMELDUNG war kaputt — auch der QR-Login, denn er geht durch dieselbe
Funktion. Die Spalte war als `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in
db/database.ts eingetragen, in initSchema(), mit `.catch(warn)` daneben.

Beides ist falsch, und beides steht als Warnung schon im Baum:

 1. initSchema() läuft NUR bei einer Versionsänderung (siehe
    initSchemaOnce): Steht in schema_meta bereits die Fassung dieses
    Deployments, wird der Block übersprungen.
 2. Der `.catch(warn)` macht einen einmaligen Fehlschlag DAUERHAFT: Die
    Version wird anschliessend trotzdem als angewandt vermerkt.

initSchemaOnce() sagt es unmissverständlich: nummerierte Migrationen
„laufen IMMER, auch wenn initSchema() übersprungen wurde … und sind die
Stelle, an der ab jetzt jede Schemaänderung landet".

── Warum eine Bestandsliste und kein Verbot ────────────────────────────────

NACHGEMESSEN: In db/database.ts stehen 17 weitere `ALTER TABLE … ADD
COLUMN`. Sie sind ALT — spaltenMigrationen() stammt aus der Zeit vor dem
Migrations-Ordner und prüft jede Spalte einzeln über information_schema.
Sie alle heute umzuziehen wäre ein grosser Eingriff am Startpfad, ohne dass
jemand ein Problem damit hat.

Die Zahl darf deshalb nur SINKEN. Das ist dieselbe Bauart wie
scripts/check-global-settings.js — sie verbietet nichts Bestehendes und
fängt trotzdem die nächste neue Stelle.

Ausführen: REQUIRE_DB=1 npm test (braucht keine DB, läuft im normalen Lauf mit)
```
