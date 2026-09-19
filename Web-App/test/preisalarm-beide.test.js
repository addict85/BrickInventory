/**
 * Preisalarm — dieselbe Antwort in beiden Oberflächen.
 *
 * Wie test/bauabgleich-beide.test.js und test/lagerort-beide.test.js: Marcos
 * stehende Vorgabe ist „zwei saubere Apps, ansonsten identische Funktion".
 * Geprüft wird die NAHT; ob die Meldung zum richtigen Zeitpunkt kommt,
 * beantwortet test/preisalarm-db.test.js gegen echte Daten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const APP = path.join(WEB, '..', 'Android-App', 'app', 'src', 'main');
const lies = p => fs.readFileSync(p, 'utf8');
const web  = rel => lies(path.join(WEB, rel));

// Jeder Pfad in den Android-Baum AUSGESCHRIEBEN — siehe test/baumbruecken.test.js.
const KT_API    = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'api', 'BrickApiService.kt'));
const KT_FEAT   = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'SetDetailFeature.kt'));
const KT_SECT   = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'SetDetailSections.kt'));
const XML_EN    = lies(path.join(APP, 'res', 'values', 'strings.xml'));
const XML_DE    = lies(path.join(APP, 'res', 'values-de', 'strings.xml'));

test('beide Oberflächen sprechen dieselben drei Endpunkte an', () => {
  const route = web('routes/api_v1/sets.ts');
  for (const m of ['get', 'put', 'delete']) {
    assert.match(route, new RegExp(`router\\.${m}\\('/sets/:setNumber/alert'`),
      `Der Endpunkt ${m.toUpperCase()} fehlt`);
  }
  const js = web('public/js/07-admin.js');
  assert.match(js, /\/alert`\)/,  'Die Webapp liest den Alarm nicht');
  assert.match(js, /'PUT', `\/v1\/sets\/\$\{encodeURIComponent\(sn\)\}\/alert`/, 'Die Webapp setzt ihn nicht');
  assert.match(js, /'DELETE', `\/v1\/sets\/\$\{encodeURIComponent\(sn\)\}\/alert\?condition=/, 'Die Webapp löscht ihn nicht');

  assert.match(KT_API, /@GET\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@PUT\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@DELETE\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
});

test('ein Alarm gehört EINEM Konto — kein Blickfeld, nirgends', () => {
  // Der einzige Ort im Projekt, an dem `user_id` ohne scopeIds()/writableIds()
  // richtig ist: Wer eine Schwelle setzt, will selbst benachrichtigt werden.
  // Das Elternkonto hätte nichts davon, die Wünsche seiner Kinder per Mail zu
  // bekommen — und dürfte sie schon gar nicht löschen.
  //
  // Geprüft wird beides: dass die Route NICHT filtert, und dass sie es
  // begründet. Ohne die Begründung sieht die Stelle beim nächsten Lesen wie
  // ein vergessener Filter aus, und jemand „repariert" sie.
  const route = web('routes/api_v1/sets.ts');
  const i = route.indexOf("router.get('/sets/:setNumber/alert'");
  const j = route.indexOf("router.get('/storage'");
  assert.ok(i > 0 && j > i, 'Die Alarm-Routen stehen nicht, wo erwartet');
  const block = route.slice(i, j);
  assert.doesNotMatch(block, /scopeIds|writableIds|parseScopeMode/,
    'Eine Alarm-Route filtert nach Blickfeld — dann bekämen Eltern die Mails der Kinder');
  assert.match(route.slice(Math.max(0, i - 900), i), /gehoert genau EINEM Konto/,
    'Die Ausnahme ist nicht begründet — beim nächsten Lesen sieht sie aus wie ein Versehen');

  assert.doesNotMatch(KT_API.slice(KT_API.indexOf('getPreisalarme'),
                                   KT_API.indexOf('// ── Lagerort')), /@Query\("accounts"\)/,
    'Die App schickt einen Kontofilter mit — der Server ignoriert ihn, aber die Absicht wäre falsch');
});

test('ein leeres Feld löscht — in beiden', () => {
  // Die natürliche Geste, einen Alarm loszuwerden, ist das Feld zu leeren.
  // Ein eigener Knopf daneben wäre ein zweiter Weg für dieselbe Absicht, und
  // eine „Schwelle 0" wäre ein Alarm, der nie oder immer meldet.
  assert.match(web('public/js/07-admin.js'), /roh === ''\s*\n?\s*\? await api\('DELETE'/,
    'Die Webapp löscht bei leerem Feld nicht');
  assert.match(KT_FEAT, /schwelle == null \|\| schwelle <= 0\.0\)\s*\n?\s*repo\.sets\.deletePreisalarm/,
    'Die App löscht bei leerem Feld nicht');
});

test('beide zeigen, ob schon gemeldet wurde', () => {
  // Der Unterschied zwischen „der Alarm steht" und „der Alarm hat gefeuert".
  // Ohne diese Zeile fragt man sich, warum keine Mail mehr kommt — und die
  // Antwort (Hysterese) steht nirgends auf dem Bildschirm.
  assert.match(web('public/js/07-admin.js'), /a\.ausgeloest \? tRaw\('detail\.alert_fired'\)/,
    'Die Webapp zeigt den Merker nicht');
  assert.match(KT_SECT, /alarm\.ausgeloest\) R\.string\.detail_alert_fired/,
    'Die App zeigt den Merker nicht');
});

test('beide Sprachen sind gepflegt — in beiden Oberflächen', () => {
  for (const datei of ['public/locales/de.js', 'public/locales/en.js']) {
    const s = web(datei);
    for (const k of ['detail.alert', 'detail.alert_below', 'detail.alert_above',
                     'detail.alert_armed', 'detail.alert_fired']) {
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} fehlt`);
    }
  }
  for (const [datei, s] of [['res/values/strings.xml', XML_EN],
                            ['res/values-de/strings.xml', XML_DE]]) {
    for (const k of ['detail_alert', 'detail_alert_below', 'detail_alert_above',
                     'detail_alert_armed', 'detail_alert_fired']) {
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
    }
  }
});

test('die Prüfung hängt am Ende des Preislaufs, nicht an jedem Preisabruf', () => {
  // In fetchAndCachePrice() liefe sie pro Lauf tausendfach — auch bei
  // Cache-Treffern, bei denen sich nichts geändert hat — und meldete dieselbe
  // Schwelle mehrfach je Durchgang.
  const job = require('./helpers/sources').ohneKommentare(web('jobs/priceJob.ts'));
  assert.match(job, /pruefeSet/, 'Der Preislauf prüft keine Alarme');
  // Bis zur SCHLIESSENDEN Klammer der Funktion, nicht bis zur nächsten
  // Deklaration: Zwischen fetchAndCachePrice() und refreshPriceForSet() liegt
  // die Hauptschleife des Laufs — und genau dort steht die Prüfung richtig.
  // Der erste Entwurf schnitt bis dorthin und meldete deshalb die richtige
  // Stelle als Fehler.
  const i = job.indexOf('async function fetchAndCachePrice');
  assert.ok(i > 0, 'fetchAndCachePrice nicht gefunden');
  const fetchTeil = job.slice(i, job.indexOf('\n}', i));
  assert.doesNotMatch(fetchTeil, /pruefeSet/,
    'Die Prüfung hängt am einzelnen Preisabruf — dann meldet sie mehrfach je Lauf');
  assert.match(job, /SELECT DISTINCT set_number FROM price_alerts/,
    'Es müssen nur die Sets geprüft werden, auf die jemand wartet');
});
