/**
 * Die Router unter /api/v1 (routes/api_v1/index.ts) dürfen in beliebiger Reihenfolge
 * hängen: Kein Pfad-Muster und keine Middleware mit Pfad eines Routers trifft eine Route
 * eines anderen. Geprüft an den gebauten Routern, nicht am Quelltext.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  in routes/api_v1/setsLager.ts vor der ersten Route zusätzlich
 *      `router.get('/sets/:setNumber', …)` → rot „kein Muster trifft …“
 *   B  in settings.ts `router.use('/settings', requireLogin)` → `router.use('/', requireLogin)`
 *      → rot „keine Middleware mit Pfad …“ (trifft die Routen aller späteren Router)
 *   C  `router.use(fehlerAntwort)` zurück in routes/api_v1/parts.ts → rot „den Fehlerweg hängt
 *      die App an, kein Router“; ein zweites `app.use(fehlerAntwort)` in startup/app.ts
 *      → rot (2 statt 1)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('./helpers/sources');

const _req = q.buildAndRequire();

/** Je eingehängtem Router: seine Routen und seine Middleware mit Pfad, auch aus Unterroutern. */
function bestand() {
  const api = _req('routes/api_v1/index.js').baueApiRouter(q.testDienste());
  /** @param {any} r */
  const sammle = (r, aus = { routen: [], vorschaltungen: [] }) => {
    for (const l of r.stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) aus.routen.push({ m, pfad: l.route.path, l });
      else if (!l.slash) aus.vorschaltungen.push(l);
      else if (l.handle?.stack) sammle(l.handle, aus);
    }
    return aus;
  };
  return api.stack.filter((/** @type {any} */ l) => l.handle?.stack).map((/** @type {any} */ l) => sammle(l.handle));
}

/** Ein Pfad, wie ihn ein Client schickt: jeder Platzhalter ein fester Wert. @param {string} p */
const beispiel = p => p.replace(/:\w+/g, 'x1');

test('die Router unter /api/v1 treffen einander nicht', () => {
  const router = bestand();
  assert.ok(router.length >= 15, `nur ${router.length} Router — greift die Suche noch?`);
  assert.ok(router.flatMap(r => r.vorschaltungen).length >= 1, 'keine Middleware mit Pfad gefunden');
  const muster = [];
  const middleware = [];
  router.forEach((r, i) => {
    for (const fremd of router.filter((_, j) => j !== i))
      for (const ziel of fremd.routen) {
        for (const eigen of r.routen)
          if (eigen.m === ziel.m && eigen.l.match(beispiel(ziel.pfad)))
            muster.push(`${eigen.m} ${eigen.pfad} trifft ${ziel.pfad}`);
        for (const v of r.vorschaltungen)
          if (v.match(beispiel(ziel.pfad))) middleware.push(`${v.name} vor ${ziel.m} ${ziel.pfad}`);
      }
  });
  assert.deepEqual(muster, [], 'kein Muster trifft eine Route eines anderen Routers');
  assert.deepEqual(middleware, [], 'keine Middleware mit Pfad trifft eine Route eines anderen Routers');
});

test('den Fehlerweg hängt die App an, einmal hinter allen Routern', () => {
  const { fehlerAntwort } = _req('src/http/httpAntwort.js');
  const app = _req('startup/app.js').baueApp({
    pool: q.testZugang().systemPool,
    konfig: _req('src/infra/konfig.js').konfig(),
    sitzungsGeheimnis: 'test-sitzungsgeheimnis-lang-genug',
    dienste: q.testDienste(),
    sitzungsSpeicher: (/** @type {any} */ _q, /** @type {any} */ _r, /** @type {Function} */ n) => n(),
  });
  /** @type {string[]} */
  const inRoutern = [];
  /** @param {any} r @param {string} wo */
  const durch = (r, wo) => {
    for (const l of r.stack) {
      if (l.handle?.stack) {
        if (l.handle.stack.some((/** @type {any} */ k) => k.handle === fehlerAntwort)) inRoutern.push(wo + l.name);
        durch(l.handle, `${wo + l.name} > `);
      }
    }
  };
  const oben = app.router.stack;
  durch(app.router, '');
  assert.ok(oben.length > 30, `nur ${oben.length} Schichten — greift die Suche noch?`);
  assert.deepEqual(inRoutern, [], 'den Fehlerweg hängt die App an, kein Router');
  const fehlerwege = oben.filter((/** @type {any} */ l) => l.handle === fehlerAntwort);
  assert.equal(fehlerwege.length, 1);
  assert.equal(oben.at(-1)?.handle, fehlerAntwort, 'der Fehlerweg steht hinter allen Routern');
});
