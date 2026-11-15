/**
 * Ein geschlossener Ereignisstrom bricht die Arbeit dahinter mit einer Fehlerklasse ab,
 * nicht mit einer Zeichenkette, die der Fänger vergleichen müsste.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  in sendeOderBrichAb (src/konto/http/strom.ts) wieder `throw new Error('CANCELLED')`
 *      → rot: „nach dem Schliessen bricht sendeOderBrichAb mit StromGeschlossen ab“
 *   B  die Prüfung `if (zu)` dort gestrichen → rot: dieselbe Zusicherung (nichts geworfen)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const _req = require('./helpers/sources').buildAndRequire();
const { oeffneStrom, StromGeschlossen } = _req('src/konto/http/strom.js');

function attrappe() {
  const req = Object.assign(new EventEmitter(), { session: {}, headers: {} });
  /** @type {string[]} */
  const geschrieben = [];
  const res = Object.assign(new EventEmitter(), {
    geschrieben,
    writableEnded: false,
    setHeader: () => {},
    write: (/** @type {string} */ t) => geschrieben.push(t) > 0,
    end: () => {
      res.writableEnded = true;
    },
  });
  return { req, res };
}

test('nach dem Schliessen bricht sendeOderBrichAb mit StromGeschlossen ab', () => {
  const { req, res } = attrappe();
  const strom = oeffneStrom({}, req, res, { herzschlag: false });
  strom.sendeOderBrichAb({ step: 'a' });
  assert.equal(res.geschrieben.length, 1, 'offen geht das Ereignis hinaus');
  req.emit('close');
  assert.equal(strom.zu, true);
  assert.throws(
    () => strom.sendeOderBrichAb({ step: 'b' }),
    e => e instanceof StromGeschlossen,
  );
  assert.equal(res.geschrieben.length, 1, 'nach dem Schliessen geht nichts mehr hinaus');
});
