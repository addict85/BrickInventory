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
 * @returns {{ routen: { methode: string, path: string, typ: string | null, abfrage: { name: string, required: boolean }[], rumpf: string | null, rumpffelder: string[] }[], adressen: string[], antwortfelder: string[], modelle: Record<string, { felder: string[], required: string[] }> }}
 */
function appSchnittstelle() {
  const datei = require('node:path').join(__dirname, '..', '..', '..', 'shared', 'app-schnittstelle.json');
  return JSON.parse(require('node:fs').readFileSync(datei, 'utf8'));
}

module.exports = { contractTo, uniform, appSchnittstelle };
