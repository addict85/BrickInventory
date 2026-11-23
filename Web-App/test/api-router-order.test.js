/**
 * The routers under /api/v1 (routes/api/index.ts) may hang in any order:
 * no path pattern and no middleware with a path of one router hits a route
 * of another. Checked on the built routers, not on the source text.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in routes/api/setsStorage.ts before the first route additionally
 *      `router.get('/sets/:setNumber', …)` → red “no pattern hits …”
 *   B  in settings.ts `router.use('/settings', requireLogin)` → `router.use('/', requireLogin)`
 *      → red “no middleware with a path …” (hits the routes of all later routers)
 *   C  `router.use(errorResponse)` back in routes/api/parts.ts → red “the error path is attached
 *      by the app, not by a router”; a second `app.use(errorResponse)` in startup/app.ts
 *      → red (2 instead of 1)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('./helpers/sources');

const _req = q.buildAndRequire();

/** Per mounted router: its routes and its middleware with a path, also from subrouters. */
function holding() {
  const api = _req('routes/api/index.js').buildApiRouter(q.testServices());
  /** @param {any} r */
  const collect = (r, aus = { routes: [], prefilters: [] }) => {
    for (const l of r.stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) aus.routes.push({ m, path: l.route.path, l });
      else if (!l.slash) aus.prefilters.push(l);
      else if (l.handle?.stack) collect(l.handle, aus);
    }
    return aus;
  };
  return api.stack.filter((/** @type {any} */ l) => l.handle?.stack).map((/** @type {any} */ l) => collect(l.handle));
}

/** A path as a client sends it: every placeholder a fixed value. @param {string} p */
const beispiel = p => p.replace(/:\w+/g, 'x1');

test('the routers under /api/v1 do not hit each other', () => {
  const router = holding();
  assert.ok(router.length >= 15, `only ${router.length} routers — does the search still match?`);
  assert.ok(router.flatMap(r => r.prefilters).length >= 1, 'no middleware with a path found');
  const muster = [];
  const middleware = [];
  router.forEach((r, i) => {
    for (const fremd of router.filter((_, j) => j !== i))
      for (const ziel of fremd.routes) {
        for (const eigen of r.routes)
          if (eigen.m === ziel.m && eigen.l.match(beispiel(ziel.path)))
            muster.push(`${eigen.m} ${eigen.path} trifft ${ziel.path}`);
        for (const v of r.prefilters)
          if (v.match(beispiel(ziel.path))) middleware.push(`${v.name} vor ${ziel.m} ${ziel.path}`);
      }
  });
  assert.deepEqual(muster, [], 'no pattern matches a route of another router');
  assert.deepEqual(middleware, [], 'no middleware with a path matches a route of another router');
});

test('the app attaches the error path, once behind all routers', () => {
  const { errorResponse } = _req('src/http/httpResponse.js');
  const app = _req('startup/app.js').buildApp({
    pool: q.testAccess().systemPool,
    config: _req('src/infra/config.js').config(),
    sessionSecret: 'test-sitzungsgeheimnis-lang-genug',
    services: q.testServices(),
    sessionStorage: (/** @type {any} */ _q, /** @type {any} */ _r, /** @type {Function} */ n) => n(),
  });
  /** @type {string[]} */
  const inRouters = [];
  /** @param {any} r @param {string} wo */
  const durch = (r, wo) => {
    for (const l of r.stack) {
      if (l.handle?.stack) {
        if (l.handle.stack.some((/** @type {any} */ k) => k.handle === errorResponse)) inRouters.push(wo + l.name);
        durch(l.handle, `${wo + l.name} > `);
      }
    }
  };
  const oben = app.router.stack;
  durch(app.router, '');
  assert.ok(oben.length > 30, `only ${oben.length} layers — does the search still match?`);
  assert.deepEqual(inRouters, [], 'the app attaches the error path, not a router');
  const errorPaths = oben.filter((/** @type {any} */ l) => l.handle === errorResponse);
  assert.equal(errorPaths.length, 1);
  assert.equal(oben.at(-1)?.handle, errorResponse, 'the error path comes after all routers');
});
