/**
 * Records with what src/infra/fetch.ts calls https.get and https.request,
 * without going to the network: every request fails immediately with ECONNREFUSED.
 */
const https = require('node:https');
const { EventEmitter } = require('node:events');

/** @returns {Promise<{ kind: 'get' | 'request', options: Record<string, any> }[]>} */
async function recording(/** @type {() => Promise<unknown>} */ lauf) {
  /** @type {{ kind: 'get' | 'request', options: Record<string, any> }[]} */
  const aufrufe = [];
  const echt = { get: https.get, request: https.request };
  const fake = (/** @type {'get' | 'request'} */ kind) => (/** @type {unknown} */ _u, /** @type {any} */ options) => {
    aufrufe.push({ kind, options });
    const req = Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
    setImmediate(() => req.emit('error', Object.assign(new Error('attrappe'), { code: 'ECONNREFUSED' })));
    return req;
  };
  Object.assign(https, { get: fake('get'), request: fake('request') });
  try {
    await lauf();
  } finally {
    Object.assign(https, echt);
  }
  return aufrufe;
}

module.exports = { recording };
