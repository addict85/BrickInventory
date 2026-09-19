/**
 * „Kann ich das bauen?" — dieselbe Antwort in beiden Oberflächen.
 *
 * ── Warum es diese Prüfung gibt ─────────────────────────────────────────────
 *
 * Marcos stehende Vorgabe: zwei saubere Apps, in den Oberflächen einheitliche
 * Ansichten, ansonsten identische Funktion. Eine Erweiterung, die nur in der
 * Webapp landet, ist deshalb keine halbe Erweiterung, sondern eine, die die
 * Vorgabe verletzt — und das fällt erst auf, wenn jemand am Telefon danach
 * sucht.
 *
 * Geprüft wird die NAHT: dass beide Seiten denselben Endpunkt in derselben
 * Schreibweise ansprechen, und dass beide die Unterscheidung „alles / nur
 * lose" anbieten. Ob die Zahlen stimmen, beantwortet
 * test/bestandsabgleich-db.test.js gegen echte Daten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const APP = path.join(WEB, '..', 'Android-App', 'app', 'src', 'main');
const lies = p => fs.readFileSync(p, 'utf8');
const web  = rel => lies(path.join(WEB, rel));

// ── Jeder Pfad in den Android-Baum AUSGESCHRIEBEN ───────────────────────────
//
// Kein Helfer `app(rel)` mit variablem Segment: test/baumbruecken.test.js löst
// diese Brücken statisch auf und kann eine Variable nicht sehen. Es meldete
// diese Datei prompt, als sie einen solchen Helfer hatte — und zu Recht:
// Genau die unauflösbaren Brücken sind die, die beim nächsten Umbenennen
// lautlos ins Leere zeigen.
const KT_API   = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'api', 'BrickApiService.kt'));
const KT_FEAT  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'PartsListFeature.kt'));
const KT_SCREEN= lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'PartsListScreen.kt'));
const XML_EN   = lies(path.join(APP, 'res', 'values', 'strings.xml'));
const XML_DE   = lies(path.join(APP, 'res', 'values-de', 'strings.xml'));

const ROUTE = '/parts/owned';

test('beide Oberflächen fragen denselben Endpunkt', () => {
  assert.match(web('routes/api_v1/parts.ts'),
    new RegExp(`router\\.post\\('${ROUTE}'`),
    'Der Endpunkt fehlt — dann fragt niemand irgendwo');

  assert.match(web('public/js/08-init.js'), new RegExp(`'/v1${ROUTE}'`),
    'Die Webapp ruft den Endpunkt nicht auf');
  assert.match(KT_API,
    new RegExp(`@POST\\("api/v1${ROUTE}"\\)`),
    'Die App ruft den Endpunkt nicht auf');
});

test('beide fragen in der Rebrickable-Schreibweise', () => {
  // Der eigene Teilebestand steht unter der Rebrickable-Nummer. Die
  // BrickLink-Nummer daneben ist für den Export da; fragte eine der beiden
  // Seiten damit, fände sie nichts — und zwar lautlos, denn „nicht gefunden"
  // sieht genauso aus wie „habe ich nicht".
  const js = web('public/js/08-init.js');
  const fn = js.slice(js.indexOf('async function plFuelleBestand'),
                      js.indexOf('function plRenderTable'));
  assert.ok(fn.length > 100, 'plFuelleBestand nicht gefunden');
  assert.doesNotMatch(fn, /bl_part_number|blPartNumber/,
    'Die Webapp fragt mit der BrickLink-Nummer — damit findet sie nichts');

  const kt = KT_FEAT;
  const fk = kt.slice(kt.indexOf('ladeTeilelisteBestand'));
  assert.match(fk, /partNumber = it\.partNumber/,
    'Die App muss die Rebrickable-Nummer schicken');
  assert.doesNotMatch(fk.slice(0, fk.indexOf('return teile.map')), /blPartNumber/,
    'Die App fragt mit der BrickLink-Nummer — damit findet sie nichts');
});

test('beide unterscheiden „alles" von „nur lose"', () => {
  // Die zwei Zahlen sind der Kern der Antwort: Ein Teil in einem aufgebauten
  // Set besitzt man zwar, müsste dafür aber ein anderes Set zerlegen. Böte
  // eine der beiden Oberflächen die Unterscheidung nicht, gäbe sie auf
  // dieselbe Frage eine andere Antwort als die andere.
  assert.match(web('public/index.html'), /id="pl-bestand-lose"/,
    'Der Webapp fehlt der Schalter „nur lose Teile"');
  assert.match(web('public/js/08-init.js'), /nurLose \? eintrag\.lose : eintrag\.gesamt/,
    'Die Webapp wertet den Schalter nicht aus');

  assert.match(KT_SCREEN,
    /Checkbox\(checked = nurLose/, 'Der App fehlt der Schalter „nur lose Teile"');
  assert.match(KT_FEAT,
    /if \(nurLose\) eintrag\.lose else eintrag\.gesamt/,
    'Die App wertet den Schalter nicht aus');
});

test('beide legen den Kontofilter an', () => {
  // Sonst zählt der Abgleich den ganzen Haushalt, während die Teileliste
  // daneben gefiltert ist — zwei Zahlen aus zwei verschiedenen Blickfeldern
  // auf demselben Bildschirm.
  assert.match(web('public/js/08-init.js'), /scopeQuery\('parts'\)/,
    'Die Webapp schickt den Kontofilter nicht mit');
  assert.match(KT_FEAT,
    /scopeFor\(ch\.brickinventoryapp\.data\.ScopeFilter\.View\.PARTS\)/,
    'Die App schickt den Kontofilter nicht mit');
  assert.match(web('routes/api_v1/parts.ts'),
    /router\.post\('\/parts\/owned'[\s\S]{0,400}?parseScopeMode\(req\.query\.accounts\)/,
    'Der Endpunkt übersetzt den Kontofilter nicht in IDs');
});

test('beide Sprachen sind gepflegt — in beiden Oberflächen', () => {
  // Ein fehlender Schlüssel fällt in dieser Webapp nicht auf: t() gibt den
  // Schlüsselnamen zurück, und „pl.only_loose" sieht auf den ersten Blick aus
  // wie ein Text.
  for (const datei of ['public/locales/de.js', 'public/locales/en.js']) {
    const s = web(datei);
    for (const k of ['pl.fill_owned', 'pl.only_loose', 'pl.owned_complete',
                     'pl.owned_missing', 'pl.owned_none', 'pl.owned_filled']) {
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} fehlt`);
    }
  }
  for (const [name, s] of [['res/values/strings.xml', XML_EN],
                          ['res/values-de/strings.xml', XML_DE]]) {
    const datei = name;
    for (const k of ['partslist_fill_owned', 'partslist_only_loose',
                     'partslist_owned_complete', 'partslist_owned_missing',
                     'partslist_owned_error']) {
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
    }
  }
});
