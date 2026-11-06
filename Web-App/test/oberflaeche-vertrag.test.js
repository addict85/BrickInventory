/**
 * Die Antworten der jsdom-Hilfe (helpers/oberflaeche.js) erfüllen den
 * zod-Vertrag ihrer Route: die Standardantworten wörtlich, die Antworten
 * eines Tests nach dem Ergänzen fehlender Pflichtfelder.
 *
 * Gegenproben (05.11.2026, je einzeln):
 *   A  `count` aus ANMELDUNG['/v1/sets'] entfernt → „Standardantworten“ rot
 *   B  Aufruf von pruefeAntwort() im fetch der Hilfe entfernt → „fetch der
 *      Oberfläche liefert die ergänzte Antwort“ und „eine falsche Testantwort …“ rot
 *   C  Fehlerantworten ohne Prüfung (status >= 400 übersprungen) → „Fehlerantwort
 *      ohne code“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ANMELDUNG, ABGEMELDET, pruefeAntwort, oeffneOberflaeche } = require('./helpers/oberflaeche');
const { baueDist } = require('./helpers/sources');

baueDist();
const { routeFuerAnfrage } = require('../dist/src/infra/vertrag/index.js');

test('Standardantworten erfüllen den Vertrag ohne Ergänzung', () => {
  const abweichungen = [];
  let geprueft = 0;
  for (const [pfad, antwort] of [...Object.entries(ANMELDUNG), ...Object.entries(ABGEMELDET)]) {
    const schema = routeFuerAnfrage('GET', '/api' + pfad)?.antwort;
    if (!schema) {
      abweichungen.push(`${pfad}: keine Route mit Vertrag`);
      continue;
    }
    geprueft++;
    const r = schema.safeParse(JSON.parse(JSON.stringify(antwort)));
    if (!r.success)
      abweichungen.push(`${pfad}: ${r.error.issues.map(i => i.path.join('.') + ' ' + i.message).join(', ')}`);
  }
  assert.ok(geprueft >= 22, `nur ${geprueft} Standardantworten geprüft`);
  assert.deepEqual(abweichungen, []);
});

test('pruefeAntwort ergänzt Pflichtfelder und wirft bei falschem Typ', () => {
  const ergaenzt = pruefeAntwort('GET', '/api/v1/sets', { success: true, sets: [{ set_number: '10294-1' }] });
  assert.equal(ergaenzt.count, 0);
  assert.equal(ergaenzt.sets[0].set_number, '10294-1');
  assert.deepEqual(ergaenzt.sets[0].conditions, []);
  assert.throws(
    () => pruefeAntwort('GET', '/api/v1/sets', { success: true, sets: [], count: '3' }),
    /verletzt den Vertrag: GET \/api\/v1\/sets \(200\): count/,
  );
  // Absichtlich kaputt, mit Grund: geht unverändert hinaus.
  const kaputt = { success: true, count: 'x', $vertragswidrig: 'Fehlerpfad der Oberfläche' };
  assert.equal(pruefeAntwort('GET', '/api/v1/sets', kaputt), kaputt);
});

test('Fehlerantwort ohne code verletzt den Vertrag', () => {
  assert.throws(
    () => pruefeAntwort('GET', '/api/v1/sets', { $status: 500, success: false, error: 'kaputt' }),
    /\(500\): code/,
  );
  assert.doesNotThrow(() =>
    pruefeAntwort('GET', '/api/v1/sets', { $status: 500, success: false, error: 'kaputt', code: 'interner_fehler' }),
  );
});

test('fetch der Oberfläche liefert die ergänzte Antwort', async () => {
  const { w } = await oeffneOberflaeche({
    '/v1/sets': { success: true, sets: [{ set_number: '10294-1', name: 'Titanic' }] },
  });
  try {
    const d = await (await w.fetch('/api/v1/sets')).json();
    assert.equal(d.count, 0);
    assert.equal(d.sets[0].name, 'Titanic');
    assert.equal(typeof d.sets[0].quantity, 'number');
  } finally {
    w.close();
  }
});

test('eine falsche Testantwort macht den Test rot', () => {
  // In einem eigenen Lauf: Der Fehler soll dort einen Test rot machen, nicht diesen.
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vertrag-')), 'probe.test.js');
  fs.writeFileSync(
    datei,
    `
    const test = require('node:test');
    const { oeffneOberflaeche } = require(${JSON.stringify(path.join(__dirname, 'helpers', 'oberflaeche.js'))});
    test('probe', async () => {
      const { w, warte } = await oeffneOberflaeche({ '/v1/sets': { success: true, sets: [], count: 'drei' } });
      await w.fetch('/api/v1/sets');
      await warte(() => false, 200);
      w.close();
    });`,
  );
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', datei], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  fs.rmSync(path.dirname(datei), { recursive: true, force: true });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /Testantwort verletzt den Vertrag: GET \/api\/v1\/sets \(200\): count/);
});
