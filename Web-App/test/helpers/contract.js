/**
 * The contract of a route from src/contract/, found via the path as
 * the app writes it ({setNumber}); Express names the placeholders :setNumber,
 * and the names may differ ({id} versus :acqId).
 */

/** @param {string} p */
const uniform = p => p.replace(/\{\w+\}|:\w+/g, '{}');

/**
 * @param {(rel: string) => any} _req  buildAndRequire() of the test file
 * @param {string} methode
 * @param {string} path
 * @returns {{ response?: import('zod').ZodType, eingabe?: import('zod').ZodType } | undefined}
 */
function contractTo(_req, methode, path) {
  const { CONTRACT } = _req('src/contract/index.js');
  const treffer = Object.entries(CONTRACT).filter(([k]) => {
    const [m, p] = k.split(' ');
    return m === methode && uniform(p) === uniform(path);
  });
  return treffer.length === 1 ? treffer[0][1] : undefined;
}

/**
 * What the Android app needs from the server (shared/app-schnittstelle.json, generated from its
 * source text): routes with query and body fields, plus the response fields it reads.
 * @returns {{ routen: { methode: string, pfad: string, typ: string | null, abfrage: { name: string, required: boolean }[], rumpf: string | null, rumpffelder: string[] }[], adressen: string[], antwortfelder: string[], modelle: Record<string, { felder: string[], required: string[] }> }}
 */
function appSchnittstelle() {
  const datei = require('node:path').join(__dirname, '..', '..', '..', 'shared', 'app-schnittstelle.json');
  return JSON.parse(require('node:fs').readFileSync(datei, 'utf8'));
}

/**
 * The app's routes with `path` as the v2 address ({x} placeholders kept): the app calls /api/v1,
 * the contract and the routers name /api/v2.
 */
function appRoutes(_req) {
  const { v2PathOf } = _req('src/http/apiV1Alias.js');
  return appSchnittstelle().routen.map(r => {
    const { path, key } = v2PathOf(r.methode, r.pfad);
    // With a contract key the placeholders carry their v2 names ({kind} instead of {art}).
    return { ...r, path: key ? key.split(' ')[1].replace(/:(\w+)/g, '{$1}') : path };
  });
}

/** The app's hand-built addresses (no method known) as v2 addresses. */
function appAddresses(_req) {
  const { v2PathOf } = _req('src/http/apiV1Alias.js');
  return appSchnittstelle().adressen.map(a => (a.startsWith('/api/v1/') ? v2PathOf('GET', a).path : a));
}

module.exports = { contractTo, uniform, appSchnittstelle, appRoutes, appAddresses };
