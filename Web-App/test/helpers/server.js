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

module.exports = { testServer, routerServer, portOf };
