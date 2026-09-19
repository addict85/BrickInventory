/**
 * Lagerort — dieselbe Antwort in beiden Oberflächen.
 *
 * Wie test/bauabgleich-beide.test.js und aus demselben Grund: Marcos stehende
 * Vorgabe ist „zwei saubere Apps, in den Oberflächen einheitliche Ansichten,
 * ansonsten identische Funktion". Eine Erweiterung, die nur in der Webapp
 * landet, verletzt sie — und das fällt erst auf, wenn jemand am Telefon danach
 * sucht.
 *
 * Geprüft wird die NAHT. Ob die Zahlen stimmen, beantwortet
 * test/lagerort-db.test.js gegen echte Daten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const APP = path.join(WEB, '..', 'Android-App', 'app', 'src', 'main');
const lies = p => fs.readFileSync(p, 'utf8');
const web  = rel => lies(path.join(WEB, rel));

// Jeder Pfad in den Android-Baum AUSGESCHRIEBEN — test/baumbruecken.test.js
// löst diese Brücken statisch auf und kann eine Variable nicht sehen.
const KT_API    = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'api', 'BrickApiService.kt'));
const KT_SCOPE  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'ScopeFilter.kt'));
const KT_HAUS   = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'HouseholdFeature.kt'));
const KT_DIALOG = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'dialogs', 'SetItemDetailDialog.kt'));
const KT_SETDET = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'SetDetailSections.kt'));
const KT_CHIPS  = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'HouseholdComposables.kt'));
const XML_EN    = lies(path.join(APP, 'res', 'values', 'strings.xml'));
const XML_DE    = lies(path.join(APP, 'res', 'values-de', 'strings.xml'));

test('beide Oberflächen setzen den Lagerort über dieselben Endpunkte', () => {
  const route = web('routes/api_v1/parts.ts') + web('routes/api_v1/sets.ts');
  assert.match(route, /router\.put\('\/parts\/:partNumber\/:colorId\/storage'/);
  assert.match(route, /router\.put\('\/sets\/:setNumber\/storage'/);
  assert.match(route, /router\.get\('\/storage'/);

  assert.match(web('public/js/13-acquisition-modals.js'), /\/storage`, \{ storage: el\.value \}/,
    'Die Webapp speichert den Lagerort eines Teils nicht');
  assert.match(web('public/js/07-admin.js'), /\/storage`, \{ storage: el\.value \}/,
    'Die Webapp speichert den Lagerort eines Sets nicht');

  assert.match(KT_API, /@PUT\("api\/v1\/parts\/\{partNumber\}\/\{colorId\}\/storage"\)/);
  assert.match(KT_API, /@PUT\("api\/v1\/sets\/\{setNumber\}\/storage"\)/);
  assert.match(KT_API, /@GET\("api\/v1\/storage"\)/);
});

test('beide zeigen den Lagerort dort, wo er hingehört', () => {
  // Set-Detail und Teil-Detail, in beiden Oberflächen. NICHT bei Figuren:
  // Eine Minifigur steckt in ihrem Set, und dessen Ort steht im Set-Detail —
  // ein zweiter Ort für dieselbe Sache wäre eine Stelle, an der zwei
  // Antworten auseinanderlaufen können.
  assert.match(web('public/js/07-admin.js'), /id="m-storage"/, 'Webapp: Set-Detail');
  assert.match(web('public/js/13-acquisition-modals.js'), /id="setitem-storage"/, 'Webapp: Teil-Detail');
  assert.match(KT_SETDET, /R\.string\.detail_storage/, 'App: Set-Detail');
  assert.match(KT_DIALOG, /LagerortFeld\(/, 'App: Teil-Detail');

  // Und in BEIDEN nur für Teile, nicht für Figuren.
  assert.match(web('public/js/13-acquisition-modals.js'), /if \(type === 'part'\) \{/,
    'Webapp: das Feld steht auch bei Figuren');
  assert.match(KT_DIALOG, /kopf\.colorId != null/,
    'App: das Feld steht auch bei Figuren (Figuren haben keine Farbe)');
});

test('beide filtern am Server, nicht im Gerät', () => {
  // Eine Kachelwand liesse sich im Klienten aussieben, die Gesamtzahl darunter
  // nicht. Dieselbe Begründung wie beim Kontofilter — und derselbe Weg.
  assert.match(web('utils/handlers/parts.ts'), /p\.storage = \$\$\{pi\+\+\}/,
    'Der Server filtert Teile nicht nach Lagerort');
  assert.match(web('utils/handlers/sets.ts'), /s\.storage = \$\$\{params\.length\}/,
    'Der Server filtert Sets nicht nach Lagerort');

  assert.match(web('public/js/14-scope.js'), /p\.set\('storage', m\)/,
    'Die Webapp schickt den Lagerort nicht mit');
  assert.match(KT_API, /@Query\("storage"\)/, 'Die App schickt den Lagerort nicht mit');
  assert.match(KT_SCOPE, /fun lagerAsQuery/, 'Der App fehlt die Umsetzung in den Parameter');
});

test('der Filter wird beim Anmelden zurückgesetzt — in beiden', () => {
  // Er liegt bewusst auf dem Gerät (Ansichtseinstellung). Genau das machte den
  // Kontofilter zur Falle: Er überlebte Abmelden und Anmelden, und die halbe
  // Sammlung schien verschwunden. Der Lagerortfilter erbt die Falle, wenn er
  // die Lösung nicht erbt.
  const js = web('public/js/14-scope.js');
  const fn = js.slice(js.indexOf('export function resetScopeModes'),
                      js.indexOf('export function addScopeParam'));
  assert.match(fn, /resetLagerModi\(\)/,
    'Die Webapp setzt den Lagerortfilter beim Anmelden nicht zurück');

  // Bis zum nächsten Doc-Kommentar statt einer festen Zeichenzahl: Der erste
  // Entwurf schnitt bei 400 Zeichen ab und lag damit GENAU auf der Grenze —
  // der Aufruf stand drin, die Prüfung war trotzdem rot. Eine Zahl, die man
  // beim Umformulieren eines Kommentars nachziehen muss, ist keine Grenze.
  const i = KT_SCOPE.indexOf('suspend fun resetAll');
  assert.ok(i > 0, 'resetAll nicht gefunden');
  const kt = KT_SCOPE.slice(i, KT_SCOPE.indexOf('\n    /**', i));
  assert.match(kt, /remove\(lagerKey\(view\)\)/,
    'Die App setzt den Lagerortfilter beim Anmelden nicht zurück');
});

test('eine gefilterte Antwort landet nicht im Speicher der vollen Liste', () => {
  // Die App legt die ungefilterte erste Seite ab. Fiele `storage` aus der
  // Bedingung, läge dort irgendwann der Inhalt EINER Kiste unter dem Schlüssel
  // der ganzen Sammlung — und der Reiter zeigte je nach Cache-Zustand mal
  // alles, mal eine Kiste. Genau dafür steht `accounts` dort schon.
  for (const [name, s] of [
    ['SetsRepository.kt', lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'repository', 'SetsRepository.kt'))],
    ['TeileRepository.kt', lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'data', 'repository', 'TeileRepository.kt'))],
  ]) {
    assert.match(s, /storage\.isNullOrBlank\(\)/,
      `${name}: der Lagerort fehlt in der Bedingung für „ungefiltert"`);
  }
});

test('beide Sprachen sind gepflegt — in beiden Oberflächen', () => {
  for (const datei of ['public/locales/de.js', 'public/locales/en.js']) {
    const s = web(datei);
    for (const k of ['detail.storage', 'detail.storage_ph', 'filter.storage_all']) {
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} fehlt`);
    }
  }
  for (const [datei, s] of [['res/values/strings.xml', XML_EN],
                            ['res/values-de/strings.xml', XML_DE]]) {
    for (const k of ['detail_storage', 'detail_storage_ph', 'filter_storage_all']) {
      assert.ok(s.includes(`name="${k}"`), `${datei}: ${k} fehlt`);
    }
  }
});

test('die Längengrenze steht in beiden Fassungen gleich', () => {
  // LAGERORT_MAX_ZEICHEN setzt sie durch, der Fehlertext nennt sie, und die
  // beiden Eingabefelder begrenzen schon beim Tippen. Vier Orte, eine Zahl —
  // dasselbe Vorgehen wie bei PASSWORT_MIN_ZEICHEN.
  const max = /LAGERORT_MAX_ZEICHEN = (\d+)/.exec(web('utils/lagerort.ts'))?.[1];
  assert.ok(max, 'LAGERORT_MAX_ZEICHEN nicht gefunden');
  assert.ok(web('utils/fehlerTexte.ts').includes(`höchstens ${max} Zeichen`),
    `Der Fehlertext nennt eine andere Zahl als ${max}`);
  assert.ok(web('public/index.html').includes(`maxlength="${max}"`) ||
            web('public/js/07-admin.js').includes(`maxlength="${max}"`),
    `Das Eingabefeld der Webapp begrenzt nicht auf ${max}`);
  assert.ok(KT_DIALOG.includes(`it.length <= ${max}`),
    `Das Eingabefeld der App begrenzt nicht auf ${max}`);
});

test('der Filter steht neben dem Kontofilter, nicht darunter', () => {
  // Zwei Fragen an dieselbe Liste („wessen" und „wo"), die sich frei
  // kombinieren lassen. Nebeneinander sieht man beide Antworten auf einen
  // Blick; untereinander sucht man die zweite.
  const html = web('public/index.html');
  for (const view of ['gallery', 'parts']) {
    const i = html.indexOf(`id="scope-${view}"`);
    const j = html.indexOf(`id="storage-${view}"`);
    assert.ok(i > 0 && j > i && j - i < 700,
      `Webapp/${view}: die beiden Filter stehen nicht beieinander`);
  }
  assert.match(KT_CHIPS, /LagerortFilterChip\(orte = lagerorte/,
    'Der App fehlt der Lagerortfilter in der Filterzeile');
  assert.match(KT_HAUS, /fun MainViewModel\.setLagerFilter/,
    'Der App fehlt das Umschalten');
});
