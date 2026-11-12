/**
 * Das Menü oben rechts trägt in BEIDEN Oberflächen dieselben Symbole.
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
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main');

const ohneHtmlKommentare = require('./helpers/sources').ohneHtmlKommentare;
const lies = p => fs.readFileSync(p, 'utf8');

/**
 * Die ZUORDNUNG — die einzige Stelle, an der sie steht.
 */
const ZUORDNUNG = [
  {
    web: 'settings.group.profile',
    app: 'konto_title',
    sinnbild: 'Person',
    symbol: 'i-profil',
    vektor: 'Icons.Outlined.AccountCircle',
  },
  {
    web: 'vouchers.group',
    app: 'vouchers_title',
    sinnbild: 'Gutschein',
    symbol: 'i-gutschein',
    vektor: 'Icons.Outlined.Redeem',
  },
  {
    web: 'alerts.group',
    app: 'alerts_group',
    sinnbild: 'Glocke',
    symbol: 'i-alarm',
    vektor: 'Icons.Outlined.NotificationsActive',
  },
  {
    web: 'storage.group',
    app: 'storage_manage',
    sinnbild: 'Kiste',
    symbol: 'i-lagerort',
    vektor: 'Icons.Outlined.Inventory2',
  },
  {
    web: 'household.group',
    app: 'household_title',
    sinnbild: 'Gruppe',
    symbol: 'i-haushalt',
    vektor: 'Icons.Outlined.Group',
  },
  {
    web: 'settings.data_export',
    app: 'csv_upload_title',
    sinnbild: 'Datei+Pfeil',
    symbol: 'i-daten',
    vektor: 'Icons.Outlined.UploadFile',
  },
  {
    web: 'nav.settings',
    app: 'nav_settings',
    sinnbild: 'Zahnrad',
    symbol: 'i-einstellungen',
    vektor: 'Icons.Outlined.Settings',
  },
  {
    web: 'nav.monitoring',
    app: 'main_menu_monitoring',
    sinnbild: 'Diagramm',
    symbol: 'i-monitoring',
    vektor: 'Icons.Outlined.Assessment',
  },
  {
    web: 'settings.logout',
    app: 'main_menu_logout',
    sinnbild: 'Hinausgehen',
    symbol: 'i-abmelden',
    vektor: 'Icons.AutoMirrored.Outlined.Logout',
  },
];

/** Einträge, die es nur auf EINER Seite gibt — ausdrücklich, mit Grund. */
const NUR_WEB = {
  'menu.app': 'Der Verweis auf die Android-App. In der App selbst wäre er sinnlos.',
};
const NUR_APP = {
  nav_comparison: 'In der Webapp ein eigener Reiter; die untere Leiste der App hat nur Platz für fünf.',
  nav_partslist: 'In der Webapp ein eigener Reiter; in der App steht die Bauliste auf „Mehr“.',
};

/** Webapp: Schlüssel → Symbol-ID jedes Menüeintrags, aus dem Markup. */
function webMenue() {
  const html = ohneHtmlKommentare(lies(path.join(ROOT, 'public', 'index.html')));
  const auf = html.indexOf('<div class="umenu-pop"');
  // Bis hinter Abmelden: Die Klappe gliedert sich in Gruppen, ihr erstes </div> schliesst nur die erste.
  const zu = html.indexOf('</button>', html.indexOf('id="btn-logout"', auf)) + '</button>'.length;
  assert.ok(auf > 0 && zu > auf, 'Die Menüklappe ist nicht mehr zu finden.');
  return [...html.slice(auf, zu).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => ({
    schluessel: (/data-i18n="([^"]+)"/.exec(m[1]) || [])[1],
    symbol: (/<use href="#([\w-]+)"/.exec(m[1]) || [])[1],
  }));
}

/** App: R.string-Schlüssel → Symbol, in der Reihenfolge der Seite „Mehr“. */
function appMenue() {
  const kt = lies(path.join(APP, 'java', 'ch', 'brickinventoryapp', 'app', 'MehrBildschirm.kt')).split(
    'fun MehrBildschirm(',
  )[1];
  assert.ok(kt, 'Die Seite „Mehr“ ist nicht mehr zu finden.');
  return [...kt.matchAll(/MehrEintrag\(R\.string\.(\w+),\s*([\w.]+)[,)]/g)].map(m => ({
    schluessel: m[1],
    symbol: m[2],
  }));
}

test('jeder Menüeintrag ist zugeordnet — auf beiden Seiten', () => {
  const web = webMenue();
  const app = appMenue();
  // Selbstbeweis: Findet die Ableitung nichts, wären die Schleifen still grün.
  assert.equal(web.length, 10, `${web.length} Web-Einträge abgeleitet statt zehn — greift die Ableitung noch?`);
  assert.equal(app.length, 11, `${app.length} App-Einträge abgeleitet statt elf — greift die Ableitung noch?`);

  const webZu = new Set(ZUORDNUNG.map(z => z.web));
  const appZu = new Set(ZUORDNUNG.map(z => z.app));
  const offenWeb = web.filter(e => !webZu.has(e.schluessel) && !(e.schluessel in NUR_WEB));
  const offenApp = app.filter(e => !appZu.has(e.schluessel) && !(e.schluessel in NUR_APP));
  assert.deepEqual(
    offenWeb.map(e => e.schluessel),
    [],
    'Diese Web-Einträge sind weder zugeordnet noch als „nur Web" begründet. ' +
      'Ein neuer Eintrag ohne Gegenstück ist eine Entscheidung — sie gehört in die Tabelle.',
  );
  assert.deepEqual(
    offenApp.map(e => e.schluessel),
    [],
    'Diese App-Einträge sind weder zugeordnet noch als „nur App" begründet.',
  );
});

test('jeder Eintrag trägt beiderseits dasselbe Sinnbild', () => {
  const web = new Map(webMenue().map(e => [e.schluessel, e.symbol]));
  const app = new Map(appMenue().map(e => [e.schluessel, e.symbol]));
  const falsch = [];
  for (const z of ZUORDNUNG) {
    if (!web.has(z.web)) {
      falsch.push(`${z.web}: fehlt im Web-Menü`);
      continue;
    }
    const symbol = web.get(z.web);
    if (symbol !== z.symbol) falsch.push(`${z.web} (${z.sinnbild}): Web zeigt #${symbol} statt #${z.symbol}`);
    const sym = app.get(z.app);
    if (sym === undefined) {
      falsch.push(`${z.app}: fehlt im App-Menü`);
      continue;
    }
    if (sym !== z.vektor) falsch.push(`${z.app} (${z.sinnbild}): App zeigt ${sym} statt ${z.vektor}`);
  }
  assert.deepEqual(
    falsch,
    [],
    'Die beiden Menüs zeigen nicht mehr dasselbe:\n  ' +
      falsch.join('\n  ') +
      '\n\nBuchstäblich gleich können Web- und Material-Symbol nie sein — gleich ' +
      'ist das GEMEINTE. Wer eines ändert, ändert beide, oder die Tabelle.',
  );
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
  const w = doppelt(
    webMenue().map(e => [e.schluessel, e.symbol]),
    'Webapp',
  );
  const a = doppelt(
    appMenue().map(e => [e.schluessel, e.symbol]),
    'App',
  );
  assert.deepEqual(
    [w, a].filter(Boolean),
    [],
    'Ein Sinnbild steht für zwei verschiedene Dinge. Wer es sieht, kann die ' +
      'beiden Einträge nicht auseinanderhalten — und die andere Oberfläche ' +
      'unterscheidet sie sehr wohl.',
  );
});
