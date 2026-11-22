/**
 * The contract of a route from src/contract/, found via the path as
 * the app writes it ({setNumber}); Express names the placeholders :setNumber,
 * and the names may differ ({id} versus :acqId).
 */

/** @param {string} p */
const uniform = p => p.replace(/\{\w+\}|:\w+/g, '{}');

/**
 * @param {(rel: string) => any} _req  buildAndRequire() of the test file
 * @param {string} method
 * @param {string} path
 * @returns {{ response?: import('zod').ZodType, eingabe?: import('zod').ZodType } | undefined}
 */
function contractTo(_req, method, path) {
  const { CONTRACT } = _req('src/contract/index.js');
  const treffer = Object.entries(CONTRACT).filter(([k]) => {
    const [m, p] = k.split(' ');
    return m === method && uniform(p) === uniform(path);
  });
  return treffer.length === 1 ? treffer[0][1] : undefined;
}

/**
 * What the Android app needs from the server (shared/app-interface.json, generated from its
 * source text): routes with query and body fields, plus the response fields it reads.
 * @returns {{ routes: { method: string, path: string, type: string | null, query: { name: string, required: boolean }[], body: string | null, body_fields: string[] }[], addresses: string[], without_token: string[], response_fields: string[], models: Record<string, { fields: string[], required: string[] }> }}
 */
function appInterface() {
  const file = require('node:path').join(__dirname, '..', '..', '..', 'shared', 'app-interface.json');
  return JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
}

/**
 * The app's routes; `path` with the placeholder names of the contract key ({id} instead of
 * {acqId}), so that a route compares with the routers by its text.
 */
function appRoutes(_req) {
  const { CONTRACT } = _req('src/contract/index.js');
  const keys = Object.keys(CONTRACT);
  return appInterface().routes.map(r => {
    const key = keys.find(k => k.split(' ')[0] === r.method && uniform(k.split(' ')[1] ?? '') === uniform(r.path));
    return { ...r, path: key ? (key.split(' ')[1] ?? '').replace(/:(\w+)/g, '{$1}') : r.path };
  });
}

/** The app's hand-built addresses (no method known). */
const appAddresses = () => appInterface().addresses;

module.exports = { contractTo, uniform, appInterface, appRoutes, appAddresses };
