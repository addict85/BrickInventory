/**
 * The UI reads the responses of api() with the contract's types:
 * frontend-types/contract.d.ts is generated from docs/openapi.json, and
 * frontend-types/api.d.ts assigns each path its route. Checked with
 * tsc on a probe which accesses pass and which do not.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in contract.d.ts SetsResponse.sets renamed to SetItems → red: “the
 *      checked-in types are generated from openapi.json”
 *   B  in api.d.ts Genaueste omitted (all matching routes instead of the
 *      most specific) → red: “api(): every path gets the response of its route”
 *      and “/v1/sets/:nr/parts-list hits only its route”
 *   C  in api.d.ts ErrorClose replaced by ApiError → red: “without checking
 *      success a field is undefined, not unknown”
 *   D  in kauf-dialoge.js a path as a variable instead of a template → red:
 *      “api() paths are written as literal or template” (13 instead of 12)
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { SOURCE_FILE, TARGET_FILE, create, formatted } = require('../scripts/contract-frontend-types.js');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

test('the checked-in types are generated from openapi.json', () => {
  const soll = formatted(create(JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'))));
  assert.ok(
    fs.readFileSync(TARGET_FILE, 'utf8') === soll,
    'frontend-types/contract.d.ts ist veraltet — npm run contract:frontend',
  );
});

/** Checks a probe against the types; returns the messages per line. @param {string} probe */
function pruefe(probe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vertrag-typen-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.js'), probe);
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          noEmit: true,
          target: 'es2022',
          module: 'es2022',
          moduleResolution: 'bundler',
          moduleDetection: 'force',
          strict: true,
          types: [],
          skipLibCheck: true,
        },
        files: ['probe.js', path.join(ROOT, 'frontend-types', 'api.d.ts')],
      }),
    );
    const r = spawnSync(process.execPath, [TSC, '-p', dir], { encoding: 'utf8' });
    const zeilen = (r.stdout + r.stderr).split('\n').filter(z => /error TS/.test(z));
    /** @type {Record<number, string>} */
    const je = {};
    for (const z of zeilen) {
      const m = z.match(/probe\.js\((\d+),/);
      if (m) je[+m[1]] = (je[+m[1]] ? je[+m[1]] + '\n' : '') + z;
    }
    return je;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HEADER = `/**
 * @template {string} M @template {string} P
 * @param {M} m @param {P} p
 * @returns {Promise<import(${JSON.stringify(path.join(ROOT, 'frontend-types', 'api'))}).ApiResponse<M, P>>}
 */
async function api(m, p) { return /** @type {any} */ (null); }
/** @param {number} n */ function zahl(n) { return n; }
const nr = String(Math.random());
`;

test('api(): every path gets the response of its route', () => {
  // Every line from the third on should be red exactly when it ends with FEHLT.
  const faelle = [
    "api('GET', '/v2/sets').then(d => { if (d.success) zahl(d.total); });",
    "api('GET', '/v2/sets').then(d => { if (d.success) zahl(d.gibtsnicht); }); // FEHLT",
    "api('GET', `/v2/sets?${nr}`).then(d => { if (d.success) zahl(d.total); });",
    "api('GET', `/v2/stats${nr}`).then(d => { if (d.success) zahl(d.stats?.total_sets ?? 0); });",
    "api('GET', `/v2/sets/${nr}/parts-list`).then(d => { if (d.success) zahl(d.parts.length); });",
    "api('GET', `/v2/sets/${nr}`).then(d => { if (d.success) zahl(d.parts.length); }); // FEHLT",
    "api('GET', '/v2/sets').then(d => { zahl(d.total); }); // FEHLT",
    "api('GET', '/v2/sets/' + nr).then(d => { zahl(d.waswillstdu); });",
  ];
  const probe = HEADER + faelle.join('\n') + '\n';
  const versatz = HEADER.split('\n').length - 1;
  const meldungen = pruefe(probe);
  faelle.forEach((f, i) => {
    const rot = !!meldungen[versatz + i + 1];
    const soll = f.endsWith('// FEHLT');
    assert.equal(rot, soll, `${soll ? 'erwartet rot' : 'erwartet grün'}: ${f}\n${meldungen[versatz + i + 1] || ''}`);
  });
});

test('/v2/sets/:nr/parts-list only hits its route', () => {
  const m = pruefe(
    HEADER + "api('GET', `/v2/sets/${nr}/parts-list`).then(d => { if (d.success) zahl(d.parts.length); });\n",
  );
  assert.deepEqual(Object.values(m), []);
});

test('without checking success a field is undefined, not unknown', () => {
  // Under strict: `d.total` is number | undefined, so with a fallback a number.
  const m = pruefe(HEADER + "api('GET', '/v2/sets').then(d => { zahl(d.total ?? 0); });\n");
  assert.deepEqual(Object.values(m), []);
});

test('api() paths are written as a literal or template', () => {
  // Only then does tsc know the route. A composed path (variable,
  // `'/v2/x/' + nr`) stays unchecked; their number may sink, never rise.
  const LIMIT = 12;
  const js = path.join(ROOT, 'public', 'js');
  const open = [];
  for (const f of fs.readdirSync(js).filter(n => isAppModule(n))) {
    const src = fs.readFileSync(path.join(js, f), 'utf8');
    for (const m of src.matchAll(/\bapi\(\s*(['"])[A-Z]+\1\s*,\s*([^'"`\s])/g))
      open.push(`${f}: ${src.slice(m.index, m.index + 50)}`);
    for (const m of src.matchAll(/\bapi\(\s*(['"])[A-Z]+\1\s*,\s*(['"])[^'"]*\2\s*\+/g))
      open.push(`${f}: ${src.slice(m.index, m.index + 50)}`);
  }
  assert.ok(open.length <= LIMIT, `${open.length} ungeprüfte Pfade (Schranke ${LIMIT}):\n${open.join('\n')}`);
  if (open.length < LIMIT)
    console.log(`  ℹ ungeprüfte api()-Pfade: ${open.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
});
