/**
 * The server log (src/infra/log.ts): JSON lines on stdout/stderr,
 * next to it app_logs in the previous text format; write errors are counted and
 * reported at most once per minute instead of swallowed.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in emptyLog() the error branch again `() => {}` → red:
 *      “write errors: immediately, then collected per minute” (no message)
 *   B  in schreibfehler() the minute rule removed (always report immediately) →
 *      red: the same check (three messages instead of one)
 *   C  in jsonRow() the request identifier left out → red: “a line is
 *      JSON with time, level, message, request and context”
 *   D  in anfrageKennung() the filter removed (every string taken over)
 *      → red: “X-Request-Id: only harmless identifiers …”
 *   E  (22.11.2026) oneLine() returns its text unchanged → red: “a line break stays in one
 *      entry …”; format() left out → red: the same check (placeholders stay)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const P = _req('src/infra/log.js');

/** An output to read along, with an adjustable clock. */
function transcript() {
  const m = { out: [], err: [], clock: Date.parse('2026-10-30T12:00:00Z') };
  return { m, output: { out: z => m.out.push(z), err: z => m.err.push(z), now: () => m.clock } };
}

test('a line is JSON with time, level, message, request and context', t => {
  const { m, output } = transcript();
  t.after(P.installLog(output));
  P.requestContext.run({ rid: 'ab12' }, () => console.warn('Preis fehlt für', '10294-1', { condition: 'N' }));
  console.log('ohne Anfrage');
  console.error('kaputt', new Error('Verbindung weg'));
  assert.equal(m.err.length, 2);
  const warn = JSON.parse(m.err[0]);
  assert.deepEqual(
    { ...warn, pid: 0 },
    {
      zeit: '2026-10-30T12:00:00.000Z',
      stufe: 'warn',
      message: 'Preis fehlt für 10294-1',
      pid: 0,
      rid: 'ab12',
      kontext: { condition: 'N' },
    },
  );
  assert.equal(warn.pid, process.pid);
  const info = JSON.parse(m.out[0]);
  assert.equal(info.stufe, 'info');
  assert.equal(info.rid, undefined);
  const error = JSON.parse(m.err[1]);
  assert.equal(error.message, 'kaputt Verbindung weg');
  assert.equal(error.kontext.error.message, 'Verbindung weg');
  assert.match(error.kontext.error.stack, /log\.test\.js/);
});

test('a line break stays in one entry; placeholders take the values', async t => {
  const { m, output } = transcript();
  t.after(P.installLog(output));
  const geschrieben = [];
  P.logToDatabase({
    query: async (sql, values) => {
      if (sql.startsWith('INSERT')) geschrieben.push(values);
    },
  });
  // As a request could send it: a forged second entry in the path.
  console.warn('[route] %s %d:', 'GET /x\n[route] gefälscht\r\n', 404, { ok: 1 });
  console.log('ohne Platzhalter', 'a\rb');
  await P.emptyLog();
  const json = JSON.parse(m.err[0]);
  assert.equal(json.message, '[route] GET /x ⏎ [route] gefälscht ⏎  404:');
  assert.deepEqual(json.kontext, { ok: 1 });
  assert.equal(JSON.parse(m.out[0]).message, 'ohne Platzhalter ab');
  for (const [, text] of geschrieben) assert.doesNotMatch(text, /[\r\n]/, text);
});

test('app_logs gets the lines in the previous text format', async t => {
  const { output } = transcript();
  t.after(P.installLog(output));
  const geschrieben = [];
  P.logToDatabase({
    query: async (sql, values) => {
      if (sql.startsWith('INSERT')) geschrieben.push(values);
    },
  });
  P.requestContext.run({ rid: 'cd34' }, () => console.info('Set angelegt', { set: '42115-1' }));
  await P.emptyLog();
  assert.equal(geschrieben.length, 1);
  assert.equal(geschrieben[0][0], 'info');
  assert.match(geschrieben[0][1], /^\[\d{1,4}\/cd34\] Set angelegt \{"set":"42115-1"\}$/);
});

test('write errors: immediately, then collected per minute', async t => {
  const { m, output } = transcript();
  t.after(P.installLog(output));
  P.logToDatabase({
    query: async () => {
      throw new Error('Datenbank weg');
    },
  });
  const row = async n => {
    for (let i = 0; i < n; i++) console.log('Zeile', i);
    await P.emptyLog();
  };
  await row(3);
  m.clock += 10_000;
  await row(2);
  m.clock += 10_000;
  await row(4);
  const meldungen = () => m.err.map(z => JSON.parse(z)).filter(z => z.message.startsWith('app_logs:'));
  assert.equal(meldungen().length, 1, 'innerhalb der Minute nur die erste Meldung');
  assert.equal(meldungen()[0].message, 'app_logs: 3 Zeile(n) nicht geschrieben');
  assert.equal(meldungen()[0].kontext.last_error, 'Datenbank weg');
  m.clock += 60_000;
  P.reportWriteError();
  assert.equal(meldungen().length, 2);
  assert.equal(meldungen()[1].message, 'app_logs: 6 Zeile(n) nicht geschrieben', 'der Rest der Minute in einer Zeile');
});

test('X-Request-Id: only harmless identifiers, otherwise an own one', () => {
  for (const gut of ['ab12', '3f6c1a2e-6e1b-4c55-9a5d-1b2c3d4e5f60', 'proxy.1:2_x'])
    assert.equal(P.requestId(gut), gut);
  for (const boese of ['a\nwarn gefälscht', 'x'.repeat(65), '', 'a b', '"};', ['liste'], undefined]) {
    const k = P.requestId(boese);
    assert.notEqual(k, boese);
    assert.match(k, /^[0-9a-z]{4,}$/, `eigene Kennung statt ${JSON.stringify(boese)}`);
  }
  assert.notEqual(P.requestId(''), P.requestId(''), 'eigene Kennungen zählen weiter');
});
