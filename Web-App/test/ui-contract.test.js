/**
 * Die Antworten der jsdom-Hilfe (helpers/ui.js) erfüllen den
 * zod-Vertrag ihrer Route: die Standardantworten wörtlich, die Antworten
 * eines Tests nach dem Ergänzen fehlender Pflichtfelder.
 *
 * Gegenproben (05.11.2026, je einzeln):
 *   A  `count` aus ANMELDUNG['/v1/sets'] entfernt → „Standardantworten“ rot
 *   B  Aufruf von checkResponse() im fetch der Hilfe entfernt → „fetch der
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
const { ANMELDUNG, SIGNED_OUT, checkResponse, openUi } = require('./helpers/ui');
const { buildDist } = require('./helpers/sources');

buildDist();
const { routeForRequest } = require(path.join(__dirname, '..', 'dist/src/contract/index.js'));

test('default responses fulfill the contract without additions', () => {
  const deviations = [];
  let geprueft = 0;
  for (const [pfad, antwort] of [...Object.entries(ANMELDUNG), ...Object.entries(SIGNED_OUT)]) {
    const schema = routeForRequest('GET', '/api' + pfad)?.antwort;
    if (!schema) {
      deviations.push(`${pfad}: keine Route mit Vertrag`);
      continue;
    }
    geprueft++;
    const r = schema.safeParse(JSON.parse(JSON.stringify(antwort)));
    if (!r.success)
      deviations.push(`${pfad}: ${r.error.issues.map(i => i.path.join('.') + ' ' + i.message).join(', ')}`);
  }
  assert.ok(geprueft >= 22, `nur ${geprueft} Standardantworten geprüft`);
  assert.deepEqual(deviations, []);
});

test('checkResponse adds required fields and throws on the wrong type', () => {
  const supplemented = checkResponse('GET', '/api/v1/sets', { success: true, sets: [{ set_number: '10294-1' }] });
  assert.equal(supplemented.count, 0);
  assert.equal(supplemented.sets[0].set_number, '10294-1');
  assert.deepEqual(supplemented.sets[0].conditions, []);
  assert.throws(
    () => checkResponse('GET', '/api/v1/sets', { success: true, sets: [], count: '3' }),
    /verletzt den Vertrag: GET \/api\/v1\/sets \(200\): count/,
  );
  // Absichtlich kaputt, mit Grund: geht unverändert hinaus.
  const kaputt = { success: true, count: 'x', $contractViolating: 'Fehlerpfad der Oberfläche' };
  assert.equal(checkResponse('GET', '/api/v1/sets', kaputt), kaputt);
});

test('error response without code violates the contract', () => {
  assert.throws(
    () => checkResponse('GET', '/api/v1/sets', { $status: 500, success: false, error: 'kaputt' }),
    /\(500\): code/,
  );
  assert.doesNotThrow(() =>
    checkResponse('GET', '/api/v1/sets', { $status: 500, success: false, error: 'kaputt', code: 'interner_fehler' }),
  );
});

test("the UI's fetch delivers the completed response", async () => {
  const { w } = await openUi({
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

test('a wrong test response makes the test red', () => {
  // In einem eigenen Lauf: Der Fehler soll dort einen Test rot machen, nicht diesen.
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vertrag-')), 'probe.test.js');
  fs.writeFileSync(
    datei,
    `
    const test = require('node:test');
    const { openUi } = require(${JSON.stringify(path.join(__dirname, 'helpers', 'ui.js'))});
    test('probe', async () => {
      const { w, warte } = await openUi({ '/v1/sets': { success: true, sets: [], count: 'drei' } });
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
