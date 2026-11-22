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
const { buildAndRequire, ROOT, routerMounts, ohneKommentare } = require('./helpers/sources');

const _req = buildAndRequire();

/** All routes of a router as „METHOD /path", including mounted subrouters. */
function routen(router, praefix = '') {
  const raus = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods).filter(m => m !== '_all'))
        raus.push(`${m.toUpperCase()} ${praefix}${layer.route.path === '/' ? '' : layer.route.path}`);
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      // A subrouter with its own path could not be resolved here.
      assert.ok(layer.slash, `Unterrouter mit eigenem Pfad unter ${praefix || '/'} — bitte ohne Pfad einhängen`);
      raus.push(...routen(layer.handle, praefix));
    }
  }
  return raus;
}

/** Router mounts in startup/app.ts: path → router module. */
function mountings() {
  const v1 = { mount: '/api/v2', datei: path.join(ROOT, 'routes/api/index.ts'), name: 'api/index' };
  // The parts of routes/auth.ts are already in its stack.
  return [v1, ...routerMounts({ withoutParts: true })];
}

test('one router per mount point', () => {
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
  // Routers are called `…Router` in startup/app.ts; middleware (loginAtInbox) may stand next to them.
  const je = new Map();
  for (const m of server.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(\w+Router)(?:\(d\))?\s*\)/g))
    je.set(m[1], [...(je.get(m[1]) || []), m[2]]);
  assert.ok(je.size >= 2, `nur ${je.size} Router-Einhängungen in startup/app.ts gefunden`);
  // Health and start status answer BEFORE the entrance (loginAtInbox),
  // the router of the API behind it: two places in the stack, hence two routers.
  const BEFORE_THE_INBOX = new Set(['buildGesundheitRouter']);
  const doppelt = [...je]
    .map(([p, r]) => [p, r.filter(n => !BEFORE_THE_INBOX.has(n))])
    .filter(([, r]) => r.length > 1)
    .map(([p, r]) => `${p}: ${r.join(', ')}`);
  assert.deepEqual(doppelt, []);
});

test('every route exactly once', () => {
  const alle = [];
  for (const e of mountings()) {
    const modul = require('./helpers/sources').routerFrom(_req, path.relative(ROOT, e.datei).replace(/\.ts$/, '.js'));
    alle.push(...routen(modul.default || modul, e.mount));
  }
  assert.ok(alle.length > 150, `nur ${alle.length} Routen gefunden — greift die Suche noch?`);
  assert.ok(
    alle.includes('GET /api/v2/settings/theme') && alle.includes('GET /api/v2/settings'),
    'die Einstellungen fehlen in der Liste',
  );
  const gesehen = new Set(),
    doppelt = [];
  for (const r of alle) {
    if (gesehen.has(r)) doppelt.push(r);
    gesehen.add(r);
  }
  assert.deepEqual(doppelt, []);
});
