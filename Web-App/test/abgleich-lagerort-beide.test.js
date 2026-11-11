/**
 * Lagerort — dieselbe Antwort in beiden Oberflächen. Die Webapp läuft im
 * echten Bündel (jsdom), die Längengrenze am Servermodul; die App bleibt
 * Kotlin-Struktur (kein SDK hier). Den Server selbst (Endpunkte, Vorrat,
 * Filter, Besitzerliste, Schreibbereich) prüfen lagerort-db, lagerort-vorrat-db,
 * lagerort-id-db, lagerort-detail-und-vorrat-db und lagerort-beim-erfassen-db;
 * die Verwaltung in den Einstellungen formulare-rueckmeldung-oberflaeche.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in lagerortGewaehlt das dispatchEvent(change) entfernt → rot: „Webapp:
 *      im Set-Detail …“ und „Webapp: das Teil …“ (kein PUT)
 *   B  in 07-set-detail.js ladeOrtAuswahl ohne die Besitzer → rot: ebenda (owner=)
 *   C  in 13-set-teile.js `if (type === 'part')` → `if (true)` → rot: „Webapp: das
 *      Teil …“ (Feld bei der Figur)
 *   D  maxlength="60" → "80" in lagerortBlock → rot: „die Längengrenze …“
 *   E  in 14-scope.js addLagerParam ohne p.set → rot: „Webapp: der Filter …“
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');
const _req = require('./helpers/sources').buildAndRequire();

const lies = p => fs.readFileSync(p, 'utf8');
// Jeder Pfad in den Android-Baum AUSGESCHRIEBEN — test/abgleich-baumbruecken.test.js
// löst diese Brücken statisch auf und kann eine Variable nicht sehen.
const KT_API    = require('../scripts/kotlin-vertrag.js').apiQuelltext(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api'));
// Die Regeln des Filters (ScopeFilter) und seine Ablage im Gerät (ScopeFilterSpeicher).
const KT_SCOPE  = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-model', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'model', 'data', 'ScopeFilter.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'ScopeFilterSpeicher.kt'));
// Seit dem Schnitt des MainViewModels (28.10.2026) liegt der Lagerortfilter
// in der Grundlage der Bereichs-ViewModels, die Verwaltung im
// EinstellungenViewModel und das Laden der eigenen Orte im Blickfeld.
const KT_HAUS   = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-zustand', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'zustand', 'ui', 'viewmodel', 'Bereichshelfer.kt'))
               + lies(path.join(__dirname, '..', '..', 'Android-App', 'core-zustand', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'zustand', 'ui', 'Blickfeld.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'viewmodel', 'EinstellungenViewModel.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'core-zustand', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'zustand', 'ui', 'Blickfeld.kt'));
const KT_DIALOG = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'teile', 'ui', 'dialogs', 'SetItemDetailDialog.kt'));
const KT_SETDET = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'screens', 'SetDetailSections.kt'));
const KT_CHIPS  = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ui-bestand', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'gemeinsam', 'ui', 'HouseholdComposables.kt'));
const KT_FELD   = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ui-bestand', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'gemeinsam', 'ui', 'LagerortFeld.kt'));
// Die Einstellungen der App liegen in mehreren Dateien: Der Bildschirm
// selbst traegt nur die Liste, jede Rubrik hat ihre eigene Seite
// (EinstellungenUnterseiten.kt) mit der Karte in Einstellungen*.kt. Gelesen
// werden deshalb alle, die es betrifft — die …
const KT_EINST  = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'SettingsScreen.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'EinstellungenUnterseiten.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'EinstellungenAlarme.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'EinstellungenLagerorte.kt'));
const XML_EN    = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values', 'strings.xml'));
const XML_DE    = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values-de', 'strings.xml'));

const SN = '10305-1';

/** Ein Detail öffnen wie ein Klick: data-click mit Argumenten. */
function klick(o, daten) {
  const k = o.d.createElement('button');
  Object.assign(k.dataset, daten);
  o.d.body.append(k);
  k.click();
}
const schreibt = (o, pfad) => o.aufrufe.filter(a => a.method === 'PUT' && a.url.endsWith(pfad));
const waehle = (o, id, wert) => {
  const s = o.d.getElementById(id);
  s.value = wert;
  assert.equal(s.value, wert, `${id} bietet „${wert}“ nicht an`);
  s.dispatchEvent(new o.w.Event('change', { bubbles: true }));
};

