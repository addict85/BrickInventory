/**
 * Messages, scripts and configuration refer to UPGRADE.md via fixed anchors
 * (`UPGRADE.md#migrationsrolle`, in UPGRADE.md `<a id="…">`), not via
 * section numbers, which silently point to the wrong text after reordering.
 *
 * Counter-checks (measured 12.11.2026, each on its own):
 *   A  `<a id="eigene-datenbankrolle">` renamed in UPGRADE.md → red: „jeder
 *      Verweis auf UPGRADE.md trifft einen Anker“ (datenbank.ts, compose.yaml)
 *   B  in startup/database.ts again „UPGRADE.md, Abschnitt 29“ → red: „keine
 *      Abschnittsnummern mehr“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sources = require('./helpers/sources');
const WEB = path.join(__dirname, '..');
const ANKER = new Set(
  [...fs.readFileSync(path.join(WEB, 'UPGRADE.md'), 'utf8').matchAll(/<a id="([\w-]+)"><\/a>/g)].map(m => m[1]),
);
const REFERENCE = /UPGRADE\.md#([\w-]+)((?:, #[\w-]+)*)/g;

/** What operators see: code, scripts, configuration and UI texts (not tests, docs, generated files). */
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

const references = text => [...text.matchAll(REFERENCE)].flatMap(m => [m[1], ...m[2].split(', #').filter(Boolean)]);

test('every reference hits an anchor, no more section numbers; the startup message as superuser points to an anchor', () => {
  assert.ok(ANKER.size >= 10, `nur ${ANKER.size} Anker in UPGRADE.md`);
  assert.deepEqual(references('(UPGRADE.md#a, #b-c) und UPGRADE.md#d.'), ['a', 'b-c', 'd'], 'Selbstbeweis');

  const absent = [],
    nummern = [];
  let found = 0;
  for (const f of dateien()) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(WEB, f);
    for (const a of references(text)) {
      found++;
      if (!ANKER.has(a)) absent.push(`${rel}: #${a}`);
    }
    if (/UPGRADE\.md,?\s*(?:'\s*\+\s*')?(?:Abschnitte?|section)\s*\d/.test(sources.ohneKommentare(text)))
      nummern.push(rel);
  }
  assert.ok(found >= 20, `only ${found} references found — does the search still work?`);
  assert.deepEqual(absent, [], 'every reference to UPGRADE.md hits an anchor');
  assert.deepEqual(nummern, [], 'no more section numbers');

  // The message the operator really sees at startup: superuser without a way out.
  sources.buildDist();
  const lauf = spawnSync(
    process.execPath,
    ['-e', "require('./dist/startup/database.js').warnAtSuperuser({ asSuperuserConnected: async () => true })"],
    { cwd: WEB, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DB_SUPERUSER_ALLOWED: '' } },
  );
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  const inMessage = references(lauf.stderr);
  assert.deepEqual(inMessage, ['eigene-datenbankrolle', 'superuser-ausnahme'], lauf.stderr);
  for (const a of inMessage) assert.ok(ANKER.has(a), `the start message as superuser points to an anchor: #${a}`);
});
