/**
 * Schema changes belong in db/migrations/ — not in initSchema().
 *
 * Counter-check (measured 10.11.2026): in 0015-api-tokens-sliding.sql the column
 * named `slidingx` → red: “api_tokens.sliding exists …” (the migration does not
 * create it). The part „fresh“ is checked by the template database of the test run
 * (from db/basis.sql); this counter-check is not measured.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const ohneKommentare = (/** @type {string} */ s) => require('./helpers/sources').ohneKommentare(s);
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);

/** Counted on the day of the fix. The number may only get smaller. */
const INVENTORY_ALTER = 0;

test('no new column change in db/database.ts', () => {
  const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db/database.ts'), 'utf8'));
  const treffer = quelle.match(/ALTER TABLE \w+ ADD COLUMN/g) || [];

  assert.ok(
    treffer.length <= INVENTORY_ALTER,
    `db/database.ts hat ${treffer.length} "ALTER TABLE … ADD COLUMN", erlaubt sind höchstens ` +
      `${INVENTORY_ALTER}. Eine NEUE Spalte gehört nach db/migrations/ — initSchema() läuft nur ` +
      `bei einer Versionsänderung, und ein stiller Fehlschlag dort ist dauerhaft. Genau so ist ` +
      `api_tokens.sliding im Betrieb ausgeblieben und hat die Anmeldung zerlegt.`,
  );

  // Since db/basis.sql there is no schema at all in db/database.ts any more; the
  // counter-check tests the pattern on an example so that it does not run empty.
  assert.equal(('x ALTER TABLE foo ADD COLUMN bar'.match(/ALTER TABLE \w+ ADD COLUMN/g) || []).length, 1);
});

test('api_tokens.sliding exists on a fresh and on a migrated database', async t => {
  // Without the column createToken() fails and with it login and QR login.
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const spalte = await db.get(`SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'api_tokens' AND column_name = 'sliding'`);
  assert.equal(spalte?.data_type, 'boolean', 'api_tokens.sliding fehlt');
  // A grown database gets it from the migration: column gone, its statement again.
  await db.run('ALTER TABLE api_tokens DROP COLUMN sliding');
  t.after(() => db.run('ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding BOOLEAN NOT NULL DEFAULT FALSE'));
  const dateien = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter(f => f.endsWith('.sql'));
  const mit = dateien.filter(f =>
    /api_tokens ADD COLUMN IF NOT EXISTS sliding/i.test(fs.readFileSync(path.join(ROOT, 'db/migrations', f), 'utf8')),
  );
  assert.equal(mit.length, 1, `sliding in ${mit.length} Migrationen`);
  const instruction = /ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding[^;]*;/i.exec(
    fs.readFileSync(path.join(ROOT, 'db/migrations', mit[0]), 'utf8').replace(/^\s*--.*$/gm, ''),
  )[0];
  await db.exec(instruction);
  const wieder = await db.get(`SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'api_tokens' AND column_name = 'sliding'`);
  assert.equal(wieder?.data_type, 'boolean', `die Migration ${mit[0]} legt die Spalte nicht an`);
});
