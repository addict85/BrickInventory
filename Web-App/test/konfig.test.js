/**
 * Die Datenbankverbindung steht an EINER Stelle (utils/konfig.ts). Der
 * CSV-Worker hatte eigene Standardwerte (brickinv statt brickinventory) und
 * verband sich ausserhalb von Docker mit einer anderen Datenbank.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in jobs/csvImportWorker.ts wieder `process.env.PGUSER || 'brickinv'`
 *      → rot: „niemand sonst liest die Verbindungsvariablen"
 *   B  in datenbankVerbindung die Zeile für DATABASE_URL entfernt →
 *      rot: „DATABASE_URL geht vor"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { datenbankVerbindung } = _req('utils/konfig.js');

test('ohne Angaben dieselben Standardwerte wie compose.yaml', () => {
  assert.deepEqual(datenbankVerbindung({}), {
    host: 'postgres', port: 5432, user: 'brickinventory',
    password: 'brickinventory_secret', database: 'brickinventory' });
});

test('DATABASE_URL geht vor', () => {
  assert.deepEqual(datenbankVerbindung({ DATABASE_URL: 'postgres://a:b@c/d', PGUSER: 'x' }),
    { connectionString: 'postgres://a:b@c/d' });
  assert.equal(datenbankVerbindung({ PGPORT: '6543', PGUSER: 'u' }).port, 6543);
});

test('niemand sonst liest die Verbindungsvariablen', () => {
  const funde = [];
  const durch = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'test', 'public', '.git'].includes(e.name)) durch(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const rel = path.relative(ROOT, p);
      if (rel === path.join('utils', 'konfig.ts')) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/process\.env\.(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)\b/g))
        funde.push(`${rel}: ${m[1]}`);
    }
  };
  durch(ROOT);
  assert.deepEqual(funde, []);
});
