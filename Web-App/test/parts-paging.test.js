/**
 * Parts list and images: what the server must deliver (pages, limits,
 * color filter) on the test DB, and what the UI makes of it in jsdom.
 * The paging itself is checked by test/listen-paging-ui.test.js.
 *
 * Counter-checks (measured 08.11.2026, each on its own, reset afterwards):
 *   A  in pageFromSummary the color filter again via
 *      `color_id = parseInt(o.color)` → red: “parts list against the database”
 *      (summary: color red)
 *   B  `Math.min(obergrenze, …)` deleted in seitengroesse() → red:
 *      “parts list against the database” (page_size 100000 gets through)
 *   C  `total` deleted from the return of partsQuery (live) → red: there
 *   D  in maybeLoadMoreParts the check for the active tab removed →
 *      red: “loading more only happens in the visible parts tab”
 *   E  manQtyChange without parseInt(delta) → red: “arguments from data-arg …”
 *      (quantity "21" instead of 3); toggleAdmin with `const cur = !!isAdmin` → red: there
 *      (is_admin false instead of true)
 * Deleted on 08.11.2026 because executed elsewhere: “detail view and zoom
 * show the full resolution” and “data-orig never points to the same address
 * as src” → images-proxy-ui (counter-checks E, F, G there); “missing
 * CDN images are not requested endlessly” → image-proxy-deckel (“a
 * missing image … remembers it”, “only 404 is remembered”); “categories are
 * resolved via the parts catalog” → parts-category-summary-db
 * (join on rb_parts deleted in the live filter or in the category list →
 * red there).
 */
const { isAppModule } = require('../scripts/build-frontend');
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const { openUi, reiter, warte } = require('./helpers/ui');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

