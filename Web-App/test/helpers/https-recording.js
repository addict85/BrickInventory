/**
 * Records with what src/infra/fetch.ts calls https.get and https.request,
 * without going to the network: every request fails immediately with ECONNREFUSED.
 */
const https = require('node:https');
const { EventEmitter } = require('node:events');

/** @returns {Promise<{ kind: 'get' | 'request', options: Record<string, any> }[]>} */
async function recording(/** @type {() => Promise<unknown>} */ run) {
  /** @type {{ kind: 'get' | 'request', options: Record<string, any> }[]} */
  const calls = [];
  const original = { get: https.get, request: https.request };
  const fake = (/** @type {'get' | 'request'} */ kind) => (/** @type {unknown} */ _u, /** @type {any} */ options) => {
    calls.push({ kind, options });
    const req = Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
    setImmediate(() => req.emit('error', Object.assign(new Error('dummy'), { code: 'ECONNREFUSED' })));
    return req;
  };
  Object.assign(https, { get: fake('get'), request: fake('request') });
  try {
    await run();
  } finally {
    Object.assign(https, original);
  }
  return calls;
}

module.exports = { recording };
