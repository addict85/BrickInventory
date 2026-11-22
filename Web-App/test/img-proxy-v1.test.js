/**
 * The image proxy has moved to /api/v1 — everywhere, also in the data.
 * Address building and server run for real; that the old address is built
 * nowhere (web; the app via shared/app-schnittstelle.json) and the migration covers every
 * table stays structure.
 *
 * Counter-checks (measured 10.11.2026, dist rebuilt):
 *   A  in routes/imgProxy.ts the line app.get(IMG_PROXY_PATH_LEGACY, …) removed
 *      → red: “the server serves both addresses” (404)
 *   B  proxyImageUrl builds IMG_PROXY_PATH_LEGACY → red: “built addresses …” (the
 *      source text rule below does not see the constant, only strings)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);
const NEU = '/api/v1/img-proxy';
const ALT = '/api/img-proxy';

const ohneKommentare = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--|\*).*$/gm, '');

const lies = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('built addresses take the new form, the old one is still recognized', () => {
  const { proxyImageUrl, isProxyPath } = _req('src/images/images.js');
  const cdn = 'https://cdn.rebrickable.com/media/sets/10305-1.jpg';
  assert.equal(proxyImageUrl(cdn), `${NEU}?url=${encodeURIComponent(cdn)}`);
  assert.equal(isProxyPath(`${ALT}?url=x`), true, 'gespeicherte alte Adressen gelten nicht mehr als Proxy');
  assert.equal(isProxyPath(`${NEU}?url=x`), true);
});

test('the server serves both addresses', async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  // Older app versions assemble the old address themselves.
  const app = require('express')();
  app.use((req, _res, next) => {
    Object.assign(req, { session: { userId: 1 } });
    next();
  });
  _req('routes/imgProxy.js').registerImgProxy(app, require('./helpers/sources').testServices());
  const srv = app.listen(0);
  t.after(() => srv.close());
  const status = p =>
    fetch(`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}${p}`).then(
      r => r.status,
    );
  // Both answer like the proxy (rejected without a valid account), an unknown address with 404.
  const [neu, alt, fremd] = [await status(NEU), await status(ALT), await status('/api/v2/img-proxy')];
  assert.equal(fremd, 404);
  assert.notEqual(neu, 404, 'die neue Adresse ist nicht angemeldet');
  assert.equal(alt, neu, 'die alte Adresse antwortet anders als die neue');
});

test('only the new address is built', () => {
  // The old path may ONLY occur as a constant definition — nowhere as a
  // composed address. Checked in the server tree AND in the browser tree.
  const dateien = [];
  const lauf = (d, extension) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|locales/.test(p)) lauf(p, extension);
        continue;
      }
      if (e.name.endsWith(extension) && e.name !== 'app.bundle.js')
        dateien.push([path.relative(ROOT, p), ohneKommentare(fs.readFileSync(p, 'utf8'))]);
    }
  };
  for (const ordner of ['routes', 'src', 'jobs']) lauf(path.join(ROOT, ordner), '.ts');
  lauf(path.join(ROOT, 'public', 'js'), '.js');
  dateien.push(['server.ts', ohneKommentare(lies(ROOT, 'server.ts'))]);
  assert.ok(dateien.length >= 30, `Nur ${dateien.length} Quelldateien gefunden`);

  const gebaut = [];
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(new RegExp(`['"\`]${ALT}[^'"\`]*['"\`]`, 'g'))) {
      // The two definitions of the phase-out constant are the one allowed place.
      const zeile = src.slice(0, m.index).split('\n').pop();
      if (/IMG_PROXY_(PATH_)?LEGACY\s*=/.test(zeile)) continue;
      gebaut.push(`${rel}: ${m[0]}`);
    }
  assert.deepEqual(
    gebaut.sort(),
    [],
    'Diese Stellen bauen noch die alte Proxy-Adresse:\n  ' +
      gebaut.join('\n  ') +
      `\nGebaut wird ${NEU}; die alte wird nur noch ERKANNT (isProxyPath) und ` +
      'vom Server weiterhin bedient.',
  );
});

/** The app need not recognize the old one: a stored path is only completed with the server address. */
test('the app builds the new address and nowhere the old one', () => {
  // Addresses built by hand by the app (shared/app-schnittstelle.json, generated from its source text).
  const { adressen } = require('./helpers/contract').appSchnittstelle();
  assert.ok(adressen.includes(NEU), `Die App baut ${NEU} nicht (gefunden: ${adressen.join(', ')})`);
  assert.deepEqual(
    adressen.filter(a => a === ALT || a.startsWith(`${ALT}?`)),
    [],
    `Gebaut wird ${NEU}; eine installierte ältere Fassung bedient der Server weiterhin.`,
  );
});

