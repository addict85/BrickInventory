/**
 * Was ein Ersatzteil ist, entscheidet EINE Stelle.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { haeltSet, haeltTeil } = require('./helpers/bestand');
const db = _req('db/database.js');

after(() => db.pool.end().catch(() => {}));

/** Alle .ts-Dateien der Server-Ordner. */
function serverDateien() {
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

test('die Schreibweisen werden nur an einer Stelle aufgezaehlt', () => {
  const dateien = serverDateien();
  assert.ok(dateien.length >= 40, `Nur ${dateien.length} Server-Dateien gefunden — Pfad veraltet?`);

  // Zwei Formen, beide OHNE Fenster — ein Fenster von 200 Zeichen hat beim
  // ersten Versuch quer über den Zeilenumbruch hinweg den FILTER-Parameter
  // (`spare === '1'`) mitgefangen und drei von vier Treffern waren falsch.
  const verdaechtig = [/\bis_spare\s*===?\s*'(?:t|true|True|1)'/, /===?\s*'True'/];
  const gefunden = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei).split(path.sep).join('/');
    if (rel === 'src/infra/validate.ts') continue; // DIE eine Stelle
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    if (verdaechtig.some(r => r.test(src))) gefunden.push(rel);
  }
  assert.deepEqual(
    gefunden,
    [],
    'Hier wird wieder selbst entschieden, was ein Ersatzteil ist:\n  ' +
      gefunden.join('\n  ') +
      '\nDie Lesart steht in src/infra/validate.ts, istErsatzteil(). Sechs Fassungen ' +
      'mit vier verschiedenen Bedeutungen waren der Grund, warum die ' +
      'Ersatzteil-Plakette jahrelang nicht gezeichnet wurde.',
  );

  // Selbstbeweis: Der Helfer muss die Schreibweisen wirklich kennen — sonst
  // wäre die Prüfung oben grün, weil es nirgends mehr etwas zu finden gibt.
  const helfer = fs.readFileSync(path.join(ROOT, 'src/infra/validate.ts'), 'utf8');
  // istErsatzteil() liest mit istJa(), der Lesart aller Ja/Nein-Werte von aussen.
  const i = helfer.indexOf('export function istJa(');
  assert.ok(i > 0, 'istJa() fehlt');
  const rumpf = helfer.slice(i, helfer.indexOf('\n}', i));
  for (const form of ["'1'", "'t'", "'true'"]) assert.ok(rumpf.includes(form), `istJa() kennt ${form} nicht`);
});

test('die Antwort traegt einen echten Wahrheitswert', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    keineDb(t);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  // initSchemaOnce() — nicht initSchema(): Es faehrt anschliessend die
  // nummerierten Migrationen (db/database.ts, `const applied = await
  // runMigrations(client)`). Die Kataloge aus Migration 0034 gibt es nur dort,
  // und das Ersatzteilkennzeichen steht seit 0034 in set_parts_catalog.
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('spare','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='spare'`)).id;
  await haeltSet(db, uid, '75192-1', 1);
  // ── is_spare gehoert zur TEILELISTE des Sets, nicht zum Teil ────────────
  //
  // Seit Migration 0034 steht es in set_parts_catalog, und das ist die
  // richtige Stelle: Derselbe Stein ist in einem Set Ersatzteil und im
  // naechsten Pflichtteil. Die Frage dieses Tests bleibt dieselbe — kommt
  // beim Leser ein echter Wahrheitswert an.
  await db.run(`INSERT INTO set_teile (set_number,part_number,color_id,quantity,is_spare)
                VALUES ('75192-1','3001',4,10,true),
                       ('75192-1','3020',0,2,false)`);
  await haeltTeil(db, uid, '3001', { setNumber: '75192-1', menge: 10, colorId: 4 });
  await haeltTeil(db, uid, '3020', { setNumber: '75192-1', menge: 2, colorId: 0 });

  const { getParts } = _req('src/teile/abfragen.js');
  const parts = (await getParts([uid], { page_size: 60 })).parts || [];
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
