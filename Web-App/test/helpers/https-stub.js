/**
 * A local HTTPS server in place of the services the clients call (Rebrickable, BrickLink,
 * Brickset, ECB …). https.get and https.request — the only exits of src/infra/fetch.ts — are
 * pointed at 127.0.0.1 for the duration of a test; host, path, headers and TLS stay as the client
 * sends them, so fetch.ts and the clients run unchanged. Nothing leaves the machine.
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, '..', 'fixtures');
const key = fs.readFileSync(path.join(FIX, 'fetch-test.key'));
const cert = fs.readFileSync(path.join(FIX, 'fetch-test.crt'));

/** A fixture under test/fixtures/clients/, as text or (binary) as Buffer. */
const fixture = (/** @type {string} */ name, binary = false) =>
  fs.readFileSync(path.join(FIX, 'clients', name), binary ? undefined : 'utf8');

/**
 * @typedef {{ host: string, method: string, path: string, headers: Record<string, any>, body: string }} Call
 * @param {{ after: (f: () => unknown) => void }} t
 * @param {(call: Call, res: import('node:http').ServerResponse) => void} route  answers a call;
 *        a route that never answers simulates a hanging service
 */
async function httpsStub(t, route) {
  /** @type {Call[]} */
  const calls = [];
  /** @type {((c: Call) => void)[]} */
  const waiting = [];
  const server = https.createServer({ key, cert }, (req, res) => {
    const call = {
      host: String(req.headers.host ?? '').replace(/:\d+$/, ''),
      method: String(req.method),
      path: String(req.url),
      headers: req.headers,
      body: '',
    };
    req.on('data', d => {
      call.body += d;
    });
    req.on('end', () => {
      calls.push(call);
      for (const w of waiting.splice(0)) w(call);
      route(call, res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const local = (/** @type {string} */ _h, /** @type {any} */ o, /** @type {Function} */ cb) =>
    o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4);
  const real = { get: https.get, request: https.request };
  const redirect =
    (/** @type {Function} */ f) =>
    (/** @type {unknown} */ url, /** @type {Record<string, unknown>} */ o, /** @type {Function} */ cb) =>
      f(url, { ...o, agent: undefined, port, lookup: local, ca: cert, checkServerIdentity: () => undefined }, cb);
  Object.assign(https, { get: redirect(real.get), request: redirect(real.request) });
  t.after(
    () =>
      new Promise(r => {
        Object.assign(https, real);
        server.closeAllConnections();
        server.close(() => r(undefined));
      }),
  );
  return {
    calls,
    /** The next call that reaches the server. @returns {Promise<Call>} */
    nextCall: () => new Promise(r => waiting.push(r)),
  };
}

/** Answers with status, body and headers. */
function reply(
  /** @type {import('node:http').ServerResponse} */ res,
  /** @type {number} */ status,
  /** @type {string | Buffer | object} */ body = '',
  /** @type {Record<string, string>} */ headers = {},
) {
  const isObject = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, isObject ? { 'content-type': 'application/json', ...headers } : headers);
  res.end(isObject ? JSON.stringify(body) : body);
}

/**
 * What a client gets from the application (clients/access.ts), as a recording without a
 * database: keys, quota, throttle and the Brickset resubmission.
 * @param {{ keys?: Record<string, string>, allowed?: boolean, queued?: boolean }} [o]
 */
function clientsAccess(o = {}) {
  const keys = {
    rebrickable_api_key: 'rb-key',
    brickset_api_key: 'bs-key',
    bricklink_consumer_key: 'ck',
    bricklink_consumer_secret: 'cs',
    bricklink_token: 'tk',
    bricklink_token_secret: 'ts',
    ...o.keys,
  };
  const seen = {
    /** @type {string[]} */ counted: [],
    /** @type {number[]} */ throttled: [],
    /** @type {{ setNumber: string, error: string, soon: boolean }[]} */ reserved: [],
    /** @type {string[]} */ forgotten: [],
  };
  const throttle = { waitForSlot: async () => {}, throttle: (/** @type {number} */ ms) => seen.throttled.push(ms) };
  return {
    seen,
    key: async (/** @type {string} */ n) => /** @type {Record<string, string>} */ (keys)[n] ?? '',
    count: async (/** @type {string} */ api) => {
      seen.counted.push(api);
      return { allowed: o.allowed ?? true, count: 7, limit: 100 };
    },
    quotaStatus: async () => ({ count: 100, limit: 100, remaining: 0 }),
    throttle: { foreground: throttle, background: throttle },
    bricksetReserve: async (
      /** @type {string} */ setNumber,
      /** @type {string} */ error,
      /** @type {boolean} */ soon,
    ) => {
      seen.reserved.push({ setNumber, error, soon });
      return { attempt: 1, queued: o.queued ?? true, atMost: 3 };
    },
    bricksetForgotten: async (/** @type {string} */ setNumber) => {
      seen.forgotten.push(setNumber);
    },
  };
}

module.exports = { httpsStub, reply, fixture, clientsAccess };