test('Webapp: im Set-Detail aus dem Vorrat des Besitzers wählen oder neu eintippen', async () => {
  const o = await oeffneOberflaeche({
    [`/v1/sets/${SN}`]: { success: true, set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['N'], instructions: [],
      storage: 'Keller', owners: [{ id: 7, username: 'ben' }] } },
    '/v1/storage/locations': u => ({ success: true, orte: /owner=7/.test(u) ? [{ id: 1, name: 'Keller' }, { id: 2, name: 'Regal A' }] : [] }),
    [`/v1/sets/${SN}/storage`]: { success: true },
  });
  try {
    klick(o, { click: 'openModal', arg: SN });
    assert.ok(await warte(() => o.d.querySelector('#m-storage-sel option[value="Regal A"]'), 4000), 'der Vorrat des Besitzers fehlt in der Auswahl');
    assert.ok(o.aufrufe.some(a => /\/v1\/storage\/locations\?owner=7$/.test(a.url)), 'nicht nach der Liste des Besitzers gefragt');
    assert.equal(o.d.getElementById('m-storage-sel').value, 'Keller');
    waehle(o, 'm-storage-sel', 'Regal A');
    assert.ok(await warte(() => schreibt(o, `/v1/sets/${SN}/storage`).length === 1), 'die Wahl speichert nicht');
    assert.deepEqual(JSON.parse(schreibt(o, `/v1/sets/${SN}/storage`)[0].body), { storage: 'Regal A' });
    const auswahl = o.d.getElementById('m-storage-sel');
    auswahl.selectedIndex = [...auswahl.options].findIndex(x => x.dataset.neu === '1');
    assert.ok(auswahl.selectedIndex > 0, 'kein Eintrag „neuer Ort“');
    auswahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.equal(o.d.getElementById('m-storage').style.display, '', '„neuer Ort“ öffnet kein Textfeld');
    assert.equal(o.d.getElementById('m-storage').value, '');
  } finally { o.w.close(); }
});

test('Webapp: das Teil hat das Feld und speichert, die Figur nicht', async () => {
  const o = await oeffneOberflaeche({
    '/v1/parts/3001/5/sets': { success: true, item: { name: 'Stein', color_name: 'Red', total_quantity: 2, owner_ids: [1], storage: null }, sets: [] },
    '/v1/minifigs/sw0001/sets': { success: true, item: { name: 'Figur', total_quantity: 1 }, sets: [] },
    '/v1/storage/locations': { success: true, orte: [{ id: 3, name: 'Kiste 3' }] },
    '/v1/parts/3001/5/storage': { success: true },
  });
  try {
    klick(o, { click: 'openSetItemDetail', arg: 'part', arg2: '3001', arg3: '5' });
    assert.ok(await warte(() => o.d.querySelector('#setitem-storage-sel option[value="Kiste 3"]')), 'Teil: kein Lagerortfeld');
    waehle(o, 'setitem-storage-sel', 'Kiste 3');
    assert.ok(await warte(() => schreibt(o, '/v1/parts/3001/5/storage').length === 1), 'Teil: die Wahl speichert nicht');
    o.d.getElementById('setitem-modal').classList.remove('open');
    klick(o, { click: 'openSetItemDetail', arg: 'fig', arg2: 'sw0001', arg3: '0' });
    assert.ok(await warte(() => o.d.getElementById('setitem-tit').textContent === 'Figur'));
    await o.ruhig();
    assert.equal(o.d.getElementById('setitem-storage'), null, 'Figur: das Feld steht auch bei Figuren');
  } finally { o.w.close(); }
});

