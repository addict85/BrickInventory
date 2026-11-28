/**
 * The app's routes against the server's contract (src/contract/, as JSON schema as in
 * docs/openapi-v2.json). The Kotlin types themselves are generated from the contract
 * (contract-kotlin-dtos.test.js checks that the files are up to date); what remains here is that every
 * route of the app reads and sends exactly the generated type of its schema.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in the contract the route GET /api/v2/parts/stats renamed → red: “every route of the app
 *      has a contract”
 *   B  in SetsApi.kt getSetDetail with Response<SetsResponse> instead of SetResponse → red:
 *      “the app reads every response with the generated type of its schema”
 *   C  in AccountApi.kt login with @Body QrLoginRequest → red: “every body of the app is the
 *      generated body of its route”
 *   D  in contract-kotlin-mapping.js ANFRAGEN an invented route added → red: “every
 *      body of the app is the generated body of its route” (dead body)
 *   E  (05.11.2026) in the contract the query of GET /api/v2/sets without `page_size` → red:
 *      “every query parameter of the app is in the contract”
 *   F  in ErrorCode.kt BARCODE_NO_SET("barcode_no_set") → red: “every error code
 *      of the app is in the contract” names barcode_no_set
 *   G  (14.11.2026) in AccountApi.kt "api/v2/settings/default-condition" with an appended x →
 *      red: “shared/app-interface.json is up to date” (and “every route of the app …”)
 */
// Runs in the Android run (android.yml, job vertrag); the web suite reads no Kotlin source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { kotlinFehlercodes, apiRouten, schreibRouten } = require('./kotlin-contract.js');
const { ANDROID, API } = require('./app-interface.js');
// Generator and name mapping of the Kotlin types live with the contract (Web-App/scripts).
const SKRIPTE = path.join(ANDROID, '..', 'Web-App', 'scripts');
const { className: klassenname, SOURCE_ROOT, MAIN, present } = require(path.join(SKRIPTE, 'contract-kotlin-dtos.js'));
const Z = require(path.join(SKRIPTE, 'contract-kotlin-mapping.js'));
// The contract as the server publishes it (npm run contract:openapi).
const dok = JSON.parse(fs.readFileSync(path.join(ANDROID, '..', 'Web-App', 'docs', 'openapi-v2.json'), 'utf8'));
const routen = [
  ...apiRouten(API).map(r => ({
    methode: 'GET',
    pfad: r.pfad,
    typ: r.typ,
    anfrage: r.anfrage,
    rumpf: null,
  })),
  ...schreibRouten(API),
];
const generated = present()
  .filter((/** @type {string} */ n) => n.startsWith(`${MAIN}/`))
  .map((/** @type {string} */ n) => fs.readFileSync(path.join(SOURCE_ROOT, n), 'utf8'))
  .join('\n');
const erzeugt = new Set([...generated.matchAll(/^(?:data |enum )?class (\w+)/gm)].map(m => m[1]));
/** @param {string} p */
const gleichfoermig = p => p.replace(/\{\w+\}/g, '{}');
/** Path of the app → operation in the contract. @param {string} methode @param {string} pfad */
function operation(methode, pfad) {
  const treffer = Object.entries(dok.paths).filter(([p]) => gleichfoermig(p) === gleichfoermig(pfad));
  return treffer.length === 1 ? treffer[0][1][methode.toLowerCase()] : undefined;
}
/** The Kotlin name the generator gives a schema. @param {string} ref */
const kotlinName = ref => {
  const n = klassenname(ref.split('/').pop() ?? '');
  return /** @type {Record<string, string>} */ (Z.NAMES)[n] ?? n;
};

// Responses without a JSON type: files and empty bodies.
const OHNE_SCHEMA = new Set(['ResponseBody', 'Unit']);
// Bodies the app still builds as Map or JsonObject; every entry is an open remainder.
const FREIE_RUEMPFE = new Set(['Map', 'JsonObject']);

test('every route of the app has a contract', () => {
  assert.ok(routen.length > 100, `nur ${routen.length} Routen gelesen — greift der Leser noch?`);
  const ohne = routen.filter(r => !operation(r.methode, r.pfad)).map(r => `${r.methode} ${r.pfad}`);
  assert.deepEqual(ohne, []);
});

