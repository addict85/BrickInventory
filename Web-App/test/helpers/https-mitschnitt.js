/**
 * Schneidet mit, womit src/infra/abruf.ts https.get und https.request ruft,
 * ohne ins Netz zu gehen: Jede Anfrage scheitert sofort mit ECONNREFUSED.
 */
const https = require('node:https');
const { EventEmitter } = require('node:events');

/** @returns {Promise<{ art: 'get' | 'request', optionen: Record<string, any> }[]>} */
async function mitschnitt(/** @type {() => Promise<unknown>} */ lauf) {
  /** @type {{ art: 'get' | 'request', optionen: Record<string, any> }[]} */
  const aufrufe = [];
  const echt = { get: https.get, request: https.request };
  const attrappe =
    (/** @type {'get' | 'request'} */ art) => (/** @type {unknown} */ _u, /** @type {any} */ optionen) => {
      aufrufe.push({ art, optionen });
      const req = Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
      setImmediate(() => req.emit('error', Object.assign(new Error('attrappe'), { code: 'ECONNREFUSED' })));
      return req;
    };
  Object.assign(https, { get: attrappe('get'), request: attrappe('request') });
  try {
    await lauf();
  } finally {
    Object.assign(https, echt);
  }
  return aufrufe;
}

module.exports = { mitschnitt };