test('Webapp: der Filter steht neben dem Kontofilter und geht an den Server', async () => {
  const o = await oeffneOberflaeche({ '/v1/storage': { success: true, orte: [{ ort: 'Regal A', sets: 1, teile: 0, figuren: 0 }] } });
  try {
    await o.ruhig();
    for (const view of ['gallery', 'parts'])
      assert.equal(o.d.getElementById(`storage-${view}`).parentElement, o.d.getElementById(`scope-${view}`).parentElement,
        `${view}: die beiden Filter stehen nicht beieinander`);
    assert.ok(await warte(() => o.d.querySelector('#storage-gallery option[value="Regal A"]')), 'der Filter kennt den Ort nicht');
    waehle(o, 'storage-gallery', 'Regal A');
    assert.ok(await warte(() => o.aufrufe.some(a => /\/v1\/sets\?.*storage=Regal(\+|%20)A/.test(a.url))), 'der Filter geht nicht an den Server');
  } finally { o.w.close(); }
});

test('die Längengrenze steht in Server, Fehlertext, Webapp und App gleich', async () => {
  const { LAGERORT_MAX_ZEICHEN: max, normalisiereLagerort } = { ..._req('src/bestand/lagerort.js'), ..._req('src/bestand/prozess.js').bestandBereich().lagerortDienst };
  assert.ok(max > 0);
  assert.equal(normalisiereLagerort('x'.repeat(max)), 'x'.repeat(max));
  assert.throws(() => normalisiereLagerort('x'.repeat(max + 1)), e => e instanceof Error && e.message.includes(`höchstens ${max} Zeichen`));
  const o = await oeffneOberflaeche({ [`/v1/sets/${SN}`]: { success: true, set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['N'], instructions: [] } } });
  try {
    klick(o, { click: 'openModal', arg: SN });
    assert.ok(await warte(() => o.d.getElementById('m-storage'), 4000));
    assert.equal(Number(o.d.getElementById('m-storage').getAttribute('maxlength')), max, 'Das Eingabefeld der Webapp begrenzt anders');
  } finally { o.w.close(); }
  assert.ok(KT_FELD.includes(`it.length <= ${max}`), `Das Eingabefeld der App begrenzt nicht auf ${max}`);
});

test('App: dieselben Endpunkte für Lagerort, Filter und Vorrat', () => {
  assert.match(KT_API, /@PUT\("api\/v1\/parts\/\{partNumber\}\/\{colorId\}\/storage"\)/);
  assert.match(KT_API, /@PUT\("api\/v1\/sets\/\{setNumber\}\/storage"\)/);
  assert.match(KT_API, /@GET\("api\/v1\/storage"\)/);
  assert.match(KT_API, /@Query\("storage"\)/, 'Die App schickt den Lagerort nicht mit');
  assert.match(KT_API, /@GET\("api\/v1\/storage\/locations"\)/);
  assert.match(KT_API, /@POST\("api\/v1\/storage\/locations"\)/);
  assert.match(KT_API, /@PUT\("api\/v1\/storage\/locations\/\{id\}"\)/);
  assert.match(KT_API, /@DELETE\("api\/v1\/storage\/locations\/\{id\}"\)/);
});

