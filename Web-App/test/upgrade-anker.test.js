/**
 * Meldungen, Skripte und Konfiguration verweisen auf UPGRADE.md über feste Anker
 * (`UPGRADE.md#migrationsrolle`, in UPGRADE.md `<a id="…">`), nicht über
 * Abschnittsnummern, die beim Umsortieren still auf den falschen Text zeigen.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln):
 *   A  in UPGRADE.md `<a id="eigene-datenbankrolle">` umbenannt → rot: „jeder
 *      Verweis auf UPGRADE.md trifft einen Anker“ (datenbank.ts, compose.yaml)
 *   B  in startup/datenbank.ts wieder „UPGRADE.md, Abschnitt 29“ → rot: „keine
 *      Abschnittsnummern mehr“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const quellen = require('./helpers/sources');
const WEB = path.join(__dirname, '..');
const ANKER = new Set(
  [...fs.readFileSync(path.join(WEB, 'UPGRADE.md'), 'utf8').matchAll(/<a id="([\w-]+)"><\/a>/g)].map(m => m[1]),
);
const VERWEIS = /UPGRADE\.md#([\w-]+)((?:, #[\w-]+)*)/g;

/** Was Betreiber sehen: Code, Skripte, Konfiguration und Oberflächentexte (nicht Tests, Doku, Erzeugnisse). */
function dateien() {
  const raus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'test', 'docs', 'vendor', 'coverage'].includes(n)) continue;
        lauf(p);
      } else if (/\.(ts|js|sh|ya?ml)$|^(Caddyfile|Dockerfile[\w.]*)$/.test(n)) raus.push(p);
    }
  })(WEB);
  return raus;
}

const verweise = text => [...text.matchAll(VERWEIS)].flatMap(m => [m[1], ...m[2].split(', #').filter(Boolean)]);

test('jeder Verweis trifft einen Anker, keine Abschnittsnummern mehr; die Startmeldung als Superuser zeigt auf einen Anker', () => {
  assert.ok(ANKER.size >= 10, `nur ${ANKER.size} Anker in UPGRADE.md`);
  assert.deepEqual(verweise('(UPGRADE.md#a, #b-c) und UPGRADE.md#d.'), ['a', 'b-c', 'd'], 'Selbstbeweis');

  const fehlend = [],
    nummern = [];
  let gefunden = 0;
  for (const f of dateien()) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(WEB, f);
    for (const a of verweise(text)) {
      gefunden++;
      if (!ANKER.has(a)) fehlend.push(`${rel}: #${a}`);
    }
    if (/UPGRADE\.md,?\s*(?:'\s*\+\s*')?(?:Abschnitte?|section)\s*\d/.test(quellen.ohneKommentare(text)))
      nummern.push(rel);
  }
  assert.ok(gefunden >= 20, `nur ${gefunden} Verweise gefunden — greift die Suche noch?`);
  assert.deepEqual(fehlend, [], 'jeder Verweis auf UPGRADE.md trifft einen Anker');
  assert.deepEqual(nummern, [], 'keine Abschnittsnummern mehr');

  // Die Meldung, die der Betreiber beim Start wirklich sieht: Superuser ohne Ausweg.
  quellen.baueDist();
  const lauf = spawnSync(
    process.execPath,
    ['-e', "require('./dist/startup/datenbank.js').warneBeiSuperuser({ alsSuperuserVerbunden: async () => true })"],
    { cwd: WEB, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DB_SUPERUSER_ERLAUBT: '' } },
  );
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  const inMeldung = verweise(lauf.stderr);
  assert.deepEqual(inMeldung, ['eigene-datenbankrolle', 'superuser-ausnahme'], lauf.stderr);
  for (const a of inMeldung) assert.ok(ANKER.has(a), `die Startmeldung als Superuser zeigt auf einen Anker: #${a}`);
});
