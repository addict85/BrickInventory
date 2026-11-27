/**
 * A server for a test: the app from startup/app.ts (baueApp) with the middleware chain
 * and the routers of production, via the services of this test file. Only the
 * session store is provided; the session checks after it run for real.
 */

/** What express-session offers on a session. regenerate and destroy empty the same
 * object instead of setting a new one: so the test reads afterwards in `session` what the route wrote. */
function asSession(/** @type {Record<string, any>} */ s) {
  const clear = (/** @type {Function} [fertig] */ done) => {
    for (const k of Object.keys(s)) delete s[k];
    done?.();
  };
  const methods = {
    regenerate: clear,
    destroy: clear,
    save: (/** @type {Function} [fertig] */ done) => done?.(),
    reload: (/** @type {Function} [fertig] */ done) => done?.(),
    touch: () => {},
  };
  for (const [k, f] of Object.entries(methods))
    if (typeof s[k] !== 'function') Object.defineProperty(s, k, { value: f, configurable: true, writable: true });
  return s;
}

/**
 * @param {(path: string) => any} _req  buildAndRequire() of the test file
 * @param {object} o
 * @param {object} [o.session]  is provided as `req.session`
 * @param {{ after: Function }} [o.t]  The test context. If present, the server closes
 *                                itself in the TEARDOWN — even if an assertion fails before.
 */
function testServer(_req, { session = {}, t } = {}) {
  const { testAccess, testServices } = require('./sources');
  const posed = asSession(session);
  const app = _req('startup/app.js').buildApp({
    pool: testAccess().systemWebPool,
    config: _req('src/infra/config.js').config(),
    sessionSecret: 'test-sitzungsgeheimnis-lang-genug',
    services: testServices(),
    sessionStorage: (/** @type {any} */ req, /** @type {any} */ _res, /** @type {Function} */ next) => {
      req.session = posed;
      next();
    },
  });
  const srv = app.listen(0);
  const close = () => new Promise(r => srv.close(r));
  if (t && typeof t.after === 'function') t.after(close);
  return { app, srv, base: `http://localhost:${portOf(srv)}`, close };
}

/**
 * Substitute path from the time before baueApp: own routers behind express.json(), without session
 * and administrator checks. Only for files not yet converted to testServer;
 * their number may only sink (test/ratschen.test.js).
 * @param {(path: string) => any} _req
 * @param {{ session?: object, apiAccount?: object, routes: Record<string, string>, t?: { after: Function } }} o
 */
function routerServer(_req, { session = {}, apiAccount, routes, t }) {
  const express = require('express');
  const app = express();
  // As in buildApp: /api/v1 is the alias of /api/v2, the routers hang under /api/v2.
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use(express.json());
  app.use((/** @type {any} */ req, /** @type {any} */ _res, /** @type {Function} */ next) => {
    req.session = session;
    if (apiAccount !== undefined) req.apiUser = apiAccount;
    next();
  });
  app.use(_req('src/http/rememberAccount.js').rememberRequest);
  for (const [path, mod] of Object.entries(routes))
    app.use(path.replace(/^\/api\/v1(?=\/|$)/, '/api/v2'), require('./sources').routerFrom(_req, mod));
  const srv = app.listen(0);
  const close = () => new Promise(r => srv.close(r));
  if (t && typeof t.after === 'function') t.after(close);
  return { app, srv, base: `http://localhost:${portOf(srv)}`, close };
}

/** The port of a listening server (net, http, https): address() is an AddressInfo only afterwards.
 * @param {{ address(): string | import('node:net').AddressInfo | null }} srv @returns {number} */
function portOf(srv) {
  const a = srv.address();
  if (!a || typeof a === 'string') throw new Error('Server is not listening on a TCP port');
  return a.port;
}

/** A port that was free a moment ago; only until someone else binds it. @returns {Promise<number>} */
function freePort() {
  const net = require('node:net');
  return new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });
}

/**
 * dist/server.js as its own process. The free port can be taken by a parallel file before the
 * child binds it; the child then logs EADDRINUSE and stays up without a port, and every request
 * reaches the other file's server and database (401 credentials_invalid). So it waits for its
 * own listen line and on EADDRINUSE starts again on a new port.
 * @param {{ after: Function }} t @param {Record<string, string>} env
 */
async function realServer(t, env, port = freePort) {
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const { until } = require('./time');
  for (let attempt = 1; ; attempt++) {
    const at = await port();
    const p = spawn(process.execPath, [path.join(__dirname, '..', '..', 'dist', 'server.js')], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, PORT: String(at) },
    });
    let log = '';
    p.stdout.on('data', d => (log += d));
    p.stderr.on('data', d => (log += d));
    const gone = () => p.exitCode !== null || p.signalCode !== null;
    t.after(async () => {
      p.kill('SIGTERM');
      if (!(await until(gone, 4000))) p.kill('SIGKILL');
    });
    await until(() => gone() || /EADDRINUSE/.test(log) || log.includes(`localhost:${at}`), 60_000);
    if (!/EADDRINUSE/.test(log) || attempt >= 4) return { port: at, base: `http://127.0.0.1:${at}`, log: () => log };
    p.kill('SIGKILL');
  }
}

module.exports = { testServer, routerServer, portOf, freePort, realServer };
