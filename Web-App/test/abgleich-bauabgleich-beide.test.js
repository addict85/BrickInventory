/**
 * „Kann ich das bauen?" — dieselbe Antwort in beiden Oberflächen.
 *
 * Die Webapp läuft in jsdom (echtes Bündel), die App wird als Struktur gelesen.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen, Bündel neu gebaut):
 *   A  plFuelleBestand() schickt für 3001 die BrickLink-Nummer 3001b → rot: „Webapp: …“
 *   B  `nurLose ? eintrag.lose : eintrag.gesamt` vertauscht → rot: „Webapp: …“
 *   C  `?accounts=own` immer angehängt → rot: „Webapp: …“ (mit Unterkonten)
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
// Kommentare ABSTREIFEN, und zwar hier schon beim Lesen.
const lies = p => ohneKommentare(fs.readFileSync(p, 'utf8'));
const web  = rel => lies(path.join(WEB, rel));

// Jeder Pfad in den Android-Baum AUSGESCHRIEBEN
const KT_API   = ohneKommentare(require('../scripts/kotlin-vertrag.js').apiQuelltext(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api')));
const KT_FEAT  = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'teile', 'ui', 'Teileliste.kt'));
const KT_SCREEN= lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'teile', 'ui', 'screens', 'PartsListScreen.kt'));
const XML_EN   = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values', 'strings.xml'));
const XML_DE   = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values-de', 'strings.xml'));

const ROUTE = '/parts/owned';

test('Webapp: fragt den Endpunkt in Rebrickable-Schreibweise, unterscheidet lose und eigenes Blickfeld', async () => {
  const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');
  const anfragen = [];
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets/10294-1/parts-list': { success: true, parts: [{ part_number: '3001', bl_part_number: '3001b', part_name: 'Brick 2 x 4',
      color_id: 4, color_name: 'Red', color_hex: 'C91A09', quantity: 6 }] },
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
    '/v1/parts/owned': (url, opt) => {
      anfragen.push({ url, teile: JSON.parse(opt.body).teile });
      return { success: true, bestand: { '3001|4': { gesamt: 5, lose: 2 } } };
    },
  });
  try {
    await reiter(w, 'partslist');
    d.getElementById('pl-setnr').value = '10294';
    d.querySelector('[data-click="plAddSet"]').click();
    await warte(() => d.querySelector('#pl-sets .pl-chip-name')?.textContent.trim(), 3000);
    d.getElementById('btn-pl-gen').click();
    assert.ok(await warte(() => d.querySelector('.pl-have-input'), 3000), 'keine Bauliste');
    const feld = () => d.querySelector('.pl-have-input').value;

    d.getElementById('btn-pl-bestand').click();
    assert.ok(await warte(() => anfragen.length === 1 && feld() === '5'), `alles: ${feld()}`);
    // Mit der BrickLink-Nummer fände der Server nichts — und „nicht gefunden“ sieht aus wie „habe ich nicht“.
    assert.deepEqual(anfragen[0].teile, [{ part_number: '3001', color_id: 4 }]);
    assert.match(anfragen[0].url, /\/api\/v1\/parts\/owned\?accounts=own$/, 'ohne Haken zählt der Haushalt mit');
    assert.doesNotMatch(d.getElementById('pl-status').textContent, /\bpl\./, 'Statustext ohne Übersetzung');

    const lose = d.getElementById('pl-bestand-lose');
    lose.checked = true;
    lose.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => anfragen.length === 2 && feld() === '2'), `nur lose: ${feld()}`);

    const subs = d.getElementById('pl-bestand-subs');
    subs.checked = true;
    subs.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => anfragen.length === 3), 'mit Unterkonten nicht neu gefragt');
    assert.match(anfragen[2].url, /\/api\/v1\/parts\/owned$/, 'mit Unterkonten trotzdem nur das eigene Konto');
  } finally { w.close(); }
});

test('App: fragt den Endpunkt, den der Server anbietet', () => {
  assert.match(web('routes/api_v1/parts.ts'),
    new RegExp(`router\\.post\\('${ROUTE}'`),
    'Der Endpunkt fehlt — dann fragt niemand irgendwo');

  assert.match(KT_API,
    new RegExp(`@POST\\("api/v1${ROUTE}"\\)`),
    'Die App ruft den Endpunkt nicht auf');
});

test('App: fragt in der Rebrickable-Schreibweise', () => {
  // Der eigene Teilebestand steht unter der Rebrickable-Nummer. Die
  // BrickLink-Nummer daneben ist für den Export da; fragte eine der beiden
  // Seiten damit, fände sie nichts — und zwar lautlos, denn „nicht gefunden"
  // sieht genauso aus wie „habe ich nicht".
  const kt = KT_FEAT;
  const fk = kt.slice(kt.indexOf('suspend fun mitBestand'));
  assert.ok(fk.length > 100, 'mitBestand nicht gefunden');
  assert.match(fk, /partNumber = it\.partNumber/,
    'Die App muss die Rebrickable-Nummer schicken');
  assert.doesNotMatch(fk.slice(0, fk.indexOf('return teile.map')), /blPartNumber/,
    'Die App fragt mit der BrickLink-Nummer — damit findet sie nichts');
});

test('App: unterscheidet „alles" von „nur lose"', () => {
  // Die zwei Zahlen sind der Kern der Antwort: Ein Teil in einem aufgebauten
  // Set besitzt man zwar, müsste dafür aber ein anderes Set zerlegen. Böte
  // eine der beiden Oberflächen die Unterscheidung nicht, gäbe sie auf
  // dieselbe Frage eine andere Antwort als die andere.
  assert.match(KT_SCREEN,
    /(?:Checkbox\(checked = |KaestchenZeile\(stringResource\(R\.string\.partslist_only_loose\), )nurLose/, 'Der App fehlt der Schalter „nur lose Teile"');
  assert.match(KT_FEAT,
    /if \(nurLose\) eintrag\.lose else eintrag\.gesamt/,
    'Die App wertet den Schalter nicht aus');
});

test('App: fragt ihr Blickfeld an DIESER Stelle', () => {
  // Was sich geändert hat (Marcos Vorgabe)
  assert.match(KT_SCREEN, /(?:Checkbox\(checked = |KaestchenZeile\(stringResource\(R\.string\.partslist_include_subs\), )mitUnterkonten/,
    'Der App fehlt die Wahl „Unterkonten mit einbeziehen"');
  assert.match(KT_FEAT, /if \(mitUnterkonten\) null else "own"/,
    'Die App schickt ohne Haken kein „own"');
  assert.doesNotMatch(KT_FEAT,
    /scopeFor\((ch\.brickinventoryapp\.model\.data\.)?ScopeFilter\.View\.PARTS\)/,
    'Die App hängt wieder am Kontofilter des Teile-Reiters');

  // Unverändert und weiterhin die Voraussetzung für beides: Der Endpunkt muss
  // den Namen in IDs übersetzen.
  assert.match(web('routes/api_v1/parts.ts'),
    /router\.post\('\/parts\/owned'[\s\S]{0,400}?getOwnedQuantities\(sichtVon\(req\)/,
    'Der Endpunkt übersetzt den Kontofilter nicht in IDs');
});

test('beide Sprachen sind gepflegt — in beiden Oberflächen', () => {
  // Ein fehlender Schlüssel fällt in dieser Webapp nicht auf: t() gibt den
  // Schlüsselnamen zurück, und „pl.only_loose" sieht auf den ersten Blick aus
  // wie ein Text.
  for (const datei of ['public/locales/de.js', 'public/locales/en.js']) {
    const s = web(datei);
    for (const k of ['pl.fill_owned', 'pl.only_loose', 'pl.include_subs', 'pl.owned_complete',
                     'pl.owned_missing', 'pl.owned_none', 'pl.owned_filled']) {
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} fehlt`);
    }
  }
  for (const [name, s] of [['res/values/strings.xml', XML_EN],
                          ['res/values-de/strings.xml', XML_DE]]) {
    const datei = name;
    for (const k of ['partslist_fill_owned', 'partslist_only_loose', 'partslist_include_subs',
                     'partslist_owned_complete', 'partslist_owned_missing',
                     'partslist_owned_error']) {
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
    }
  }
});
