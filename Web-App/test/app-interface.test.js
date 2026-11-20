/**
 * Was die Android-App vom Server braucht, steht in shared/app-schnittstelle.json (erzeugt aus
 * ihrem Quelltext, im Android-Lauf auf Stand geprüft). Der Server muss es weiter anbieten:
 * jede Route im Vertrag, mit den Abfrageparametern und Rumpffeldern, die die App schickt.
 * Ob die Kotlin-Modelle die Antworten lesen können, prüft die Android-Seite
 * (Android-App/tools/vertrag/vertrag-kotlin.test.js).
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  im Vertrag 'GET /api/v1/settings/default-condition' umbenannt → rot: „jede Route der App …“
 *   B  SEITE ohne `page_size` (src/contract/base.ts) → rot: „jeder Abfrageparameter …“
 *   C  im Vertrag `label` aus den Anmeldedaten gestrichen → rot: „jedes Rumpffeld …“ (LoginRequest)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const dok = _req('src/contract/openapi.js').openapi();
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'app-schnittstelle.json'), 'utf8'));

/** @param {string} p */
const uniform = p => p.replace(/\{\w+\}/g, '{}');
/** @param {string} methode @param {string} pfad */
function operation(methode, pfad) {
  const treffer = Object.entries(dok.paths).filter(([p]) => uniform(p) === uniform(pfad));
  return treffer.length === 1 ? treffer[0][1][methode.toLowerCase()] : undefined;
}

test('every route of the app is in the contract', () => {
  assert.ok(app.routen.length > 100, `nur ${app.routen.length} Routen — ist die Datei erzeugt?`);
  const ohne = app.routen.filter(r => !operation(r.methode, r.pfad)).map(r => `${r.methode} ${r.pfad}`);
  assert.deepEqual(ohne, [], 'Diese Adressen ruft die App, der Server hat sie nicht');
});

test('every query parameter of the app is in the contract', () => {
  const fehlt = [];
  let geprueft = 0;
  for (const r of app.routen) {
    const namen = new Set(
      (operation(r.methode, r.pfad)?.parameters ?? []).filter(p => p.in === 'query').map(p => p.name),
    );
    for (const a of r.abfrage) {
      geprueft++;
      if (!namen.has(a.name)) fehlt.push(`${r.methode} ${r.pfad} ?${a.name}`);
    }
  }
  assert.ok(geprueft >= 50, `nur ${geprueft} Abfrageparameter verglichen`);
  assert.deepEqual(fehlt, []);
});

// Eingaben sind geschlossen (strictObject): Ein Feld, das die App schickt und der Vertrag
// nicht kennt, wäre im Betrieb eine 400.
test('every body field of the app is in the contract', () => {
  // Ein erzeugter Rumpftyp dient mehreren Routen (Vereinigung ihrer Schemas); ein Feld muss in
  // einer von ihnen stehen.
  const withBody = app.routen.filter(x => x.rumpffelder.length);
  /** @type {Map<string, Set<string>>} */
  const jeType = new Map();
  for (const r of withBody) {
    const schema = operation(r.methode, r.pfad)?.requestBody?.content?.['application/json']?.schema;
    const felder = jeType.get(r.rumpf ?? '') ?? new Set();
    for (const f of Object.keys(schema?.properties ?? {})) felder.add(f);
    jeType.set(r.rumpf ?? '', felder);
  }
  const fehlt = [];
  let geprueft = 0;
  for (const r of withBody) {
    geprueft++;
    for (const f of r.rumpffelder)
      if (!jeType.get(r.rumpf ?? '')?.has(f)) fehlt.push(`${r.methode} ${r.pfad} ${r.rumpf}.${f}`);
  }
  assert.ok(geprueft >= 35, `nur ${geprueft} Rümpfe verglichen`);
  assert.deepEqual(fehlt, []);
});
