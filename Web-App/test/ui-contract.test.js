/**
 * The responses of the jsdom helper (helpers/ui.js) fulfill the
 * zod contract of their route: the default responses literally, the responses
 * of a test after adding missing required fields.
 *
 * Counter-checks (05.11.2026, each on its own):
 *   A  `count` removed from ANMELDUNG['/v2/sets'] → „Standardantworten“ red
 *   B  call of checkResponse() removed in the helper's fetch → “the UI's fetch
 *      delivers the completed response” and “a wrong test response …” red
 *   C  error responses without a check (status >= 400 skipped) → “error response
 *      without code” red
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
  for (const [path, response] of [...Object.entries(ANMELDUNG), ...Object.entries(SIGNED_OUT)]) {
    const schema = routeForRequest('GET', '/api' + path)?.response;
    if (!schema) {
      deviations.push(`${path}: keine Route mit Vertrag`);
      continue;
    }
    geprueft++;
    const r = schema.safeParse(JSON.parse(JSON.stringify(response)));
    if (!r.success)
      deviations.push(`${path}: ${r.error.issues.map(i => i.path.join('.') + ' ' + i.message).join(', ')}`);
  }
  assert.ok(geprueft >= 22, `nur ${geprueft} Standardantworten geprüft`);
  assert.deepEqual(deviations, []);
});

test('checkResponse adds required fields and throws on the wrong type', () => {
  const supplemented = checkResponse('GET', '/api/v2/sets', { success: true, sets: [{ set_number: '10294-1' }] });
  assert.equal(supplemented.count, 0);
  assert.equal(supplemented.sets[0].set_number, '10294-1');
  assert.deepEqual(supplemented.sets[0].conditions, []);
  assert.throws(
    () => checkResponse('GET', '/api/v2/sets', { success: true, sets: [], count: '3' }),
    /verletzt den Vertrag: GET \/api\/v2\/sets \(200\): count/,
  );
  // Deliberately broken, with a reason: goes out unchanged.
  const kaputt = { success: true, count: 'x', $contractViolating: 'Fehlerpfad der Oberfläche' };
  assert.equal(checkResponse('GET', '/api/v2/sets', kaputt), kaputt);
});

test('error response without code violates the contract', () => {
  assert.throws(
    () => checkResponse('GET', '/api/v2/sets', { $status: 500, success: false, error: 'kaputt' }),
    /\(500\): code/,
  );
  assert.doesNotThrow(() =>
    checkResponse('GET', '/api/v2/sets', { $status: 500, success: false, error: 'kaputt', code: 'internal_error' }),
  );
});

test("the UI's fetch delivers the completed response", async () => {
  const { w } = await openUi({
    '/v2/sets': { success: true, sets: [{ set_number: '10294-1', name: 'Titanic' }] },
  });
  try {
    const d = await (await w.fetch('/api/v2/sets')).json();
    assert.equal(d.count, 0);
    assert.equal(d.sets[0].name, 'Titanic');
    assert.equal(typeof d.sets[0].quantity, 'number');
  } finally {
    w.close();
  }
});

test('a wrong test response makes the test red', () => {
  // In its own run: the error should make a test red there, not this one.
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vertrag-')), 'probe.test.js');
  fs.writeFileSync(
    datei,
    `
    const test = require('node:test');
    const { openUi } = require(${JSON.stringify(path.join(__dirname, 'helpers', 'ui.js'))});
    test('probe', async () => {
      const { w, warte } = await openUi({ '/v2/sets': { success: true, sets: [], count: 'drei' } });
      await w.fetch('/api/v2/sets');
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
  assert.match(r.stdout, /Testantwort verletzt den Vertrag: GET \/api\/v2\/sets \(200\): count/);
});
