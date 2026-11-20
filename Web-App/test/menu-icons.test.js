/**
 * Das Menü oben rechts: jeder Eintrag mit seinem Sinnbild (gemeint sind dieselben wie auf
 * „Mehr“ in der App), keines doppelt.
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 *   A  „Daten" mit #i-lagerort statt #i-daten (die Lage, die Marco gemeldet
 *      hat, damals mit 📦) → ZWEI Fälle rot, und beide zu Recht:
 *        „jeder Eintrag trägt sein Sinnbild"
 *        „kein Sinnbild steht für zwei Dinge"
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

const withoutHtmlComments = require('./helpers/sources').withoutHtmlComments;
const lies = p => fs.readFileSync(p, 'utf8');

/**
 * Die MAPPING — die einzige Stelle, an der sie steht.
 */
const MAPPING = [
  {
    web: 'settings.group.profile',
    sinnbild: 'Person',
    symbol: 'i-profil',
  },
  {
    web: 'vouchers.group',
    sinnbild: 'Gutschein',
    symbol: 'i-gutschein',
  },
  {
    web: 'alerts.group',
    sinnbild: 'Glocke',
    symbol: 'i-alarm',
  },
  {
    web: 'storage.group',
    sinnbild: 'Kiste',
    symbol: 'i-lagerort',
  },
  {
    web: 'household.group',
    sinnbild: 'Gruppe',
    symbol: 'i-haushalt',
  },
  {
    web: 'settings.data_export',
    sinnbild: 'Datei+Pfeil',
    symbol: 'i-daten',
  },
  {
    web: 'nav.settings',
    sinnbild: 'Zahnrad',
    symbol: 'i-einstellungen',
  },
  {
    web: 'nav.monitoring',
    sinnbild: 'Diagramm',
    symbol: 'i-monitoring',
  },
  {
    web: 'settings.logout',
    sinnbild: 'Hinausgehen',
    symbol: 'i-abmelden',
  },
];

/** Einträge, die es nur auf EINER Seite gibt — ausdrücklich, mit Grund. */
const NUR_WEB = {
  'menu.app': 'Der Verweis auf die Android-App. In der App selbst wäre er sinnlos.',
};

/** Webapp: Schlüssel → Symbol-ID jedes Menüeintrags, aus dem Markup. */
function webMenu() {
  const html = withoutHtmlComments(lies(path.join(ROOT, 'public', 'index.html')));
  const auf = html.indexOf('<div class="umenu-pop"');
  // Bis hinter Abmelden: Die Klappe gliedert sich in Gruppen, ihr erstes </div> schliesst nur die erste.
  const zu = html.indexOf('</button>', html.indexOf('id="btn-logout"', auf)) + '</button>'.length;
  assert.ok(auf > 0 && zu > auf, 'Die Menüklappe ist nicht mehr zu finden.');
  return [...html.slice(auf, zu).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => ({
    schluessel: (/data-i18n="([^"]+)"/.exec(m[1]) || [])[1],
    symbol: (/<use href="#([\w-]+)"/.exec(m[1]) || [])[1],
  }));
}

test('every menu entry is assigned', () => {
  const web = webMenu();
  // Selbstbeweis: Findet die Ableitung nichts, wären die Schleifen still grün.
  assert.equal(web.length, 10, `${web.length} Web-Einträge abgeleitet statt zehn — greift die Ableitung noch?`);

  const webZu = new Set(MAPPING.map(z => z.web));
  const openWeb = web.filter(e => !webZu.has(e.schluessel) && !(e.schluessel in NUR_WEB));
  assert.deepEqual(
    openWeb.map(e => e.schluessel),
    [],
    'Diese Web-Einträge sind weder zugeordnet noch als „nur Web" begründet. ' +
      'Ein neuer Eintrag ohne Gegenstück ist eine Entscheidung — sie gehört in die Tabelle.',
  );
});

test('every entry carries its icon', () => {
  const web = new Map(webMenu().map(e => [e.schluessel, e.symbol]));
  const falsch = [];
  for (const z of MAPPING) {
    if (!web.has(z.web)) {
      falsch.push(`${z.web}: fehlt im Web-Menü`);
      continue;
    }
    const symbol = web.get(z.web);
    if (symbol !== z.symbol) falsch.push(`${z.web} (${z.sinnbild}): Web zeigt #${symbol} statt #${z.symbol}`);
  }
  assert.deepEqual(falsch, [], 'Das Menü zeigt nicht mehr, was die Tabelle sagt:\n  ' + falsch.join('\n  '));
});

test('no icon stands for two things', () => {
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
    webMenu().map(e => [e.schluessel, e.symbol]),
    'Webapp',
  );
  assert.deepEqual(
    [w].filter(Boolean),
    [],
    'Ein Sinnbild steht für zwei verschiedene Dinge. Wer es sieht, kann die ' +
      'beiden Einträge nicht auseinanderhalten.',
  );
});
