/**
 * What a spare part is is decided by ONE place.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare, testData } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();

after(() => db.pool.end().catch(() => {}));

/** All .ts files of the server folders. */
function serverFiles() {
  const out = [];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  for (const d of ['routes', 'src', 'jobs', 'clients']) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) lauf(abs);
  }
  return out;
}

test('the spellings are enumerated in only one place', () => {
  const dateien = serverFiles();
  assert.ok(dateien.length >= 40, `Nur ${dateien.length} Server-Dateien gefunden — Pfad veraltet?`);

  // Two forms, both WITHOUT a window — a window of 200 characters caught, on the
  // first attempt, the FILTER parameter across the line break
  // (`spare === '1'`), and three of four hits were wrong.
  const suspicious = [/\bis_spare\s*===?\s*'(?:t|true|True|1)'/, /===?\s*'True'/];
  const found = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei).split(path.sep).join('/');
    if (rel === 'src/infra/validate.ts') continue; // THE one place
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    if (suspicious.some(r => r.test(src))) found.push(rel);
  }
  assert.deepEqual(
    found,
    [],
    'Hier wird wieder selbst entschieden, was ein Ersatzteil ist:\n  ' +
      found.join('\n  ') +
      '\nDie Lesart steht in src/infra/validate.ts, isSparePart(). Sechs Fassungen ' +
      'mit vier verschiedenen Bedeutungen waren der Grund, warum die ' +
      'Ersatzteil-Plakette jahrelang nicht gezeichnet wurde.',
  );

  // Self-proof: the helper must really know the notations — otherwise
  // the check above would be green because there is nothing left to find anywhere.
  const helper = fs.readFileSync(path.join(ROOT, 'src/infra/validate.ts'), 'utf8');
  // isSparePart() reads with isYes(), the reading of all yes/no values from outside.
  const i = helper.indexOf('export function isYes(');
  assert.ok(i > 0, 'isYes() fehlt');
  const rumpf = helper.slice(i, helper.indexOf('\n}', i));
  for (const form of ["'1'", "'t'", "'true'"]) assert.ok(rumpf.includes(form), `isYes() kennt ${form} nicht`);
});

test('the response carries a real boolean', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    keineDb(t);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  // initSchemaOnce() — not initSchema(): afterwards it runs the
  // numbered migrations (db/database.ts, `const applied = await
  // runMigrations(client)`). The catalogs from migration 0034 only exist there,
  // and since 0034 the spare part flag stands in set_parts_catalog.
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('spare','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='spare'`)).id;
  await holdsSet(db, uid, '75192-1', 1);
  // ── is_spare belongs to the PARTS LIST of the set, not to the part ────────────
  //
  // Since migration 0034 it stands in set_parts_catalog, and that is the
  // right place: the same brick is a spare part in one set and a required part in the
  // next. The question of this test stays the same — does a real
  // boolean arrive at the reader.
  await db.run(`INSERT INTO set_parts (set_number,part_number,color_id,quantity,is_spare)
                VALUES ('75192-1','3001',4,10,true),
                       ('75192-1','3020',0,2,false)`);
  await holdsPart(db, uid, '3001', { setNumber: '75192-1', quantity: 10, colorId: 4 });
  await holdsPart(db, uid, '3020', { setNumber: '75192-1', quantity: 2, colorId: 0 });

  const { partsQuery } = _req('src/parts/queries.js');
  const parts = (await partsQuery([uid], { page_size: 60 })).parts || [];
  assert.equal(parts.length, 2, 'Vorlage');
  for (const p of parts) {
    assert.equal(
      typeof p.is_spare,
      'boolean',
      `${p.part_number}: is_spare ist ${JSON.stringify(p.is_spare)} (${typeof p.is_spare}). ` +
        'Als Zeichenkette "0" wäre der Wert in JavaScript WAHR — genau die Falle, ' +
        'wegen der die Plakette nie gezeichnet wurde.',
    );
  }
  assert.equal(parts.find(p => p.part_number === '3001').is_spare, true);
  assert.equal(parts.find(p => p.part_number === '3020').is_spare, false);
});
