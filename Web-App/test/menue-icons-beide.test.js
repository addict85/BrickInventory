/**
 * Das Menü oben rechts trägt in BEIDEN Oberflächen dieselben Symbole.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * 17.10.: „Bitte sicherstellen dass in der Webapp und der Android-App im Menü
 * oben rechts die gleichen Icons verwendet werden."
 *
 * ── Was dabei NICHT geht, und warum es trotzdem eine Prüfung gibt ───────────
 *
 * Buchstäblich dieselben Zeichen können es nicht sein: Die Webapp zeichnet
 * ihre eigene Symbolfamilie (das Sprite in index.html), die App
 * Material-Symbole. `#i-gutschein` und `Icons.Default.Redeem` sind
 * verschiedene Dateien aus verschiedenen Systemen — gleich ist das GEMEINTE.
 * (Bis zum 25.10. stand im Web ein Emoji im Sprachtext; die Tabelle hält
 * seither die Symbol-IDs.)
 *
 * Genau deshalb braucht es hier eine Tabelle und keine Gleichheitsprüfung:
 * Die Zuordnung „welcher Eintrag trägt welches Sinnbild" ist eine
 * Entscheidung, und eine Entscheidung, die nirgends steht, läuft auseinander.
 * Sie stand bisher nirgends — und war auseinandergelaufen:
 *
 *     GEMESSEN am 17.10.: Die Webapp benutzte 📦 ZWEIMAL — für „Lagerorte"
 *     und für „Daten exportieren". In der App sind das `Inventory2` und
 *     `UploadFile`, also zwei verschiedene Sinnbilder. Im Web war derselbe
 *     Karton einmal ein Lagerort und einmal ein Datenpaket.
 *
 * ── Warum die Prüfung hier liegt und nicht in der App ───────────────────────
 *
 * Dieselbe Entscheidung wie bei test/lagerort-beide.test.js und
 * test/preisalarm-beide.test.js: Eine Zusicherung über BEIDE Oberflächen
 * gehört an EINE Stelle, sonst gibt es sie zweimal und die beiden Fassungen
 * driften. Die Web-Suite läuft hier und kann die Kotlin-Quellen mitlesen; die
 * App-Tests können das umgekehrt nicht.
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 *   A  „Daten" mit #i-lagerort statt #i-daten (die Lage, die Marco gemeldet
 *      hat, damals mit 📦) → ZWEI Fälle rot, und beide zu Recht:
 *        „jeder Eintrag trägt beiderseits dasselbe Sinnbild"
 *        „kein Sinnbild steht für zwei Dinge"
 *   B  in der App `Redeem` durch `Star` ersetzt
 *      → nur „jeder Eintrag trägt beiderseits dasselbe Sinnbild" rot
 *   C  einen Web-Eintrag ohne Zuordnung hinzugefügt
 *      → nur „jeder Menüeintrag ist zugeordnet" rot
 *
 * Dass A zwei Fälle trifft, ist kein Mangel, sondern der Punkt: Das doppelte
 * 📦 war gleichzeitig eine Abweichung ZUR APP und eine Doppeldeutigkeit
 * INNERHALB der Webapp. Beides soll auffallen, und jeder Fall sagt etwas
 * anderes dazu.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main');

const ohneHtmlKommentare = s => s.replace(/<!--[\s\S]*?-->/g, '');
const lies = p => fs.readFileSync(p, 'utf8');

/**
 * Die ZUORDNUNG — die einzige Stelle, an der sie steht.
 *
 * `web` ist der i18n-Schlüssel der Webapp, `app` der R.string-Schlüssel der
 * App, `sinnbild` das, was beide zeigen sollen, und `glyph`/`vektor` die
 * vereinbarten Zeichen.
 *
 * Einstellungen und Monitoring stehen in der App IM Menü, in der Webapp als
 * REITER. Sie sind trotzdem hier, denn Marcos Frage gilt dem, was man oben
 * rechts sieht — und ein Zahnrad soll in beiden Oberflächen ein Zahnrad sein.
 */
const ZUORDNUNG = [
  { web: 'settings.group.profile', app: 'konto_title',          sinnbild: 'Person',       symbol: 'i-profil',        vektor: 'Icons.Default.AccountCircle' },
  { web: 'vouchers.group',         app: 'vouchers_title',       sinnbild: 'Gutschein',    symbol: 'i-gutschein',     vektor: 'Icons.Default.Redeem' },
  { web: 'alerts.group',           app: 'alerts_group',         sinnbild: 'Glocke',       symbol: 'i-alarm',         vektor: 'Icons.Default.NotificationsActive' },
  { web: 'storage.group',          app: 'storage_manage',       sinnbild: 'Kiste',        symbol: 'i-lagerort',      vektor: 'Icons.Default.Inventory2' },
  { web: 'household.group',        app: 'household_title',      sinnbild: 'Gruppe',       symbol: 'i-haushalt',      vektor: 'Icons.Default.Group' },
  { web: 'settings.data_export',   app: 'csv_upload_title',     sinnbild: 'Datei+Pfeil',  symbol: 'i-daten',         vektor: 'Icons.Default.UploadFile' },
  { web: 'nav.settings',           app: 'nav_settings',         sinnbild: 'Zahnrad',      symbol: 'i-einstellungen', vektor: 'Icons.Default.Settings' },
  { web: 'nav.monitoring',         app: 'main_menu_monitoring', sinnbild: 'Diagramm',     symbol: 'i-monitoring',    vektor: 'Icons.Default.Assessment' },
  { web: 'settings.logout',        app: 'main_menu_logout',     sinnbild: 'Hinausgehen',  symbol: 'i-abmelden',      vektor: 'Icons.AutoMirrored.Filled.Logout' },
];

