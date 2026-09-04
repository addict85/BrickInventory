/**
 * Was ein Ersatzteil ist, entscheidet EINE Stelle.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * `is_spare` wurde an sechs Stellen gedeutet, mit vier verschiedenen
 * Vorstellungen davon, was „ja" heisst:
 *
 *   utils/handlers/parts.ts    true, 1, 't', 'true'
 *   routes/api_v1/sets.ts      true, 1, 't', 'true', 'True'   ← eine mehr
 *   routes/api_v1/sets.ts      r.is_spare ? 't' : 'f'         ← dritte Form
 *   routes/api_v1/sets.ts      Filter: 'f','false','False','0',''
 *   routes/api_v1/minifigs.ts  nur 't'
 *   Android, Part.isSpareFlag  '1','true','t'                 ← ohne 'True'
 *
 * Die Spalte ist INTEGER, der Treiber liefert Aggregate als Zeichenkette, und
 * der Rebrickable-Katalog schreibt 't'/'f'. Genau deshalb hat nie jemand die
 * Ersatzteil-Plakette gezeichnet, obwohl der Text dafür in beiden Sprachen
 * bereitlag: Man konnte nicht sagen, was das Feld bedeutet.
 *
 * Und die naheliegende Abkürzung wäre falsch gewesen: Der Server lieferte
 * `"0"` als ZEICHENKETTE, und die ist in JavaScript WAHR — ein
 * `if (p.is_spare)` hätte JEDES Teil als Ersatzteil markiert.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * 1. Kein Modul ausser utils/validate.ts zählt die Schreibweisen selbst auf.
 * 2. Die Antworten tragen einen echten Wahrheitswert (gegen die Datenbank
 *    gemessen, nicht aus dem Quelltext gelesen).
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

after(() => db.pool.end().catch(() => {}));

/** Alle .ts-Dateien der Server-Ordner. */
function serverDateien() {
  const out = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  for (const d of ['routes', 'utils', 'jobs', 'clients']) {
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
  //
  //   a) ein Vergleich direkt auf is_spare — deckt `p.is_spare === 't'`
  //      genauso ab wie `ip.is_spare='t'` in SQL
  //   b) irgendein Vergleich gegen 'True' — diese Schreibweise kommt in
  //      diesem Baum ausschliesslich als Rebrickable-Wahrheitswert vor
  //      (nachgemessen: ausser in Kommentaren nirgends sonst)
  const verdaechtig = [
    /\bis_spare\s*===?\s*'(?:t|true|True|1)'/,
    /===?\s*'True'/,
  ];
  const gefunden = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei).split(path.sep).join('/');
    if (rel === 'utils/validate.ts') continue;   // DIE eine Stelle
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    if (verdaechtig.some(r => r.test(src))) gefunden.push(rel);
  }
  assert.deepEqual(gefunden, [],
    'Hier wird wieder selbst entschieden, was ein Ersatzteil ist:\n  ' +
    gefunden.join('\n  ') +
    '\nDie Lesart steht in utils/validate.ts, istErsatzteil(). Sechs Fassungen ' +
    'mit vier verschiedenen Bedeutungen waren der Grund, warum die ' +
    'Ersatzteil-Plakette jahrelang nicht gezeichnet wurde.');

  // Selbstbeweis: Der Helfer muss die Schreibweisen wirklich kennen — sonst
  // wäre die Prüfung oben grün, weil es nirgends mehr etwas zu finden gibt.
  const helfer = fs.readFileSync(path.join(ROOT, 'utils', 'validate.ts'), 'utf8');
  const i = helfer.indexOf('export function istErsatzteil(');
  assert.ok(i > 0, 'istErsatzteil() fehlt');
  const rumpf = helfer.slice(i, helfer.indexOf('\n}', i));
  for (const form of ["'1'", "'t'", "'true'"])
    assert.ok(rumpf.includes(form), `istErsatzteil() kennt ${form} nicht`);
});

test('die Antwort traegt einen echten Wahrheitswert', async (t) => {
  try { await db.get('SELECT 1'); }
  catch {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('spare','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='spare'`)).id;
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,'75192-1','Falcon',1)`, [uid]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,part_name,quantity,source,is_spare)
                VALUES ($1,'75192-1','3001',4,'Brick',10,'set',1),
                       ($1,'75192-1','3020',0,'Plate',2,'set',0)`, [uid]);

  const { getParts } = _req('utils/handlers/parts.js');
  const parts = (await getParts([uid], { page_size: 60 })).parts || [];
  assert.equal(parts.length, 2, 'Vorlage');
  for (const p of parts) {
    assert.equal(typeof p.is_spare, 'boolean',
      `${p.part_number}: is_spare ist ${JSON.stringify(p.is_spare)} (${typeof p.is_spare}). ` +
      'Als Zeichenkette "0" wäre der Wert in JavaScript WAHR — genau die Falle, ' +
      'wegen der die Plakette nie gezeichnet wurde.');
  }
  assert.equal(parts.find(p => p.part_number === '3001').is_spare, true);
  assert.equal(parts.find(p => p.part_number === '3020').is_spare, false);
});
