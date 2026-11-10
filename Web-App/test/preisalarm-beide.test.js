/**
 * Preisalarm — dieselbe Antwort in beiden Oberflächen. Die Webapp läuft im
 * echten Bündel (jsdom), mit der Ruhezeit, die die App in Alarmeingabe.kt
 * nennt; die App bleibt Kotlin-Struktur (kein SDK hier). Ob die Meldung zum
 * richtigen Zeitpunkt kommt und je Konto getrennt ist, prüft
 * preisalarm-db.test.js gegen echte Daten.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel neu gebaut), in
 * public/js/02-detailfelder.js:
 *   A  ALARM_RUHE 800 → 300 → rot: „Webapp: beim Tippen …“ (PUT vor der Ruhezeit)
 *   B  in alarmGetippt die Ruhezeit nicht zurückgesetzt (kein clearTimeout) →
 *      rot: ebenda (drei PUT statt einem)
 *   C  in sendeAlarm `const loeschen = zahl == null` → `false` → rot: „Webapp:
 *      ein leeres Feld …“
 *   D  wechsleAlarmZustand ruft speichereAlarm → rot: ebenda (Zustandswechsel schreibt)
 *   E  in zeigeOffeneAlarme `if (!marke) return;` entfernt → rot: „Webapp: offene
 *      Alarme …“ (Meldung beim ersten Besuch)
 *   F  dort die Marke aus Date.now() statt d.now → rot: ebenda
 *   G  in zeigeAlarmMerker alert_fired/alert_armed vertauscht → rot: „Webapp: beim Tippen …“
 *   H  in Alarmeingabe.kt RUHE_MS 800 → 500 (bzw. 1200) → rot: „Webapp: beim
 *      Tippen …“ — die Ruhezeit beider Oberflächen ist dieselbe
 * Die übrigen Kotlin-Fälle sind Struktur (kein Android-SDK hier).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, warte, takt, ANMELDUNG } = require('./helpers/oberflaeche');
const { loadTranslations, ohneKommentare } = require('./helpers/sources');

const APP = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src', 'main');
const lies = p => fs.readFileSync(p, 'utf8');

const KT_API    = require('../scripts/kotlin-vertrag.js').apiQuelltext(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api'));
// Seit dem Schnitt des MainViewModels (28.10.2026): das entprellte Speichern
// in Preisalarmeingabe.kt, gehalten vom SetDetailViewModel.
const KT_FEAT   = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'Preisalarmeingabe.kt'));
const KT_SECT   = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'screens', 'SetDetailSections.kt'));
const KT_ABHOL  = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-dienste', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'dienste', 'alarm', 'Alarmabholung.kt'));
const KT_WORKER = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-dienste', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'dienste', 'alarm', 'PreisalarmWorker.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'core-dienste', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'dienste', 'alarm', 'PreisalarmDurchgang.kt'));
const KT_START  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'app', 'BrickInventoryApp.kt'));
const KT_ALARMEINGABE = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'alarm', 'Alarmeingabe.kt'));
const KT_VM     = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'viewmodel', 'SetDetailViewModel.kt'));
// Die Einstellungen der App liegen in mehreren Dateien: Der Bildschirm
// selbst traegt nur die Liste, jede Rubrik hat ihre eigene Seite
// (EinstellungenUnterseiten.kt) mit der Karte in Einstellungen*.kt. Gelesen
// werden deshalb alle, die es betrifft — die …
// Ausführlich: docs/begruendungen/test/preisalarm-beide.test.js.md#kt-einst
const KT_EINST  = lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'SettingsScreen.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'EinstellungenUnterseiten.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'EinstellungenAlarme.kt'))
                + lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-konto', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'konto', 'ui', 'screens', 'EinstellungenLagerorte.kt'));
const KT_GERAET = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-zustand', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'zustand', 'ui', 'viewmodel', 'GeraeteEinstellungenViewModel.kt'));
const KT_PLANER = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-dienste', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'dienste', 'alarm', 'WorkManagerAlarmPlaner.kt'));
const XML_EN    = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values', 'strings.xml'));
const XML_DE    = lies(path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values-de', 'strings.xml'));

const SN = '10305-1';
const de = loadTranslations().de;
const RUHE = Number(/const val RUHE_MS = (\d+)L/.exec(KT_ALARMEINGABE)?.[1]);

/** Set-Detail öffnen, wie ein Klick auf die Kachel. */
async function detail(antworten = {}) {
  const o = await oeffneOberflaeche({
    [`/v1/sets/${SN}`]: { success: true, set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['N'], instructions: [] } },
    [`/v1/sets/${SN}/alert`]: (_u, opt) => opt.method === 'PUT'
      ? { success: true, alert: { set_number: SN, condition: 'N', richtung: 'unter', schwelle: 249, currency_code: 'EUR', ausgeloest: true } }
      : { success: true, alerts: [] },
    ...antworten,
  });
  const knopf = o.d.createElement('button');
  Object.assign(knopf.dataset, { click: 'openModal', arg: SN });
  o.d.body.append(knopf);
  knopf.click();
  assert.ok(await warte(() => o.d.getElementById('m-alert-val'), 4000), 'kein Alarmfeld im Set-Detail');
  await o.ruhig();
  return o;
}
const schreibend = o => o.aufrufe.filter(a => /\/alert(\?|$)/.test(a.url) && a.method !== 'GET');
const tippe = (o, wert) => {
  const f = o.d.getElementById('m-alert-val');
  f.value = wert;
  f.dispatchEvent(new o.w.Event('input', { bubbles: true }));
};

