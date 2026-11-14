/**
 * Die Routen der App gegen den Vertrag des Servers (src/vertrag/, als JSON-Schema wie in
 * docs/openapi.json). Die Kotlin-Typen selbst sind aus dem Vertrag erzeugt
 * (vertrag-kotlin-dtos.test.js prüft, dass die Datei aktuell ist); hier bleibt, dass jede
 * Route der App genau den erzeugten Typ ihres Schemas liest und schickt.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  im Vertrag die Route GET /api/v1/parts/stats umbenannt → rot: „jede Route der App
 *      hat einen Vertrag“
 *   B  in SetsApi.kt getSetDetail mit Response<SetsResponse> statt SetResponse → rot:
 *      „jede Antwort liest die App mit dem erzeugten Typ ihres Schemas“
 *   C  in KontoApi.kt login mit @Body QrLoginRequest → rot: „jeder Rumpf der App ist der
 *      erzeugte Rumpf seiner Route“
 *   D  in vertrag-kotlin-zuordnung.js ANFRAGEN eine erfundene Route ergänzt → rot: „jeder
 *      Rumpf der App ist der erzeugte Rumpf seiner Route“ (toter Rumpf)
 *   E  (05.11.2026) im Vertrag die Abfrage von GET /api/v1/sets ohne `page_size` → rot:
 *      „jeder Abfrageparameter der App steht im Vertrag“
 *   F  in Fehlercode.kt BARCODE_KEIN_SET("barcode_kein_satz") → rot: „jeder Fehlercode
 *      der App steht im Vertrag“ nennt barcode_kein_satz
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { kotlinFehlercodes, apiRouten, schreibRouten } = require('../scripts/kotlin-vertrag.js');
const { klassenname, ZIEL } = require('../scripts/vertrag-kotlin-dtos.js');
const Z = require('../scripts/vertrag-kotlin-zuordnung.js');
const { ANDROID } = require('./helpers/android');

const API = path.join(ANDROID, 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');
const dok = _req('src/vertrag/openapi.js').openapi();
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
const erzeugt = new Set([...fs.readFileSync(ZIEL, 'utf8').matchAll(/^(?:data |enum )?class (\w+)/gm)].map(m => m[1]));
/** @param {string} p */
const gleichfoermig = p => p.replace(/\{\w+\}/g, '{}');
/** Pfad der App → Operation im Vertrag. @param {string} methode @param {string} pfad */
function operation(methode, pfad) {
  const treffer = Object.entries(dok.paths).filter(([p]) => gleichfoermig(p) === gleichfoermig(pfad));
  return treffer.length === 1 ? treffer[0][1][methode.toLowerCase()] : undefined;
}
/** Der Kotlin-Name, den der Erzeuger einem Schema gibt. @param {string} ref */
const kotlinName = ref => {
  const n = klassenname(ref.split('/').pop() ?? '');
  return /** @type {Record<string, string>} */ (Z.NAMEN)[n] ?? n;
};

// Antworten ohne JSON-Typ: Dateien und leere Rümpfe.
const OHNE_SCHEMA = new Set(['ResponseBody', 'Unit']);
// Rümpfe, die die App noch als Map oder JsonObject baut; jeder Eintrag ist ein offener Rest.
const FREIE_RUEMPFE = new Set(['Map', 'JsonObject']);

test('jede Route der App hat einen Vertrag', () => {
  assert.ok(routen.length > 100, `nur ${routen.length} Routen gelesen — greift der Leser noch?`);
  const ohne = routen.filter(r => !operation(r.methode, r.pfad)).map(r => `${r.methode} ${r.pfad}`);
  assert.deepEqual(ohne, []);
});

test('jede Antwort liest die App mit dem erzeugten Typ ihres Schemas', () => {
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
    if (!erzeugt.has(soll)) falsch.push(`${r.methode} ${r.pfad}: ${soll} fehlt in Vertrag.kt`);
  }
  assert.deepEqual(falsch, []);
  assert.ok(geprueft >= 140, `nur ${geprueft} Antworttypen verglichen`);
});

test('jeder Rumpf der App ist der erzeugte Rumpf seiner Route', () => {
  const anfragen = Object.entries(/** @type {Record<string, string>} */ (Z.ANFRAGEN));
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
  const tot = Object.keys(Z.ANFRAGEN).filter(k => {
    const [m, p] = k.split(' ');
    return !routen.some(r => r.methode === m && gleichfoermig(r.pfad) === gleichfoermig(p ?? ''));
  });
  assert.deepEqual(tot, [], 'Ein Rumpf ohne Route der App ist toter Code im Erzeuger');
});

test('jeder Abfrageparameter der App steht im Vertrag', () => {
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

test('jeder Fehlercode der App steht im Vertrag', () => {
  const datei = path.join(
    ANDROID,
    'core-vertrag',
    'src',
    'main',
    'java',
    'ch',
    'brickinventoryapp',
    'vertrag',
    'Fehlercode.kt',
  );
  const kennungen = kotlinFehlercodes(datei);
  assert.ok(kennungen.length >= 10, `nur ${kennungen.length} Fehlercodes in Fehlercode.kt gelesen`);
  const imVertrag = new Set(dok.components.schemas.Fehlercode?.enum ?? []);
  assert.deepEqual(
    kennungen.filter(k => !imVertrag.has(k)),
    [],
  );
});
