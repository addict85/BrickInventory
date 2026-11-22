/**
 * The menu at the top right: every entry with its icon (meant are the same ones as on
 * „Mehr“ in the app), none twice.
 *
 * ── Counter-checks (carried out, results copied) ────────────────────
 *
 *   A  „Daten" with #i-lagerort instead of #i-daten (the situation Marco reported,
 *      back then with 📦) → TWO cases red, and both rightly so:
 *        “every entry carries its icon”
 *        “no icon stands for two things”
 *   C  a web entry without an assignment added
 *      → only “every menu entry is assigned” red
 *
 * That A hits two cases is no flaw but the point: the duplicate
 * 📦 was at the same time a deviation FROM THE APP and an ambiguity
 * WITHIN the web app. Both should stand out, and each case says something
 * different about it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const withoutHtmlComments = require('./helpers/sources').withoutHtmlComments;
const lies = p => fs.readFileSync(p, 'utf8');

/**
 * The MAPPING — the only place where it stands.
 */
const MAPPING = [
  {
    web: 'settings.group.profile',
    sinnbild: 'Person',
    symbol: 'i-profile',
  },
  {
    web: 'vouchers.group',
    sinnbild: 'Gutschein',
    symbol: 'i-voucher',
  },
  {
    web: 'alerts.group',
    sinnbild: 'Glocke',
    symbol: 'i-alert',
  },
  {
    web: 'storage.group',
    sinnbild: 'Kiste',
    symbol: 'i-location',
  },
  {
    web: 'household.group',
    sinnbild: 'Gruppe',
    symbol: 'i-household',
  },
  {
    web: 'settings.data_export',
    sinnbild: 'Datei+Pfeil',
    symbol: 'i-data',
  },
  {
    web: 'nav.settings',
    sinnbild: 'Zahnrad',
    symbol: 'i-settings',
  },
  {
    web: 'nav.monitoring',
    sinnbild: 'Diagramm',
    symbol: 'i-monitoring',
  },
  {
    web: 'settings.logout',
    sinnbild: 'Hinausgehen',
    symbol: 'i-logout',
  },
];

/** Entries that exist only on ONE side — explicitly, with a reason. */
const NUR_WEB = {
  'menu.app': 'Der Verweis auf die Android-App. In der App selbst wäre er sinnlos.',
};

/** Web app: key → symbol ID of every menu entry, from the markup. */
function webMenu() {
  const html = withoutHtmlComments(lies(path.join(ROOT, 'public', 'index.html')));
  const auf = html.indexOf('<div class="umenu-pop"');
  // Up to behind logout: the drawer is divided into groups, its first </div> only closes the first one.
  const zu = html.indexOf('</button>', html.indexOf('id="btn-logout"', auf)) + '</button>'.length;
  assert.ok(auf > 0 && zu > auf, 'Die Menüklappe ist nicht mehr zu finden.');
  return [...html.slice(auf, zu).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => ({
    schluessel: (/data-i18n="([^"]+)"/.exec(m[1]) || [])[1],
    symbol: (/<use href="#([\w-]+)"/.exec(m[1]) || [])[1],
  }));
}

test('every menu entry is assigned', () => {
  const web = webMenu();
  // Self-proof: if the derivation finds nothing, the loops would be silently green.
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
  // The measured finding of 17.10.: on the web 📦 stood for „Lagerorte" AND for
  // „Daten exportieren". In the app there had long been two symbols.
  const doppelt = (entries, name) => {
    const gesehen = new Map();
    for (const [schluessel, zeichen] of entries) {
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
