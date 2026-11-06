/**
 * scripts/test-lauf.js: Eine Datei, die nur an der Frist scheitert, läuft
 * einzeln mit doppelter Frist nach. Wird sie dort grün, ist der Lauf grün und
 * sagt es; bleibt sie rot, ist er rot. Ein echter Fehler wird nie nachgeholt.
 *
 * Geprüft am echten Runner mit kurzer Frist (TEST_FRIST_MS) und drei kleinen
 * Testdateien im Temp-Ordner.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in mitNachlauf() sofort `return r.code` → rot: „unter Last zu langsam,
 *      einzeln grün: der Lauf ist grün“
 *   B  in fristFehler() jede rote Datei als Fristfehler gezählt → rot: „ein
 *      echter Fehler wird nicht nachgeholt“
 *   C  im Nachlauf dieselbe Frist statt der doppelten → rot: „unter Last zu
 *      langsam …“ (die Datei braucht mehr als die einfache Frist)
 *   D  meldeNachlauf() nicht aufgerufen → rot: „unter Last zu langsam …“ (keine WARNUNG)
 *   E  TEST_NACHLAUF nicht ausgewertet → rot: „mit TEST_NACHLAUF=aus …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function runner(dateien, mehr = {}) {
  const env = { ...process.env, TEST_FRIST_MS: '3000', TEST_PARALLEL: '2' };
  delete env.TEST_NACHLAUF;
  Object.assign(env, mehr);
  // Ohne Datenbank und nicht als Kind dieses Testlaufs: sonst schriebe node --test anders.
  for (const k of ['TEST_DATABASE_URL', 'TEST_DB_VORLAGE', 'TEST_DB_BASIS', 'TEST_DB_EIGEN', 'NODE_TEST_CONTEXT']) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-lauf.js'), ...dateien],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, aus: r.stdout + r.stderr };
}

test('Frist und Nachlauf im Runner', { concurrency: 1, timeout: 240_000 }, async (t) => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lauf-frist-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const marke = path.join(ordner, 'schon-gelaufen');
  const datei = (name, rumpf) => { const p = path.join(ordner, name); fs.writeFileSync(p, `const test = require('node:test');\n${rumpf}\n`); return p; };
  // Erst 8 s, dann 3 s: über der Frist (3 s), unter der doppelten — wie unter fremder Last.
  const langsam = datei('langsam.test.js', `const fs = require('node:fs');
test('braucht erst 8 s, dann 3 s', async () => {
  const erstes = !fs.existsSync(${JSON.stringify(marke)});
  fs.writeFileSync(${JSON.stringify(marke)}, '1');
  await new Promise(r => setTimeout(r, erstes ? 8000 : 3000));
});`);
  const immerLangsam = datei('immer-langsam.test.js', `test('braucht immer 9 s', () => new Promise(r => setTimeout(r, 9000)));`);
  const kaputt = datei('kaputt.test.js', `test('scheitert', () => { throw new Error('echter Fehler'); });`);

  await t.test('unter Last zu langsam, einzeln grün: der Lauf ist grün', () => {
    const r = runner([langsam]);
    assert.match(r.aus, /Nachlauf einzeln: .*langsam\.test\.js/);
    assert.match(r.aus, /Nachlauf grün/);
    assert.match(r.aus, /::warning title=Frist überschritten::.*langsam\.test\.js/);
    assert.match(r.aus, /WARNUNG: 1 Datei\(en\) nur im Nachlauf grün .*langsam\.test\.js/);
    assert.equal(r.code, 0, r.aus.slice(-1500));
  });

  await t.test('mit TEST_NACHLAUF=aus ist die Fristüberschreitung rot', () => {
    fs.rmSync(marke, { force: true });
    const r = runner([langsam], { TEST_NACHLAUF: 'aus' });
    assert.match(r.aus, /kein Nachlauf \(TEST_NACHLAUF=aus\)/);
    assert.notEqual(r.code, 0);
  });

  await t.test('einzeln weiter zu langsam: der Lauf ist rot', () => {
    const r = runner([immerLangsam]);
    assert.match(r.aus, /Nachlauf ROT/);
    assert.notEqual(r.code, 0);
  });

  await t.test('ein echter Fehler wird nicht nachgeholt', () => {
    const r = runner([kaputt]);
    assert.doesNotMatch(r.aus, /Nachlauf/);
    assert.notEqual(r.code, 0);
  });
});
