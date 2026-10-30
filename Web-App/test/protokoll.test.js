/**
 * Das Serverprotokoll (utils/protokoll.ts): JSON-Zeilen auf stdout/stderr,
 * daneben app_logs im bisherigen Textformat; Schreibfehler werden gezählt und
 * höchstens einmal je Minute gemeldet statt verschluckt.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in leereProtokoll() den Fehlerzweig wieder `() => {}` → rot:
 *      „Schreibfehler: sofort, dann je Minute gesammelt“ (keine Meldung)
 *   B  in schreibfehler() die Minutenregel entfernt (immer sofort melden) →
 *      rot: dieselbe Prüfung (drei Meldungen statt einer)
 *   C  in jsonZeile() die Anfragekennung weggelassen → rot: „eine Zeile ist
 *      JSON mit Zeit, Stufe, Nachricht, Anfrage und Kontext“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const P = _req('utils/protokoll.js');

/** Eine Ausgabe zum Mitlesen, mit stellbarer Uhr. */
function mitschrift() {
  const m = { out: [], err: [], uhr: Date.parse('2026-10-30T12:00:00Z') };
  return { m, ausgabe: { out: (z) => m.out.push(z), err: (z) => m.err.push(z), jetzt: () => m.uhr } };
}

test('eine Zeile ist JSON mit Zeit, Stufe, Nachricht, Anfrage und Kontext', (t) => {
  const { m, ausgabe } = mitschrift();
  t.after(P.installiereProtokoll(ausgabe));
  P.anfrageKontext.run({ rid: 'ab12' }, () => console.warn('Preis fehlt für', '10294-1', { zustand: 'N' }));
  console.log('ohne Anfrage');
  console.error('kaputt', new Error('Verbindung weg'));
  assert.equal(m.err.length, 2);
  const warn = JSON.parse(m.err[0]);
  assert.deepEqual({ ...warn, pid: 0 }, { zeit: '2026-10-30T12:00:00.000Z', stufe: 'warn',
    nachricht: 'Preis fehlt für 10294-1', pid: 0, rid: 'ab12', kontext: { zustand: 'N' } });
  assert.equal(warn.pid, process.pid);
  const info = JSON.parse(m.out[0]);
  assert.equal(info.stufe, 'info');
  assert.equal(info.rid, undefined);
  const fehler = JSON.parse(m.err[1]);
  assert.equal(fehler.nachricht, 'kaputt Verbindung weg');
  assert.equal(fehler.kontext.fehler.message, 'Verbindung weg');
  assert.match(fehler.kontext.fehler.stack, /protokoll\.test\.js/);
});

test('app_logs bekommt die Zeilen im bisherigen Textformat', async (t) => {
  const { ausgabe } = mitschrift();
  t.after(P.installiereProtokoll(ausgabe));
  const geschrieben = [];
  P.protokollInDieDatenbank({ query: async (sql, werte) => { if (sql.startsWith('INSERT')) geschrieben.push(werte); } });
  P.anfrageKontext.run({ rid: 'cd34' }, () => console.info('Set angelegt', { set: '42115-1' }));
  await P.leereProtokoll();
  assert.equal(geschrieben.length, 1);
  assert.equal(geschrieben[0][0], 'info');
  assert.match(geschrieben[0][1], /^\[\d{1,4}\/cd34\] Set angelegt \{"set":"42115-1"\}$/);
});

test('Schreibfehler: sofort, dann je Minute gesammelt', async (t) => {
  const { m, ausgabe } = mitschrift();
  t.after(P.installiereProtokoll(ausgabe));
  P.protokollInDieDatenbank({ query: async () => { throw new Error('Datenbank weg'); } });
  const zeile = async (n) => { for (let i = 0; i < n; i++) console.log('Zeile', i); await P.leereProtokoll(); };
  await zeile(3);
  m.uhr += 10_000; await zeile(2);
  m.uhr += 10_000; await zeile(4);
  const meldungen = () => m.err.map(z => JSON.parse(z)).filter(z => z.nachricht.startsWith('app_logs:'));
  assert.equal(meldungen().length, 1, 'innerhalb der Minute nur die erste Meldung');
  assert.equal(meldungen()[0].nachricht, 'app_logs: 3 Zeile(n) nicht geschrieben');
  assert.equal(meldungen()[0].kontext.letzter_fehler, 'Datenbank weg');
  m.uhr += 60_000; P.meldeSchreibfehler();
  assert.equal(meldungen().length, 2);
  assert.equal(meldungen()[1].nachricht, 'app_logs: 6 Zeile(n) nicht geschrieben', 'der Rest der Minute in einer Zeile');
});