test('Webapp: beim Tippen gespeichert, entprellt mit der Ruhezeit der App', async () => {
  assert.ok(RUHE >= 300, `RUHE_MS der App nicht gefunden (${RUHE})`);
  const o = await detail();
  try {
    for (const w of ['2', '24', '249']) { tippe(o, w); await takt(RUHE / 4); }
    await takt(RUHE * 3 / 4 - 120);
    assert.deepEqual(schreibend(o), [], 'gespeichert, bevor die Ruhezeit um war');
    assert.ok(await warte(() => schreibend(o).length > 0, 400), 'nicht in der Ruhezeit der App gespeichert');
    await takt(RUHE);
    const [put, ...mehr] = schreibend(o);
    assert.equal(mehr.length, 0, `${mehr.length + 1} Schreibaufrufe statt einem`);
    assert.equal(put.method, 'PUT');
    assert.deepEqual(JSON.parse(put.body), { richtung: 'unter', schwelle: 249, condition: 'N' });
    assert.ok(await warte(() => o.d.getElementById('m-alert-state').textContent === de['detail.alert_fired']),
      `der Merker zeigt „${o.d.getElementById('m-alert-state').textContent}“`);
  } finally { o.w.close(); }
});

test('Webapp: ein leeres Feld löscht, ein Zustandswechsel lädt nur', async () => {
  const o = await detail({ [`/v1/sets/${SN}/alert`]: (_u, opt) => opt.method === 'DELETE' ? { success: true }
    : { success: true, alerts: [{ set_number: SN, condition: 'N', richtung: 'ueber', schwelle: 300, currency_code: 'EUR', ausgeloest: false }] } });
  try {
    assert.equal(o.d.getElementById('m-alert-dir').value, 'ueber');
    const zustand = o.d.getElementById('m-alert-cond');
    zustand.value = 'U';
    zustand.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await o.ruhig();
    assert.deepEqual(schreibend(o), [], 'ein Zustandswechsel schreibt');
    zustand.value = 'N';
    zustand.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await o.ruhig();
    tippe(o, '');
    assert.ok(await warte(() => schreibend(o).length === 1, RUHE + 1000), 'nichts gelöscht');
    assert.equal(schreibend(o)[0].method, 'DELETE');
    assert.match(schreibend(o)[0].url, /condition=N$/);
  } finally { o.w.close(); }
});

