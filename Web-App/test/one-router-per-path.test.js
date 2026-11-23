/**
 * One router per path, every route exactly once.
 *
 * What is checked are the built routers themselves (Express stack), not their
 * source text: the mount points come from server.ts, the routes from the
 * loaded modules.
 *
 * Counter-checks (31.10.2026):
 *   • a second router under /api/v2/auth in server.ts
 *     (`app.use('/api/v2/auth', zertifikatRouter)`) → “one router per mount point” red.
 *   • `router.get('/settings/theme', …)` a second time in
 *     routes/api/settings.ts → “every route exactly once” red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAndRequire, ROOT, routerMounts, withoutComments } = require('./helpers/sources');

const _req = buildAndRequire();

/** All routes of a router as „METHOD /path", including mounted subrouters. */
function routes(router, prefix = '') {
  const result = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods).filter(m => m !== '_all'))
        result.push(`${m.toUpperCase()} ${prefix}${layer.route.path === '/' ? '' : layer.route.path}`);
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      // A subrouter with its own path could not be resolved here.
      assert.ok(layer.slash, `Sub-router with its own path under ${prefix || '/'} — please mount it without a path`);
      result.push(...routes(layer.handle, prefix));
    }
  }
  return result;
}

/** Router mounts in startup/app.ts: path → router module. */
function mountings() {
  const v1 = { mount: '/api/v2', file: path.join(ROOT, 'routes/api/index.ts'), name: 'api/index' };
  // The parts of routes/auth.ts are already in its stack.
  return [v1, ...routerMounts({ withoutParts: true })];
}

test('one router per mount point', () => {
  const server = withoutComments(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
  // Routers are called `…Router` in startup/app.ts; middleware (loginAtInbox) may stand next to them.
  const per = new Map();
  for (const m of server.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(\w+Router)(?:\(d\))?\s*\)/g))
    per.set(m[1], [...(per.get(m[1]) || []), m[2]]);
  assert.ok(per.size >= 2, `only ${per.size} router mounts found in startup/app.ts`);
  // Health and start status answer BEFORE the entrance (loginAtInbox),
  // the router of the API behind it: two places in the stack, hence two routers.
  const BEFORE_THE_INBOX = new Set(['buildHealthRouter']);
  const twice = [...per]
    .map(([p, r]) => [p, r.filter(n => !BEFORE_THE_INBOX.has(n))])
    .filter(([, r]) => r.length > 1)
    .map(([p, r]) => `${p}: ${r.join(', ')}`);
  assert.deepEqual(twice, []);
});

test('every route exactly once', () => {
  const all = [];
  for (const e of mountings()) {
    const mod = require('./helpers/sources').routerFrom(_req, path.relative(ROOT, e.file).replace(/\.ts$/, '.js'));
    all.push(...routes(mod.default || mod, e.mount));
  }
  assert.ok(all.length > 150, `only ${all.length} routes found — does the search still work?`);
  assert.ok(
    all.includes('GET /api/v2/settings/theme') && all.includes('GET /api/v2/settings'),
    'the settings are missing from the list',
  );
  const seen = new Set(),
    twice = [];
  for (const r of all) {
    if (seen.has(r)) twice.push(r);
    seen.add(r);
  }
  assert.deepEqual(twice, []);
});
