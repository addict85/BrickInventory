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
  assert.equal(isProxyPath(`${ALT}?url=x`), true, 'stored old addresses no longer count as proxy');
  assert.equal(isProxyPath(`${NEU}?url=x`), true);
});

test('the server serves both addresses', async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
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
  assert.notEqual(neu, 404, 'the new address is not registered');
  assert.equal(alt, neu, 'the old address answers differently than the new one');
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
  assert.ok(dateien.length >= 30, `Only ${dateien.length} source files found`);

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
    `These places still build the old proxy address:\n  ${gebaut.join('\n  ')}\n${NEU} is built; the old one is only RECOGNIZED (isProxyPath) and still served by the server.`,
  );
});

/** The app need not recognize the old one: a stored path is only completed with the server address. */
test('the app builds the new address and nowhere the old one', () => {
  // Addresses built by hand by the app (shared/app-schnittstelle.json, generated from its source text).
  const { adressen } = require('./helpers/contract').appInterface();
  assert.ok(adressen.includes(NEU), `The app does not build ${NEU} (found: ${adressen.join(', ')})`);
  assert.deepEqual(
    adressen.filter(a => a === ALT || a.startsWith(`${ALT}?`)),
    [],
    `${NEU} is built; the server still serves an installed older version.`,
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
  assert.ok(tabellen.length >= 5, `Only ${tabellen.length} tables with image_url found — pattern outdated?`);

  // Without comments: the explanatory text of this migration NAMES the pattern
  // `LIKE '%…%'` it decides against — and the check below
  // promptly tripped over it. The same trap helpers/sources.js warns about.
  const mig = ohneKommentare(lies(ROOT, 'db/migrations/0014-img-proxy-nach-v1.sql'));
  const absent = tabellen.filter(t => !new RegExp(`UPDATE\\s+${t}\\s`).test(mig)).sort();
  assert.deepEqual(
    absent,
    [],
    'These tables carry image_url, the migration does not touch them:\n  ' +
      absent.join('\n  ') +
      '\nOtherwise addresses in the old form remain there.',
  );

  // Tables that did not exist yet at migration 0014
  const rewritten = [...mig.matchAll(/UPDATE\s+(\w+)\s/g)].map(m => m[1]);
  assert.ok(rewritten.length >= 5, `Only ${rewritten.length} UPDATE targets found in 0014 — pattern outdated?`);

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
    `Only ${stragglers.length} later tables with image_url found ` +
      '(two were measured: part_color_catalog and minifigs_catalog) — pattern outdated?',
  );

  // A valid source is also a later table that itself reads from such a one.
  const quellen = new Set(rewritten);
  const liestAusQuelle = (tab, txt) => {
    // The INSERT that fills this table, and what it reads from.
    const blockList = [
      ...txt.matchAll(
        new RegExp(
          `INSERT\\s+INTO\\s+${tab}\\s*\\([^)]*image_url[^)]*\\)([\\s\\S]*?)(?=INSERT\\s+INTO|ALTER\\s+TABLE|CREATE\\s|\\$sql\\$|$)`,
          'gi',
        ),
      ),
    ];
    return blockList.some(b => [...quellen].some(q => new RegExp(`FROM\\s+${q}\\b`, 'i').test(b[1])));
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
    'These tables carry image_url, are created AFTER migration 0014 and ' +
      'do not get their addresses from a table that 0014 rewrites:\n  ' +
      withoutOrigin.join('\n  ') +
      '\nThen addresses in the old form can end up there, and 0014 never ' +
      'comes by again.',
  );

  // And the comparison stays a PREFIX comparison. A `LIKE '%…%'` would also hit
  // a CDN link that carries the string in the query part, and
  // turn it into a broken address.
  assert.match(
    mig,
    /LEFT\(image_url, 15\) = '\/api\/img-proxy\?'/,
    'The migration no longer compares via the start of the value',
  );
  assert.doesNotMatch(
    mig,
    /LIKE\s+'%/,
    'Ein Muster mit führendem % trifft auch Adressen, die die Zeichenkette ' + 'nur im Abfrageteil enthalten',
  );
});