test('App: Feld im Set- und Teil-Detail (nicht bei Figuren), aus der Liste des Besitzers, auswählen oder tippen', () => {
  assert.match(KT_SETDET, /R\.string\.detail_storage/, 'App: Set-Detail');
  assert.match(KT_DIALOG, /LagerortFeld\(/, 'App: Teil-Detail');
  assert.match(KT_DIALOG, /val kopfFarbe = kopf\?\.colorId[\s\S]{0,80}kopfFarbe != null/, 'App: das Feld steht auch bei Figuren');
  assert.match(KT_SETDET, /aktionen\.loadLagerortVorrat\(set\.owners\.map \{ it\.id \}\)/, 'Die App fragt nicht nach der Liste des Besitzers');
  assert.match(KT_DIALOG, /aktionen\.loadLagerortVorrat\(zustand\.kopf\?\.ownerIds \?: emptyList\(\)\)/,
    'Die App fragt beim Teil nicht nach der Liste des Besitzers');
  assert.match(KT_FELD, /ExposedDropdownMenuBox/, 'Das Feld der App klappt nicht auf');
});

test('App: gespeichert wird beim Tippen, die Ruhezeit lebt im ViewModel', () => {
  const ohneK = require('./helpers/sources').ohneKommentare;
  assert.doesNotMatch(ohneK(KT_FELD), /onFocusChanged/, 'Das Feld der App hängt wieder am Fokuswechsel');
  assert.match(ohneK(KT_HAUS) + ohneK(KT_SETDET), /onWert = \{/, 'Das Feld gibt den getippten Wert nicht weiter');
  const gal = ohneK(lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'viewmodel', 'SetDetailViewModel.kt')));
  assert.match(gal, /lagerJob\?\.cancel\(\)\s*\n\s*lagerJob = viewModelScope\.launch/, 'Die Ruhezeit läuft nicht im viewModelScope');
});

test('App: Filter neben dem Kontofilter, beim Anmelden zurückgesetzt, nicht im Speicher der vollen Liste', () => {
  assert.match(KT_SCOPE, /fun lagerAsQuery/, 'Der App fehlt die Umsetzung in den Parameter');
  const i = KT_SCOPE.indexOf('suspend fun resetAll');
  assert.ok(i > 0, 'resetAll nicht gefunden');
  assert.match(KT_SCOPE.slice(i, KT_SCOPE.indexOf('\n    /**', i)), /remove\(lagerKey\(view\)\)/, 'Die App setzt den Lagerortfilter beim Anmelden nicht zurück');
  // Sets filtert die Ablage selbst; Teile mit Lagerort gehen über die Serversicht (Kontosicht).
  const KT_SETS_REPO = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'repository', 'SetsRepositoryImpl.kt'));
  const KT_TEILE_VM = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'teile', 'ui', 'viewmodel', 'TeileViewModel.kt'));
  assert.match(KT_SETS_REPO, /Filterspalten\([^)]*lagerort = lagerort/, 'SetsRepositoryImpl.kt: der Lagerort fehlt im Filter der Ablage');
  assert.match(KT_TEILE_VM, /teileKonto == null && teileLager == null/, 'TeileViewModel.kt: ein Lagerort führt nicht zur Serversicht');
  assert.match(KT_TEILE_VM, /TeileAbfrage\([^;]*?teileLager\)/s, 'TeileViewModel.kt: der Lagerort fehlt in der Abfrage der Serversicht');
  assert.match(KT_CHIPS, /LagerortFilterChip\(orte = lagerorte/, 'Der App fehlt der Lagerortfilter in der Filterzeile');
  assert.match(KT_HAUS, /fun setLagerFilter\(/, 'Der App fehlt das Umschalten');
});

test('App: Verwaltung in den Einstellungen (nur die eigenen Orte) und beide Sprachen', () => {
  assert.match(KT_EINST, /LagerorteCard\(lager, vm\)/, 'Der App fehlt die Karte');
  for (const fn of ['legeLagerortAn', 'benenneLagerortUm', 'loescheLagerort'])
    assert.match(KT_HAUS, new RegExp(`fun ${fn}\\(`), `Der App fehlt ${fn}`);
  assert.match(KT_HAUS, /aktualisiereLagerortVorrat\(\)/, 'Die App holt für die Einstellungen nicht die eigene Liste');
  for (const [datei, s] of [['res/values/strings.xml', XML_EN], ['res/values-de/strings.xml', XML_DE]])
    for (const k of ['detail_storage', 'detail_storage_ph', 'filter_storage_all'])
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
});
