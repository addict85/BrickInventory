/**
 * A closed event stream aborts the work behind it with an error class,
 * not with a string that the catcher would have to compare.
 *
 * Counter-checks (measured 14.11.2026, each on its own, reverted):
 *   A  in sendOrAbort (src/account/http/stream.ts) again `throw new Error('CANCELLED')`
 *      → red: “after closing sendOrAbort aborts with StreamClosed”
 *   B  the check `if (zu)` deleted there → red: the same assertion (nothing thrown)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const _req = require('./helpers/sources').buildAndRequire();
const { openStream, StreamClosed } = _req('src/account/http/stream.js');

function fake() {
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

test('after closing sendOrAbort aborts with StreamClosed', () => {
  const { req, res } = fake();
  const strom = openStream({}, req, res, { heartbeat: false });
  strom.sendOrAbort({ step: 'a' });
  assert.equal(res.geschrieben.length, 1, 'offen geht das Ereignis hinaus');
  req.emit('close');
  assert.equal(strom.zu, true);
  assert.throws(
    () => strom.sendOrAbort({ step: 'b' }),
    e => e instanceof StreamClosed,
  );
  assert.equal(res.geschrieben.length, 1, 'nach dem Schliessen geht nichts mehr hinaus');
});
