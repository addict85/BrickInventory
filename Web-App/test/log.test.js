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
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const P = _req('src/infra/log.js');

/** An output to read along, with an adjustable clock. */
function transcript() {
  const m = { out: [], err: [], uhr: Date.parse('2026-10-30T12:00:00Z') };
  return { m, output: { out: z => m.out.push(z), err: z => m.err.push(z), jetzt: () => m.uhr } };
}

test('a line is JSON with time, level, message, request and context', t => {
  const { m, output } = transcript();
  t.after(P.installLog(output));
  P.requestContext.run({ rid: 'ab12' }, () => console.warn('Preis fehlt für', '10294-1', { zustand: 'N' }));
  console.log('ohne Anfrage');
  console.error('kaputt', new Error('Verbindung weg'));
  assert.equal(m.err.length, 2);
  const warn = JSON.parse(m.err[0]);
  assert.deepEqual(
    { ...warn, pid: 0 },
    {
      zeit: '2026-10-30T12:00:00.000Z',
      stufe: 'warn',
      nachricht: 'Preis fehlt für 10294-1',
      pid: 0,
      rid: 'ab12',
      kontext: { zustand: 'N' },
    },
  );
  assert.equal(warn.pid, process.pid);
  const info = JSON.parse(m.out[0]);
  assert.equal(info.stufe, 'info');
  assert.equal(info.rid, undefined);
  const fehler = JSON.parse(m.err[1]);
  assert.equal(fehler.nachricht, 'kaputt Verbindung weg');
  assert.equal(fehler.kontext.fehler.message, 'Verbindung weg');
  assert.match(fehler.kontext.fehler.stack, /log\.test\.js/);
});

test('app_logs gets the lines in the previous text format', async t => {
  const { output } = transcript();
  t.after(P.installLog(output));
  const geschrieben = [];
  P.logInDieDatabase({
    query: async (sql, werte) => {
      if (sql.startsWith('INSERT')) geschrieben.push(werte);
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
  P.logInDieDatabase({
    query: async () => {
      throw new Error('Datenbank weg');
    },
  });
  const zeile = async n => {
    for (let i = 0; i < n; i++) console.log('Zeile', i);
    await P.emptyLog();
  };
  await zeile(3);
  m.uhr += 10_000;
  await zeile(2);
  m.uhr += 10_000;
  await zeile(4);
  const meldungen = () => m.err.map(z => JSON.parse(z)).filter(z => z.nachricht.startsWith('app_logs:'));
  assert.equal(meldungen().length, 1, 'innerhalb der Minute nur die erste Meldung');
  assert.equal(meldungen()[0].nachricht, 'app_logs: 3 Zeile(n) nicht geschrieben');
  assert.equal(meldungen()[0].kontext.last_error, 'Datenbank weg');
  m.uhr += 60_000;
  P.reportWriteError();
  assert.equal(meldungen().length, 2);
  assert.equal(
    meldungen()[1].nachricht,
    'app_logs: 6 Zeile(n) nicht geschrieben',
    'der Rest der Minute in einer Zeile',
  );
});

test('X-Request-Id: only harmless identifiers, otherwise an own one', () => {
  for (const gut of ['ab12', '3f6c1a2e-6e1b-4c55-9a5d-1b2c3d4e5f60', 'proxy.1:2_x'])
    assert.equal(P.anfrageKennung(gut), gut);
  for (const boese of ['a\nwarn gefälscht', 'x'.repeat(65), '', 'a b', '"};', ['liste'], undefined]) {
    const k = P.anfrageKennung(boese);
    assert.notEqual(k, boese);
    assert.match(k, /^[0-9a-z]{4,}$/, `eigene Kennung statt ${JSON.stringify(boese)}`);
  }
  assert.notEqual(P.anfrageKennung(''), P.anfrageKennung(''), 'eigene Kennungen zählen weiter');
});