test('Webapp: offene Alarme — der erste Besuch merkt nur, danach die Meldung wie in der App', async () => {
  const JETZT = '2026-11-10T08:00:00.123Z';
  const offen = { success: true, now: JETZT, alerts: [{ set_number: SN, richtung: 'unter', schwelle: 200, zuletzt_preis: 199.5, currency_code: 'CHF' }] };
  const meldungen = o => [...o.d.querySelectorAll('#toasts > *')].map(t => t.textContent.trim());
  const erst = await oeffneOberflaeche({ '/v1/alerts/pending': offen });
  try {
    await erst.ruhig();
    const abruf = erst.aufrufe.filter(a => a.url.includes('/v1/alerts/pending'));
    assert.equal(abruf.length, 1, 'beim Öffnen nicht nachgefragt');
    assert.doesNotMatch(abruf[0].url, /since=/);
    assert.deepEqual(meldungen(erst).filter(m => m.includes(SN)), [], 'beim ersten Besuch gemeldet');
    assert.equal(erst.w.localStorage.getItem(`bim_alarm_marke_${ANMELDUNG['/v1/auth/me'].user.id}`), JETZT, 'nicht die Marke des Servers');
  } finally { erst.w.close(); }
  const dann = await oeffneOberflaeche({ '/v1/alerts/pending': offen },
    { vorher: w => w.localStorage.setItem(`bim_alarm_marke_${ANMELDUNG['/v1/auth/me'].user.id}`, '2026-11-09T08:00:00Z') });
  try {
    await dann.ruhig();
    assert.ok(dann.aufrufe.some(a => a.url.includes('/v1/alerts/pending?since=2026-11-09T08%3A00%3A00Z')));
    assert.ok(await warte(() => meldungen(dann).some(m => m.includes(SN))), 'keine Meldung');
    // Derselbe Aufbau wie Alarmabholung.text() der App: Währung des Alarms, zwei Stellen.
    assert.ok(meldungen(dann).includes(`${SN}: CHF 199.50 (${de['detail.alert_below']} CHF 200.00)`), meldungen(dann).join(' | '));
    const kt = ohneKommentare(KT_ABHOL);
    assert.match(kt, /a\.currencyCode/, 'Die App nimmt nicht die Währung des Alarms');
    assert.match(kt, /"%\.2f"/, 'Die App rundet nicht auf zwei Stellen');
  } finally { dann.w.close(); }
});

test('App: dieselben drei Endpunkte und dieselbe Abholung, ohne Kontofilter', () => {
  assert.match(KT_API, /@GET\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@PUT\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@DELETE\("api\/v1\/sets\/\{setNumber\}\/alert"\)/);
  assert.match(KT_API, /@GET\("api\/v1\/alerts\/pending"\)/, 'Die App fragt nicht nach');
  // Ein Alarm gehört einem Konto; ein Kontofilter wäre eine falsche Absicht.
  assert.doesNotMatch(KT_API.slice(KT_API.indexOf('getPreisalarme'), KT_API.indexOf('// ── Lagerort')), /@Query\("accounts"\)/);
});

