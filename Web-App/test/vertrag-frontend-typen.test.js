/**
 * Die Oberfläche liest die Antworten von api() mit den Typen des Vertrags:
 * frontend-typen/vertrag.d.ts ist aus docs/openapi.json erzeugt, und
 * frontend-typen/api.d.ts ordnet jedem Pfad seine Route zu. Geprüft wird mit
 * tsc an einer Probe, welche Zugriffe durchgehen und welche nicht.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in vertrag.d.ts SetsResponse.sets in SetItems umbenannt → rot: „die
 *      eingecheckten Typen sind aus openapi.json erzeugt“
 *   B  in api.d.ts Genaueste weggelassen (alle passenden Routen statt der
 *      genauesten) → rot: „api(): jeder Pfad bekommt die Antwort seiner Route“
 *      und „/v1/sets/:nr/parts-list trifft nur seine Route“
 *   C  in api.d.ts FehlerZu durch ApiFehler ersetzt → rot: „ohne Prüfung auf
 *      success ist ein Feld undefined, nicht unbekannt“
 *   D  in 13-acquisition-modals.js einen Pfad als Variable statt Vorlage → rot:
 *      „api()-Pfade stehen als Literal oder Vorlage da“ (13 statt 12)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { QUELLE, ZIEL, erzeuge } = require('../scripts/vertrag-frontend-typen.js');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

test('die eingecheckten Typen sind aus openapi.json erzeugt', () => {
  const soll = erzeuge(JSON.parse(fs.readFileSync(QUELLE, 'utf8')));
  assert.ok(fs.readFileSync(ZIEL, 'utf8') === soll, 'frontend-typen/vertrag.d.ts ist veraltet — npm run vertrag:frontend');
});

/** Prüft eine Probe gegen die Typen; liefert die Meldungen je Zeile. @param {string} probe */
function pruefe(probe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vertrag-typen-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.js'), probe);
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true, noEmit: true, target: 'es2022', module: 'es2022',
        moduleResolution: 'bundler', moduleDetection: 'force', strict: true, types: [], skipLibCheck: true },
      files: ['probe.js', path.join(ROOT, 'frontend-typen', 'api.d.ts')],
    }));
    const r = spawnSync(process.execPath, [TSC, '-p', dir], { encoding: 'utf8' });
    const zeilen = (r.stdout + r.stderr).split('\n').filter(z => /error TS/.test(z));
    /** @type {Record<number, string>} */
    const je = {};
    for (const z of zeilen) { const m = z.match(/probe\.js\((\d+),/); if (m) je[+m[1]] = (je[+m[1]] ? je[+m[1]] + '\n' : '') + z; }
    return je;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const KOPF = `/**
 * @template {string} M @template {string} P
 * @param {M} m @param {P} p
 * @returns {Promise<import(${JSON.stringify(path.join(ROOT, 'frontend-typen', 'api'))}).ApiAntwort<M, P>>}
 */
async function api(m, p) { return /** @type {any} */ (null); }
/** @param {number} n */ function zahl(n) { return n; }
const nr = String(Math.random());
`;

test('api(): jeder Pfad bekommt die Antwort seiner Route', () => {
  // Jede Zeile ab der dritten soll genau dann rot sein, wenn sie mit FEHLT endet.
  const faelle = [
    "api('GET', '/v1/sets').then(d => { if (d.success) zahl(d.total); });",
    "api('GET', '/v1/sets').then(d => { if (d.success) zahl(d.gibtsnicht); }); // FEHLT",
    "api('GET', `/v1/sets?${nr}`).then(d => { if (d.success) zahl(d.total); });",
    "api('GET', `/v1/stats${nr}`).then(d => { if (d.success) zahl(d.stats?.total_sets ?? 0); });",
    "api('GET', `/v1/sets/${nr}/parts-list`).then(d => { if (d.success) zahl(d.parts.length); });",
    "api('GET', `/v1/sets/${nr}`).then(d => { if (d.success) zahl(d.parts.length); }); // FEHLT",
    "api('GET', '/v1/sets').then(d => { zahl(d.total); }); // FEHLT",
    "api('GET', '/v1/sets/' + nr).then(d => { zahl(d.waswillstdu); });",
  ];
  const probe = KOPF + faelle.join('\n') + '\n';
  const versatz = KOPF.split('\n').length - 1;
  const meldungen = pruefe(probe);
  faelle.forEach((f, i) => {
    const rot = !!meldungen[versatz + i + 1];
    const soll = f.endsWith('// FEHLT');
    assert.equal(rot, soll, `${soll ? 'erwartet rot' : 'erwartet grün'}: ${f}\n${meldungen[versatz + i + 1] || ''}`);
  });
});

test('/v1/sets/:nr/parts-list trifft nur seine Route', () => {
  const m = pruefe(KOPF + "api('GET', `/v1/sets/${nr}/parts-list`).then(d => { if (d.success) zahl(d.parts.length); });\n");
  assert.deepEqual(Object.values(m), []);
});

test('ohne Prüfung auf success ist ein Feld undefined, nicht unbekannt', () => {
  // Unter strict: `d.total` ist number | undefined, mit Rückfall also eine Zahl.
  const m = pruefe(KOPF + "api('GET', '/v1/sets').then(d => { zahl(d.total ?? 0); });\n");
  assert.deepEqual(Object.values(m), []);
});

test('api()-Pfade stehen als Literal oder Vorlage da', () => {
  // Nur dann kennt tsc die Route. Ein zusammengesetzter Pfad (Variable,
  // `'/v1/x/' + nr`) bleibt ungeprüft; ihre Zahl darf sinken, nie steigen.
  const SCHRANKE = 12;
  const js = path.join(ROOT, 'public', 'js');
  const offen = [];
  for (const f of fs.readdirSync(js).filter(n => /^\d\d-.*\.js$/.test(n))) {
    const src = fs.readFileSync(path.join(js, f), 'utf8');
    for (const m of src.matchAll(/\bapi\(\s*(['"])[A-Z]+\1\s*,\s*([^'"`\s])/g)) offen.push(`${f}: ${src.slice(m.index, m.index + 50)}`);
    for (const m of src.matchAll(/\bapi\(\s*(['"])[A-Z]+\1\s*,\s*(['"])[^'"]*\2\s*\+/g)) offen.push(`${f}: ${src.slice(m.index, m.index + 50)}`);
  }
  assert.ok(offen.length <= SCHRANKE, `${offen.length} ungeprüfte Pfade (Schranke ${SCHRANKE}):\n${offen.join('\n')}`);
  if (offen.length < SCHRANKE) console.log(`  ℹ ungeprüfte api()-Pfade: ${offen.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});
