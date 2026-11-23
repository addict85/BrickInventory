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
const ANCHOR = new Set(
  [...fs.readFileSync(path.join(WEB, 'UPGRADE.md'), 'utf8').matchAll(/<a id="([\w-]+)"><\/a>/g)].map(m => m[1]),
);
const REFERENCE = /UPGRADE\.md#([\w-]+)((?:, #[\w-]+)*)/g;

/** What operators see: code, scripts, configuration and UI texts (not tests, docs, generated files). */
function files() {
  const result = [];
  (function run(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'test', 'docs', 'vendor', 'coverage'].includes(n)) continue;
        run(p);
      } else if (/\.(ts|js|sh|ya?ml)$|^(Caddyfile|Dockerfile[\w.]*)$/.test(n)) result.push(p);
    }
  })(WEB);
  return result;
}

const references = text => [...text.matchAll(REFERENCE)].flatMap(m => [m[1], ...m[2].split(', #').filter(Boolean)]);

test('every reference hits an anchor, no more section numbers; the startup message as superuser points to an anchor', () => {
  assert.ok(ANCHOR.size >= 10, `only ${ANCHOR.size} anchors in UPGRADE.md`);
  assert.deepEqual(references('(UPGRADE.md#a, #b-c) und UPGRADE.md#d.'), ['a', 'b-c', 'd'], 'Selbstbeweis');

  const absent = [],
    numbers = [];
  let found = 0;
  for (const f of files()) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(WEB, f);
    for (const a of references(text)) {
      found++;
      if (!ANCHOR.has(a)) absent.push(`${rel}: #${a}`);
    }
    if (/UPGRADE\.md,?\s*(?:'\s*\+\s*')?(?:Abschnitte?|section)\s*\d/.test(sources.withoutComments(text)))
      numbers.push(rel);
  }
  assert.ok(found >= 20, `only ${found} references found — does the search still work?`);
  assert.deepEqual(absent, [], 'every reference to UPGRADE.md hits an anchor');
  assert.deepEqual(numbers, [], 'no more section numbers');

  // The message the operator really sees at startup: superuser without a way out.
  sources.buildDist();
  const run = spawnSync(
    process.execPath,
    ['-e', "require('./dist/startup/database.js').warnAtSuperuser({ asSuperuserConnected: async () => true })"],
    { cwd: WEB, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DB_SUPERUSER_ALLOWED: '' } },
  );
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const inMessage = references(run.stderr);
  assert.deepEqual(inMessage, ['eigene-datenbankrolle', 'superuser-ausnahme'], run.stderr);
  for (const a of inMessage) assert.ok(ANCHOR.has(a), `the start message as superuser points to an anchor: #${a}`);
});