test('App: ein leeres Feld löscht, gespeichert wird beim Tippen in der Ruhezeit des ViewModels', () => {
  const ohne = ohneKommentare;
  assert.match(KT_ALARMEINGABE, /return if \(z > 0\.0\) z else null/, 'Die App löscht bei leerem Feld nicht');
  assert.match(KT_FEAT, /if \(schwelle == null\)\s*\n?\s*sets\.deletePreisalarm/, 'Die App löscht bei leerem Feld nicht');
  assert.match(ohne(KT_SECT), /onValueChange = \{[\s\S]{0,400}?onSetze\(setNumber, richtung, (?!schwelle\b)\w+, zustand\)/,
    'Das Schwellenfeld der App hängt nicht am Tippen');
  assert.doesNotMatch(ohne(KT_SECT), /alarmFokus/, 'Die App speichert noch am Fokuswechsel');
  assert.match(KT_VM, /Preisalarmeingabe\(\s*\n?\s*scope = viewModelScope/, 'Der Auftrag hängt nicht mehr am ViewModel');
  assert.match(ohne(KT_FEAT), /job\?\.cancel\(\)\s*\n\s*job = scope\.launch/, 'Die Ruhezeit läuft nicht im übergebenen Scope');
  assert.doesNotMatch(ohne(KT_SECT), /LaunchedEffect\([^)]*schwelle/, 'Die Ruhezeit stirbt mit dem Bildschirm');
  assert.match(KT_VM, /val setNumber: String = gemerkt\[ARG_SET\]/, 'Das Set der Detailansicht kommt fest aus der Route');
});

test('App: Merker, wählbarer Zustand, Texte', () => {
  const kt = ohneKommentare(KT_SECT);
  assert.match(KT_SECT, /alarm\.ausgeloest\) R\.string\.detail_alert_fired/, 'Die App zeigt den Merker nicht');
  assert.match(kt, /var zustand by rememberSaveable/, 'Der App fehlt die Zustandswahl — oder sie übersteht keine Drehung');
  assert.match(kt, /R\.string\.condition_used/, 'Der App fehlt der Knopf für „gebraucht"');
  assert.match(kt, /onWahl = \{ zustand = it \}/, 'Der Zustandswechsel der App tut mehr als umschalten');
  assert.match(KT_WORKER, /R\.string\.detail_alert_below/, 'Die App erfindet eigene Richtungstexte');
  for (const [datei, s] of [['res/values/strings.xml', XML_EN], ['res/values-de/strings.xml', XML_DE]])
    for (const k of ['detail_alert', 'detail_alert_below', 'detail_alert_above', 'detail_alert_armed', 'detail_alert_fired',
                     'alert_channel_name', 'alert_channel_desc', 'alert_notify', 'alert_notify_hint'])
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
});

test('App: Abholen beim Nach-vorn-Kommen und stündlich, Marke vom Server, erster Durchgang still', () => {
  const act = ohneKommentare(lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'app', 'MainActivity.kt')));
  const i = act.indexOf('override fun onStart()');
  assert.ok(i > 0, 'Die App fragt nur im Hintergrund nach');
  assert.match(act.slice(i, i + 400), /(?:PreisalarmWorker|preisalarme)\.durchgang\(/, 'onStart() holt nicht ab.');
  assert.ok(!/override fun onCreate[\s\S]{0,600}?(?:PreisalarmWorker|preisalarme)\.durchgang\(/.test(act), 'Der Abruf hängt an onCreate');
  assert.match(KT_WORKER, /suspend fun durchgang\((?:context: Context)?\)/, 'Der gemeinsame Rumpf fehlt');
  const dw = KT_WORKER.slice(KT_WORKER.indexOf('override suspend fun doWork'));
  assert.match(dw.slice(0, 300), /durchgang\((?:applicationContext)?\)/, 'doWork() benutzt den gemeinsamen Rumpf nicht.');
  assert.match(KT_ABHOL, /antwort\.now\?\.takeIf/, 'Die App nimmt nicht den Zeitpunkt des Servers als Marke');
  assert.doesNotMatch(KT_ABHOL, /System\.currentTimeMillis|Instant\.now/, 'Die App nimmt ihre eigene Uhr');
  assert.match(KT_ABHOL, /if \(marke\.isNullOrBlank\(\)\) return Ergebnis\.Markiert/, 'Die App meldet beim ersten Durchgang');
});

test('App: der Abruf steht auf einer Stunde, ist abschaltbar und braucht die Berechtigung', () => {
  assert.match(KT_WORKER, /PeriodicWorkRequestBuilder<PreisalarmWorker>\(1, TimeUnit\.HOURS\)/, 'Das Intervall ist nicht eine Stunde');
  assert.match(KT_WORKER, /setRequiredNetworkType\(NetworkType\.CONNECTED\)/, 'Der Auftrag läuft auch ohne Netz an');
  assert.match(KT_WORKER, /ExistingPeriodicWorkPolicy\.KEEP/, 'Ein häufig geöffneter App verschiebt den Abruf endlos');
  assert.match(KT_EINST, /PreisalarmCard\(an, geraet::alarmMeldungen\)/, 'Der Schalter meldet den Wunsch nicht');
  assert.match(KT_GERAET, /fun alarmMeldungen\(an: Boolean\)[\s\S]{0,200}?planer\.einplanen\(an\)/, 'Der Schalter plant nicht ein');
  assert.match(KT_PLANER, /PreisalarmWorker\.einplanen\(context, an\)/, 'Der AlarmPlaner plant nicht ein');
  assert.match(KT_WORKER, /if \(!an\) \{ wm\.cancelUniqueWork\(NAME\); return@runCatching \}/, 'Ausschalten bestellt nicht ab');
  assert.match(KT_START, /PreisalarmWorker\s*\n?\s*\.einplanen\(this@BrickInventoryApp, true\)/, 'Nach einem Zurücksetzen käme nie wieder eine Meldung');
  assert.match(lies(path.join(APP, 'AndroidManifest.xml')), /android\.permission\.POST_NOTIFICATIONS/, 'Die Berechtigung fehlt im Manifest');
  assert.match(KT_WORKER, /checkSelfPermission/, 'Der Worker prüft die Berechtigung nicht');
});