/**
 * Remove import/export syntax from a module file.
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '') // import { a, b } from '…';
    .replace(/^export\s+/gm, ''); // export function/const/let/class
  // registerActions() otherwise comes from js/registry.js and is not defined after
  // removing the imports. In the sandbox the registration does not
  // matter — that it IS called is checked by test/csp-actions.test.js
  // and test/bundle-smoke.test.js against the real source text. …
  return (
    'function registerActions() {}\n' + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n' + body
  );
}

const ROOT = path.join(__dirname, '..');

test('the proxy can shrink and does it only once per image', () => {
  const server = require('./helpers/sources').serverAll();
  assert.match(server, /req\.query\.thumb === '1'/, 'Der Proxy kennt kein thumb=1');
  assert.match(
    server,
    /_thumbInFlight/,
    'Ohne Zusammenfassung startet eine Kachelwand dieselbe Verkleinerung mehrfach',
  );
  // The cache durations were lowered and extended by must-revalidate after
  // a long max-age had nailed broken responses down in the browser
  // („200 from disk cache"). Now it is only checked that a
  // revalidation duty is set.
  assert.match(server, /must-revalidate/, 'Ohne Rückfragepflicht bleiben Fehler im Browser stehen');

  const core = stripModuleSyntax(require('./helpers/sources').coreSource());
  assert.match(core, /thumb \? '&thumb=1' : ''/, 'imgUrl() reicht den Wunsch nicht weiter');
});

test('all list images load lazily', () => {
  // Without loading="lazy" the browser starts all images of a list
  // at the same time and pushes them through the ~6 connections per host — they
  // then trickle in visibly. For the minifigures the attribute was missing at
  // three of four places, in finances at both.
  const dir = path.join(ROOT, 'public', 'js');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(x => isAppModule(x))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/<img\s[^>]*>/g)) {
      const tag = m[0];
      if (!/\$\{/.test(tag)) continue; // no dynamic image
      if (/placeholder/.test(tag)) continue; // local SVG, tiny
      if (/loading="lazy"/.test(tag)) continue;
      bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [], `Listenbilder ohne loading="lazy": ${bad.join(', ')}`);
});

test('shrinking keeps no request waiting', () => {
  // Measured: Jimp needs around 150 ms per image and occupies the
  // event loop meanwhile. A tile wall with 60 minifigures would result in nine seconds during
  // which the server stands still for ALL requests.
  const server = require('./helpers/sources').serverAll();
  assert.match(
    server,
    /const THUMB_MAX_PARALLEL = \d+/,
    'Ohne Obergrenze laufen beliebig viele Verkleinerungen gleichzeitig',
  );
  assert.match(server, /function queueThumb/, 'Warteschlange fehlt');
  // In the delivery path the shrinking must not be waited for.
  // Since an earlier round this path IS src/images/imgCacheServe.ts — before that a
  // generously cut piece of the route body, which after the move showed
  // emptiness.
  const proxy = fs.readFileSync(path.join(ROOT, 'src/images/imgCacheServe.ts'), 'utf8');
  assert.doesNotMatch(proxy, /await createProxyPreview/, 'Eine wartende Anfrage reiht 150 ms je Bild aneinander');
  assert.match(
    proxy,
    /queueThumb\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?cacheFile, thumbFile\)/,
    'Die Verkleinerung gehört in den Hintergrund',
  );
});

test('parts list against the database: pages, color filter and upper bound on both paths', {
  concurrency: 1,
}, async t => {
  const _req = require('./helpers/sources').buildAndRequire();
  const { dataOrSkip } = require('./helpers/db');
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const H = require('./helpers/sources').handlerModule(_req);
  const PS = _req('src/parts/summary.js');
  const NAME = `seiten-${process.pid}`,
    SN = `PP${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const U = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const PARTS = [
    ['pp1', 5, 'Rot'],
    ['pp2', 1, 'Blau'],
    ['pp3', 5, 'Rot'],
  ];
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('pp1','Eins'),('pp2','Zwei'),('pp3','Drei')
                ON CONFLICT (part_number) DO NOTHING`);
  for (const [nr, farbe, name] of PARTS) {
    await db.run(
      `INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES ($1,$2,$3)
                  ON CONFLICT (part_number,color_id) DO UPDATE SET color_name = EXCLUDED.color_name`,
      [nr, farbe, name],
    );
    await db.run(
      `INSERT INTO set_parts (set_number, part_number, color_id, quantity, is_spare) VALUES ($1,$2,$3,1,false)`,
      [SN, nr, farbe],
    );
  }
  await holdsSet(db, U, SN, 1);
  for (const [nr, farbe] of PARTS) await holdsPart(db, U, nr, { setNumber: SN, colorId: farbe, quantity: 1 });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [U]);
    await db.run('DELETE FROM set_parts WHERE set_number=$1', [SN]);
    await db.run(`DELETE FROM part_color_catalog WHERE part_number IN ('pp1','pp2','pp3')`);
    await db.run(`DELETE FROM part_catalog WHERE part_number IN ('pp1','pp2','pp3')`);
    await db.pool.end().catch(() => {});
  });

  // Without exclude_manual the live query always answers; with it, after the build, the summary.
  let abfrage = { page: 1 };
  const pruefe = async weg => {
    const page1 = await H.partsQuery(U, { ...abfrage, page_size: 2 });
    const page2 = await H.partsQuery(U, { ...abfrage, page: 2, page_size: 2 });
    assert.equal(page1.source, weg);
    // Without total the client does not know when to stop.
    assert.deepEqual([page1.total, page1.parts.length, page2.parts.length, page1.page_size], [3, 2, 1, 2], weg);
    const rot = await H.partsQuery(U, { ...abfrage, page_size: 50, color: 'Rot' });
    // The source too: an error in the filter would otherwise fall back to the live query unnoticed.
    assert.deepEqual(
      [rot.source, ...rot.parts.map(p => p.part_number).sort()],
      [weg, 'pp1', 'pp3'],
      `${weg}: Farbe Rot`,
    );
    assert.equal((await H.partsQuery(U, { ...abfrage, page_size: 100000 })).page_size, 500, `${weg}: Obergrenze`);
  };
  await pruefe('db');
  // The set path may do more at once (a whole parts list), but not arbitrarily much.
  assert.equal((await H.partsQuery(U, { set_number: SN, page_size: 100000 })).page_size, 5000);
  await PS.rebuildNow(U);
  abfrage = { exclude_manual: '1', page: 1 };
  await pruefe('summary');
});

test('loading more only happens in the visible parts tab', async () => {
  const observer = [];
  const seite = url => {
    const p = Number(new URL(url, 'http://x').searchParams.get('page'));
    return {
      success: true,
      total: 1000,
      page: p,
      page_size: 100,
      parts: Array.from({ length: 100 }, (_, i) => ({
        part_number: `t${p}-${i}`,
        part_name: 'Stein',
        color_id: 5,
        color_name: 'Red',
        total_quantity: 1,
      })),
    };
  };
  const { w, d, aufrufe, ruhig } = await openUi(
    { '/v2/parts': seite },
    {
      before(w) {
        w.IntersectionObserver = class {
          constructor(cb) {
            observer.push(cb);
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      },
    },
  );
  try {
    const seiten = () => aufrufe.filter(a => /\/api\/v2\/parts\?/.test(a.url) && /exclude_manual/.test(a.url)).length;
    await reiter(w, 'parts');
    assert.ok(await warte(() => seiten() >= 2), 'Die erste Seite füllt den Schirm nicht, die zweite kommt nicht');
    await ruhig();
    const sichtbar = () => {
      for (const cb of observer) cb([{ isIntersecting: true }]);
    };
    const vorher = seiten();
    sichtbar();
    assert.ok(await warte(() => seiten() === vorher + 1), 'Im sichtbaren Reiter lädt der Sentinel nicht nach');
    await ruhig();
    await reiter(w, 'gallery');
    sichtbar();
    await ruhig();
    assert.equal(seiten(), vorher + 1, 'Der Sentinel lädt im Hintergrund weiter');
    assert.ok(d.querySelectorAll('#parts-main .part-card').length >= 300);
  } finally {
    w.close();
  }
});

test('arguments from data-arg are treated as strings', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v2/minifigs/manual': { success: true, figs: [{ fig_number: 'fig-000001', fig_name: 'Figur', quantity: 2 }] },
    '/v2/auth/users': {
      success: true,
      users: [
        { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' },
        { id: 4, username: 'dora', is_admin: false, is_active: true, created_at: '2026-10-04T00:00:00Z' },
      ],
    },
  });
  try {
    // Plus in the quantity field: 2 becomes 3, not "21".
    await reiter(w, 'minifigs');
    assert.ok(await warte(() => d.querySelector('#manual-figs-list [data-click="openManDetail"]')));
    d.querySelector('#manual-figs-list [data-click="openManDetail"]').click();
    assert.ok(await warte(() => d.querySelector('[data-click="manQtyChange"][data-arg="1"]')), 'Kein Mengenknopf');
    assert.equal(d.getElementById('man-det-qty').value, '2');
    d.querySelector('[data-click="manQtyChange"][data-arg="1"]').click();
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v2/minifigs/fig-000001'))));
    assert.deepEqual(JSON.parse(aufrufe.find(a => a.method === 'PUT').body), { quantity: 3 });

    // Grant rights: is_admin arrives as "0", and !"0" would be false.
    await reiter(w, 'settings');
    assert.ok(await warte(() => d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="4"]')));
    d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="4"]').click();
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/4/admin'))));
    assert.equal(JSON.parse(aufrufe.find(a => a.url.includes('/v2/auth/users/4/admin')).body).is_admin, true);
  } finally {
    w.close();
  }
});