test('the migration covers EVERY table with image_url', () => {
  // The table list is READ from the schema, not copied: an
  // eighth table with image_url should stand out, not slip through.
  // The tables with image_url that existed BEFORE 0014 — read from the
  // schema before db/base.sql. 0014 is …
  const tabellen = [
    'sets',
    'set_catalog',
    'set_parts_catalog',
    'set_minifigs_catalog',
    'parts',
    'catalog_cache',
    'minifigs',
  ];
  // MEASURED there are seven.
  assert.ok(tabellen.length >= 5, `Nur ${tabellen.length} Tabellen mit image_url gefunden — Muster veraltet?`);

  // Without comments: the explanatory text of this migration NAMES the pattern
  // `LIKE '%…%'` it decides against — and the check below
  // promptly tripped over it. The same trap helpers/sources.js warns about.
  const mig = ohneKommentare(lies(ROOT, 'db/migrations/0014-img-proxy-nach-v1.sql'));
  const fehlend = tabellen.filter(t => !new RegExp(`UPDATE\\s+${t}\\s`).test(mig)).sort();
  assert.deepEqual(
    fehlend,
    [],
    'Diese Tabellen tragen image_url, die Migration fasst sie nicht an:\n  ' +
      fehlend.join('\n  ') +
      '\nSonst bleiben dort Adressen in der alten Form stehen.',
  );

  // Tables that did not exist yet at migration 0014
  const umgeschrieben = [...mig.matchAll(/UPDATE\s+(\w+)\s/g)].map(m => m[1]);
  assert.ok(umgeschrieben.length >= 5, `Nur ${umgeschrieben.length} UPDATE-Ziele in 0014 gefunden — Muster veraltet?`);

  const migDir = path.join(ROOT, 'db/migrations');
  const spaeter = fs
    .readdirSync(migDir)
    .filter(f => f.endsWith('.sql') && f > '0014')
    .sort();
  const stragglers = [];
  for (const f of spaeter) {
    const txt = ohneKommentare(lies(ROOT, 'db/migrations', f));
    for (const m of txt.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)\s*\(([^;]*?)\)\s*;/gs)) {
      if (/^\s*image_url\s/m.test(m[2])) stragglers.push([m[1], f, txt]);
    }
  }
  assert.ok(
    stragglers.length >= 2,
    `Nur ${stragglers.length} spaetere Tabellen mit image_url gefunden ` +
      '(gemessen sind es zwei: part_color_catalog und minifigs_catalog) — Muster veraltet?',
  );

  // A valid source is also a later table that itself reads from such a one.
  const quellen = new Set(umgeschrieben);
  const liestAusQuelle = (tab, txt) => {
    // The INSERT that fills this table, and what it reads from.
    const bloecke = [
      ...txt.matchAll(
        new RegExp(
          `INSERT\\s+INTO\\s+${tab}\\s*\\([^)]*image_url[^)]*\\)([\\s\\S]*?)(?=INSERT\\s+INTO|ALTER\\s+TABLE|CREATE\\s|\\$sql\\$|$)`,
          'gi',
        ),
      ),
    ];
    return bloecke.some(b => [...quellen].some(q => new RegExp(`FROM\\s+${q}\\b`, 'i').test(b[1])));
  };
  for (let neu = true; neu; ) {
    neu = false;
    for (const [tab, , txt] of stragglers)
      if (!quellen.has(tab) && liestAusQuelle(tab, txt)) {
        quellen.add(tab);
        neu = true;
      }
  }
  const withoutOrigin = stragglers
    .filter(([tab]) => !quellen.has(tab))
    .map(([tab, f]) => `${tab} (${f})`)
    .sort();
  assert.deepEqual(
    withoutOrigin,
    [],
    'Diese Tabellen tragen image_url, entstehen NACH Migration 0014 und ' +
      'bekommen ihre Adressen nicht aus einer Tabelle, die 0014 umschreibt:\n  ' +
      withoutOrigin.join('\n  ') +
      '\nDann koennen dort Adressen in der alten Form landen, und 0014 kommt ' +
      'nie wieder vorbei.',
  );

  // And the comparison stays a PREFIX comparison. A `LIKE '%…%'` would also hit
  // a CDN link that carries the string in the query part, and
  // turn it into a broken address.
  assert.match(
    mig,
    /LEFT\(image_url, 15\) = '\/api\/img-proxy\?'/,
    'Die Migration vergleicht nicht mehr über den Anfang des Wertes',
  );
  assert.doesNotMatch(
    mig,
    /LIKE\s+'%/,
    'Ein Muster mit führendem % trifft auch Adressen, die die Zeichenkette ' + 'nur im Abfrageteil enthalten',
  );
});