test('the app reads every response with the generated type of its schema', () => {
  const falsch = [];
  let geprueft = 0;
  for (const r of routen) {
    const ref = operation(r.methode, r.pfad)?.responses?.[200]?.content?.['application/json']?.schema?.$ref;
    if (!ref) {
      if (r.typ && !OHNE_SCHEMA.has(r.typ))
        falsch.push(`${r.methode} ${r.pfad}: Kotlin liest ${r.typ}, der Vertrag sagt kein JSON`);
      continue;
    }
    geprueft++;
    const soll = kotlinName(ref);
    if (r.typ !== soll) falsch.push(`${r.methode} ${r.pfad}: Kotlin ${r.typ}, erzeugt ${soll}`);
    if (!erzeugt.has(soll)) falsch.push(`${r.methode} ${r.pfad}: ${soll} fehlt in den erzeugten Contract*.kt`);
  }
  assert.deepEqual(falsch, []);
  assert.ok(geprueft >= 140, `nur ${geprueft} Antworttypen verglichen`);
});

test('every body of the app is the generated body of its route', () => {
  const anfragen = Object.entries(/** @type {Record<string, string>} */ (Z.REQUESTS));
  const falsch = [];
  let geprueft = 0;
  for (const r of routen.filter(x => x.rumpf && !FREIE_RUEMPFE.has(x.rumpf))) {
    geprueft++;
    const soll = anfragen.find(([k]) => {
      const [m, p] = k.split(' ');
      return m === r.methode && gleichfoermig(p ?? '') === gleichfoermig(r.pfad);
    })?.[1];
    if (!operation(r.methode, r.pfad)?.requestBody)
      falsch.push(`${r.methode} ${r.pfad}: der Vertrag nimmt keinen Rumpf`);
    if (r.rumpf !== soll) falsch.push(`${r.methode} ${r.pfad}: Kotlin schickt ${r.rumpf}, erzeugt ${soll ?? '—'}`);
  }
  assert.deepEqual(falsch, []);
  assert.ok(geprueft >= 40, `nur ${geprueft} Rümpfe verglichen`);
  const tot = Object.keys(Z.REQUESTS).filter(k => {
    const [m, p] = k.split(' ');
    return !routen.some(r => r.methode === m && gleichfoermig(r.pfad) === gleichfoermig(p ?? ''));
  });
  assert.deepEqual(tot, [], 'Ein Rumpf ohne Route der App ist toter Code im Erzeuger');
});

test('every query parameter of the app is in the contract', () => {
  const fehlt = [];
  let geprueft = 0;
  for (const r of routen) {
    const namen = new Set(
      (operation(r.methode, r.pfad)?.parameters ?? []).filter(p => p.in === 'query').map(p => p.name),
    );
    for (const a of r.anfrage ?? []) {
      geprueft++;
      if (!namen.has(a.name)) fehlt.push(`${r.methode} ${r.pfad} ?${a.name}`);
    }
  }
  assert.deepEqual(fehlt, []);
  assert.ok(geprueft >= 50, `nur ${geprueft} Abfrageparameter verglichen`);
});

test('every error code of the app is in the contract', () => {
  const datei = path.join(
    ANDROID,
    'core-model',
    'src',
    'main',
    'java',
    'ch',
    'brickinventoryapp',
    'model',
    'domain',
    'ErrorCode.kt',
  );
  const kennungen = kotlinFehlercodes(datei);
  assert.ok(kennungen.length >= 10, `nur ${kennungen.length} Fehlercodes in ErrorCode.kt gelesen`);
  const imVertrag = new Set(dok.components.schemas.ErrorCode?.enum ?? []);
  assert.deepEqual(
    kennungen.filter(k => !imVertrag.has(k)),
    [],
  );
});

// The web suite reads the app only via this file; it must say what the source says.
test('shared/app-interface.json is up to date', () => {
  const { appInterface, TARGET } = require('./app-interface.js');
  const file = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
  assert.ok(file.routes.length > 100, `nur ${file.routes.length} Routen in der Datei`);
  assert.deepEqual(file, appInterface(), 'node Android-App/tools/contract/app-interface.js');
});
