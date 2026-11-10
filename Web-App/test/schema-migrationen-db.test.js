/**
 * Schema-Änderungen gehören in db/migrations/ — nicht in initSchema().
 * Ausführlich: docs/begruendungen/test/schema-migrationen-db.test.js.md#kopf
 *
 * Gegenprobe (10.11.2026 gemessen): in 0015-api-tokens-sliding.sql die Spalte
 * `slidingx` genannt → rot: „api_tokens.sliding gibt es …“ (die Migration legt
 * sie nicht an). Den Teil „frisch“ prüft die Vorlage-Datenbank des Testlaufs
 * (aus db/basis.sql); diese Gegenprobe ist nicht gemessen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
test.after(() => _req('db/database.js').pool.end().catch(() => {}));

/** Gemessen am Tag der Behebung. Die Zahl darf nur kleiner werden. */
const BESTAND_ALTER = 0;

test('keine neue Spalten-Änderung in db/database.ts', () => {
  const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db/database.ts'), 'utf8'));
  const treffer = quelle.match(/ALTER TABLE \w+ ADD COLUMN/g) || [];

  assert.ok(treffer.length <= BESTAND_ALTER,
    `db/database.ts hat ${treffer.length} "ALTER TABLE … ADD COLUMN", erlaubt sind höchstens `
    + `${BESTAND_ALTER}. Eine NEUE Spalte gehört nach db/migrations/ — initSchema() läuft nur `
    + `bei einer Versionsänderung, und ein stiller Fehlschlag dort ist dauerhaft. Genau so ist `
    + `api_tokens.sliding im Betrieb ausgeblieben und hat die Anmeldung zerlegt.`);

  // Seit db/basis.sql steht in db/database.ts gar kein Schema mehr; das
  // Muster prüft die Gegenprobe an einem Beispiel, damit es nicht leerläuft.
  assert.equal(('x ALTER TABLE foo ADD COLUMN bar'.match(/ALTER TABLE \w+ ADD COLUMN/g) || []).length, 1);
});

test('api_tokens.sliding gibt es auf einer frischen und einer migrierten Datenbank', async (t) => {
  // Ohne die Spalte scheitert createToken() und damit Login und QR-Login.
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const spalte = await db.get(`SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'api_tokens' AND column_name = 'sliding'`);
  assert.equal(spalte?.data_type, 'boolean', 'api_tokens.sliding fehlt');
  // Eine gewachsene Datenbank bekommt sie aus der Migration: Spalte weg, deren Anweisung erneut.
  await db.run('ALTER TABLE api_tokens DROP COLUMN sliding');
  t.after(() => db.run('ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding BOOLEAN NOT NULL DEFAULT FALSE'));
  const dateien = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter(f => f.endsWith('.sql'));
  const mit = dateien.filter(f => /api_tokens ADD COLUMN IF NOT EXISTS sliding/i.test(fs.readFileSync(path.join(ROOT, 'db/migrations', f), 'utf8')));
  assert.equal(mit.length, 1, `sliding in ${mit.length} Migrationen`);
  const anweisung = /ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding[^;]*;/i
    .exec(fs.readFileSync(path.join(ROOT, 'db/migrations', mit[0]), 'utf8').replace(/^\s*--.*$/gm, ''))[0];
  await db.exec(anweisung);
  const wieder = await db.get(`SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'api_tokens' AND column_name = 'sliding'`);
  assert.equal(wieder?.data_type, 'boolean', `die Migration ${mit[0]} legt die Spalte nicht an`);
});