/** Einträge, die es nur auf EINER Seite gibt — ausdrücklich, mit Grund. */
const NUR_WEB = {
  'menu.app': 'Der Verweis auf die Android-App. In der App selbst wäre er sinnlos.',
};
const NUR_APP = {};

/** Webapp: Schlüssel → Symbol-ID jedes Menüeintrags, aus dem Markup. */
function webMenue() {
  const html = ohneHtmlKommentare(lies(path.join(ROOT, 'public', 'index.html')));
  const auf = html.indexOf('<div class="umenu-pop"');
  const zu = html.indexOf('</div>', auf);
  assert.ok(auf > 0 && zu > auf, 'Die Menüklappe ist nicht mehr zu finden.');
  return [...html.slice(auf, zu).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => ({
    schluessel: (/data-i18n="([^"]+)"/.exec(m[1]) || [])[1],
    symbol: (/<use href="#([\w-]+)"/.exec(m[1]) || [])[1],
  }));
}

/** App: R.string-Schlüssel → Symbol, in der Reihenfolge der Klappe. */
function appMenue() {
  const kt = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'MainScaffold.kt'))
    .split('DropdownMenu(showLogoutMenu')[1];
  assert.ok(kt, 'Die Konto-Klappe ist nicht mehr zu finden.');
  const aus = [...kt.matchAll(/MenuZiel\(R\.string\.(\w+),\s*([\w.]+)\)/g)]
    .map(m => ({ schluessel: m[1], symbol: m[2] }));
  // Die drei älteren Einträge sind ausgeschriebene DropdownMenuItem.
  for (const m of kt.matchAll(/stringResource\(R\.string\.(\w+)\)\)\s*\}[\s\S]{0,900}?leadingIcon\s*=\s*\{\s*Icon\(([\w.]+),/g)) {
    aus.push({ schluessel: m[1], symbol: m[2] });
  }
  return aus;
}

test('jeder Menüeintrag ist zugeordnet — auf beiden Seiten', () => {
  const web = webMenue();
  const app = appMenue();
  // Selbstbeweis: Findet die Ableitung nichts, wären die Schleifen still grün.
  assert.equal(web.length, 10, `${web.length} Web-Einträge abgeleitet statt zehn — greift die Ableitung noch?`);
  assert.equal(app.length, 9, `${app.length} App-Einträge abgeleitet statt neun — greift die Ableitung noch?`);

  const webZu = new Set(ZUORDNUNG.map(z => z.web));
  const appZu = new Set(ZUORDNUNG.map(z => z.app));
  const offenWeb = web.filter(e => !webZu.has(e.schluessel) && !(e.schluessel in NUR_WEB));
  const offenApp = app.filter(e => !appZu.has(e.schluessel) && !(e.schluessel in NUR_APP));
  assert.deepEqual(offenWeb.map(e => e.schluessel), [],
    'Diese Web-Einträge sind weder zugeordnet noch als „nur Web" begründet. ' +
    'Ein neuer Eintrag ohne Gegenstück ist eine Entscheidung — sie gehört in die Tabelle.');
  assert.deepEqual(offenApp.map(e => e.schluessel), [],
    'Diese App-Einträge sind weder zugeordnet noch als „nur App" begründet.');
});

test('jeder Eintrag trägt beiderseits dasselbe Sinnbild', () => {
  const web = new Map(webMenue().map(e => [e.schluessel, e.symbol]));
  const app = new Map(appMenue().map(e => [e.schluessel, e.symbol]));
  const falsch = [];
  for (const z of ZUORDNUNG) {
    if (!web.has(z.web)) { falsch.push(`${z.web}: fehlt im Web-Menü`); continue; }
    const symbol = web.get(z.web);
    if (symbol !== z.symbol) falsch.push(`${z.web} (${z.sinnbild}): Web zeigt #${symbol} statt #${z.symbol}`);
    const sym = app.get(z.app);
    if (sym === undefined) { falsch.push(`${z.app}: fehlt im App-Menü`); continue; }
    if (sym !== z.vektor) falsch.push(`${z.app} (${z.sinnbild}): App zeigt ${sym} statt ${z.vektor}`);
  }
  assert.deepEqual(falsch, [],
    'Die beiden Menüs zeigen nicht mehr dasselbe:\n  ' + falsch.join('\n  ') +
    '\n\nBuchstäblich gleich können Web- und Material-Symbol nie sein — gleich ' +
    'ist das GEMEINTE. Wer eines ändert, ändert beide, oder die Tabelle.');
});

test('kein Sinnbild steht für zwei Dinge', () => {
  // Der gemessene Befund vom 17.10.: 📦 stand im Web für „Lagerorte" UND für
  // „Daten exportieren". In der App waren es längst zwei Symbole.
  const doppelt = (eintraege, name) => {
    const gesehen = new Map();
    for (const [schluessel, zeichen] of eintraege) {
      if (gesehen.has(zeichen)) return `${name}: ${zeichen} steht für "${gesehen.get(zeichen)}" UND "${schluessel}"`;
      gesehen.set(zeichen, schluessel);
    }
    return null;
  };
  const w = doppelt(webMenue().map(e => [e.schluessel, e.symbol]), 'Webapp');
  const a = doppelt(appMenue().map(e => [e.schluessel, e.symbol]), 'App');
  assert.deepEqual([w, a].filter(Boolean), [],
    'Ein Sinnbild steht für zwei verschiedene Dinge. Wer es sieht, kann die ' +
    'beiden Einträge nicht auseinanderhalten — und die andere Oberfläche ' +
    'unterscheidet sie sehr wohl.');
});
