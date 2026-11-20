/**
 * Ein Router je Pfad, jede Route genau einmal.
 *
 * Geprüft werden die gebauten Router selbst (Express-Stapel), nicht ihr
 * Quelltext: Die Einhängepunkte kommen aus server.ts, die Routen aus den
 * geladenen Modulen.
 *
 * Gegenproben (31.10.2026):
 *   • ein zweiter Router unter /api/v1/auth in server.ts
 *     (`app.use('/api/v1/auth', zertifikatRouter)`) → „ein Router je Einhängepunkt" rot.
 *   • `router.get('/settings/theme', …)` ein zweites Mal in
 *     routes/api_v1/settings.ts → „jede Route genau einmal" rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAndRequire, ROOT, routerEinhaengungen, ohneKommentare } = require('./helpers/sources');

const _req = buildAndRequire();

/** Alle Routen eines Routers als „METHODE /pfad", samt eingehängter Unterrouter. */
function routen(router, praefix = '') {
  const raus = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods).filter(m => m !== '_all'))
        raus.push(`${m.toUpperCase()} ${praefix}${layer.route.path === '/' ? '' : layer.route.path}`);
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      // Ein Unterrouter mit eigenem Pfad liesse sich hier nicht auflösen.
      assert.ok(layer.slash, `Unterrouter mit eigenem Pfad unter ${praefix || '/'} — bitte ohne Pfad einhängen`);
      raus.push(...routen(layer.handle, praefix));
    }
  }
  return raus;
}

/** Router-Einhängungen in startup/app.ts: Pfad → Router-Modul. */
function einhaengungen() {
  const v1 = { mount: '/api/v1', datei: path.join(ROOT, 'routes/api_v1/index.ts'), name: 'api_v1/index' };
  // Die Teile von routes/auth.ts stecken schon in dessen Stapel.
  return [v1, ...routerEinhaengungen({ withoutParts: true })];
}

test('one router per mount point', () => {
  const server = ohneKommentare(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
  // Router heissen in startup/app.ts `…Router`; Middleware (loginAtInbox) darf daneben stehen.
  const je = new Map();
  for (const m of server.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(\w+Router)(?:\(d\))?\s*\)/g))
    je.set(m[1], [...(je.get(m[1]) || []), m[2]]);
  assert.ok(je.size >= 2, `nur ${je.size} Router-Einhängungen in startup/app.ts gefunden`);
  // Gesundheit und Startstatus antworten VOR dem Eingang (loginAtInbox),
  // der Router der API dahinter: zwei Stellen im Stapel, deshalb zwei Router.
  const BEFORE_THE_INBOX = new Set(['buildGesundheitRouter']);
  const doppelt = [...je]
    .map(([p, r]) => [p, r.filter(n => !BEFORE_THE_INBOX.has(n))])
    .filter(([, r]) => r.length > 1)
    .map(([p, r]) => `${p}: ${r.join(', ')}`);
  assert.deepEqual(doppelt, []);
});

test('every route exactly once', () => {
  const alle = [];
  for (const e of einhaengungen()) {
    const modul = require('./helpers/sources').routerFrom(_req, path.relative(ROOT, e.datei).replace(/\.ts$/, '.js'));
    alle.push(...routen(modul.default || modul, e.mount));
  }
  assert.ok(alle.length > 150, `nur ${alle.length} Routen gefunden — greift die Suche noch?`);
  assert.ok(
    alle.includes('GET /api/v1/settings/theme') && alle.includes('GET /api/v1/settings'),
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
