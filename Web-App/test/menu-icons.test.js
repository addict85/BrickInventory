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
const read = p => fs.readFileSync(p, 'utf8');

/**
 * The MAPPING — the only place where it stands.
 */
const MAPPING = [
  {
    web: 'settings.group.profile',
    icon: 'Person',
    symbol: 'i-profile',
  },
  {
    web: 'vouchers.group',
    icon: 'Gutschein',
    symbol: 'i-voucher',
  },
  {
    web: 'alerts.group',
    icon: 'Glocke',
    symbol: 'i-alert',
  },
  {
    web: 'storage.group',
    icon: 'Kiste',
    symbol: 'i-location',
  },
  {
    web: 'household.group',
    icon: 'Gruppe',
    symbol: 'i-household',
  },
  {
    web: 'settings.data_export',
    icon: 'Datei+Pfeil',
    symbol: 'i-data',
  },
  {
    web: 'nav.settings',
    icon: 'Zahnrad',
    symbol: 'i-settings',
  },
  {
    web: 'nav.monitoring',
    icon: 'Diagramm',
    symbol: 'i-monitoring',
  },
  {
    web: 'settings.logout',
    icon: 'Hinausgehen',
    symbol: 'i-logout',
  },
];

/** Entries that exist only on ONE side — explicitly, with a reason. */
const WEB_ONLY = {
  'menu.app': 'Der Verweis auf die Android-App. In der App selbst wäre er sinnlos.',
};

/** Web app: key → symbol ID of every menu entry, from the markup. */
function webMenu() {
  const html = withoutHtmlComments(read(path.join(ROOT, 'public', 'index.html')));
  const opened = html.indexOf('<div class="umenu-pop"');
  // Up to behind logout: the drawer is divided into groups, its first </div> only closes the first one.
  const closed = html.indexOf('</button>', html.indexOf('id="btn-logout"', opened)) + '</button>'.length;
  assert.ok(opened > 0 && closed > opened, 'The menu dropdown can no longer be found.');
  return [...html.slice(opened, closed).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => ({
    key: (/data-i18n="([^"]+)"/.exec(m[1]) || [])[1],
    symbol: (/<use href="#([\w-]+)"/.exec(m[1]) || [])[1],
  }));
}

test('every menu entry is assigned', () => {
  const web = webMenu();
  // Self-proof: if the derivation finds nothing, the loops would be silently green.
  assert.equal(web.length, 10, `${web.length} web entries derived instead of ten — does the derivation still work?`);

  const webTo = new Set(MAPPING.map(z => z.web));
  const openWeb = web.filter(e => !webTo.has(e.key) && !(e.key in WEB_ONLY));
  assert.deepEqual(
    openWeb.map(e => e.key),
    [],
    'These web entries are neither mapped nor justified as „nur Web". ' +
      'A new entry without a counterpart is a decision — it belongs in the table.',
  );
});

test('every entry carries its icon', () => {
  const web = new Map(webMenu().map(e => [e.key, e.symbol]));
  const wrong = [];
  for (const z of MAPPING) {
    if (!web.has(z.web)) {
      wrong.push(`${z.web}: fehlt im Web-Menü`);
      continue;
    }
    const symbol = web.get(z.web);
    if (symbol !== z.symbol) wrong.push(`${z.web} (${z.icon}): Web zeigt #${symbol} statt #${z.symbol}`);
  }
  assert.deepEqual(wrong, [], 'The menu no longer shows what the table says:\n  ' + wrong.join('\n  '));
});

test('no icon stands for two things', () => {
  // The measured finding of 17.10.: on the web 📦 stood for „Lagerorte" AND for
  // „Daten exportieren". In the app there had long been two symbols.
  const twice = (entries, name) => {
    const seen = new Map();
    for (const [key, chars] of entries) {
      if (seen.has(chars)) return `${name}: ${chars} steht für "${seen.get(chars)}" UND "${key}"`;
      seen.set(chars, key);
    }
    return null;
  };
  const w = twice(
    webMenu().map(e => [e.key, e.symbol]),
    'Webapp',
  );
  assert.deepEqual(
    [w].filter(Boolean),
    [],
    'One icon stands for two different things. Whoever sees it cannot tell the ' + 'two entries apart.',
  );
});
