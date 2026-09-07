/**
 * Schema-Änderungen gehören in db/migrations/ — nicht in initSchema().
 *
 * ── Was im Betrieb passiert ist ─────────────────────────────────────────────
 *
 * Marcos Serverprotokoll:
 *
 *     [login]  Token konnte nicht gespeichert werden:
 *              column "sliding" of relation "api_tokens" does not exist
 *     [auth:me] column t.sliding does not exist
 *     [route-error] 500: at async createToken (dist/utils/auth.js:267)
 *
 * Die ANMELDUNG war kaputt — auch der QR-Login, denn er geht durch dieselbe
 * Funktion. Die Spalte war als `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in
 * db/database.ts eingetragen, in initSchema(), mit `.catch(warn)` daneben.
 *
 * Beides ist falsch, und beides steht als Warnung schon im Baum:
 *
 *  1. initSchema() läuft NUR bei einer Versionsänderung (siehe
 *     initSchemaOnce): Steht in schema_meta bereits die Fassung dieses
 *     Deployments, wird der Block übersprungen.
 *  2. Der `.catch(warn)` macht einen einmaligen Fehlschlag DAUERHAFT: Die
 *     Version wird anschliessend trotzdem als angewandt vermerkt.
 *
 * initSchemaOnce() sagt es unmissverständlich: nummerierte Migrationen
 * „laufen IMMER, auch wenn initSchema() übersprungen wurde … und sind die
 * Stelle, an der ab jetzt jede Schemaänderung landet".
 *
 * ── Warum eine Bestandsliste und kein Verbot ────────────────────────────────
 *
 * NACHGEMESSEN: In db/database.ts stehen 17 weitere `ALTER TABLE … ADD
 * COLUMN`. Sie sind ALT — spaltenMigrationen() stammt aus der Zeit vor dem
 * Migrations-Ordner und prüft jede Spalte einzeln über information_schema.
 * Sie alle heute umzuziehen wäre ein grosser Eingriff am Startpfad, ohne dass
 * jemand ein Problem damit hat.
 *
 * Die Zahl darf deshalb nur SINKEN. Das ist dieselbe Bauart wie
 * scripts/check-global-settings.js — sie verbietet nichts Bestehendes und
 * fängt trotzdem die nächste neue Stelle.
 *
 * Ausführen: REQUIRE_DB=1 npm test (braucht keine DB, läuft im normalen Lauf mit)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');

/** Gemessen am Tag der Behebung. Die Zahl darf nur kleiner werden. */
const BESTAND_ALTER = 17;

test('keine neue Spalten-Änderung in db/database.ts', () => {
  const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db/database.ts'), 'utf8'));
  const treffer = quelle.match(/ALTER TABLE \w+ ADD COLUMN/g) || [];

  assert.ok(treffer.length <= BESTAND_ALTER,
    `db/database.ts hat ${treffer.length} "ALTER TABLE … ADD COLUMN", erlaubt sind höchstens `
    + `${BESTAND_ALTER}. Eine NEUE Spalte gehört nach db/migrations/ — initSchema() läuft nur `
    + `bei einer Versionsänderung, und ein stiller Fehlschlag dort ist dauerhaft. Genau so ist `
    + `api_tokens.sliding im Betrieb ausgeblieben und hat die Anmeldung zerlegt.`);

  // GEGENPROBE: Das Suchmuster muss überhaupt etwas finden. Ohne diese Zeile
  // wäre der Test grün, sobald jemand die Datei umbenennt oder das Muster
  // nicht mehr passt — und ausgerechnet dann prüft er nichts mehr.
  assert.ok(treffer.length > 0,
    'Das Suchmuster findet keine einzige Spalten-Änderung. Bei 17 bekannten Stellen heisst das: '
    + 'Das Muster passt nicht mehr, und die Prüfung wäre stillschweigend grün.');
});

test('api_tokens.sliding steht in einer Migration', () => {
  const verzeichnis = path.join(ROOT, 'db/migrations');
  const dateien = fs.readdirSync(verzeichnis).filter(f => f.endsWith('.sql'));
  const mitSliding = dateien.filter(f =>
    /ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding/i.test(
      fs.readFileSync(path.join(verzeichnis, f), 'utf8')));

  assert.equal(mitSliding.length, 1,
    `Die Spalte api_tokens.sliding wird in ${mitSliding.length} Migrationen angelegt — erwartet `
    + `genau eine. Ohne sie scheitert createToken() auf jeder gewachsenen Datenbank, und damit `
    + `Login und QR-Login. Gefunden: ${mitSliding.join(', ') || '(keine)'}`);

  // Und die Spalte muss auch im Grundschema stehen, sonst fehlt sie bei einer
  // NEUEN Installation, deren Migrationen alle als angewandt gelten könnten.
  const schema = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
  assert.match(schema, /sliding\s+BOOLEAN/,
    'db/schema.sql kennt die Spalte sliding nicht — dann fehlt sie auf einer frischen Installation.');
});
