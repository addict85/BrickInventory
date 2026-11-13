/**
 * Teileliste und Bilder: was der Server liefern muss (Seiten, Grenzen,
 * Farbfilter) an der Test-DB, und was die Oberfläche daraus macht in jsdom.
 * Das Blättern selbst prüft test/listen-paging-oberflaeche.test.js.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln, danach zurückgesetzt):
 *   A  in seiteAusZusammenfassung den Farbfilter wieder über
 *      `color_id = parseInt(o.color)` → rot: „Teileliste an der Datenbank“
 *      (Zusammenfassung: Farbe Rot)
 *   B  in seitengroesse() `Math.min(obergrenze, …)` gestrichen → rot:
 *      „Teileliste an der Datenbank“ (page_size 100000 kommt durch)
 *   C  `total` aus der Rückgabe von getParts (Live) gestrichen → rot: dort
 *   D  in maybeLoadMoreParts die Prüfung auf den aktiven Reiter entfernt →
 *      rot: „nachgeladen wird nur im sichtbaren Teile-Tab“
 *   E  manQtyChange ohne parseInt(delta) → rot: „Argumente aus data-arg …“
 *      (Menge "21" statt 3); toggleAdmin mit `const cur = !!isAdmin` → rot: dort
 *      (is_admin false statt true)
 * Am 08.11.2026 gestrichen, weil anderswo ausgeführt: „Detailansicht und Zoom
 * zeigen die volle Auflösung“ und „data-orig zeigt nie auf dieselbe Adresse
 * wie src“ → bilder-proxy-oberflaeche (Gegenproben E, F, G dort); „fehlende
 * CDN-Bilder werden nicht endlos nachgefragt“ → bild-proxy-deckel („ein
 * fehlendes Bild … merkt es sich“, „nur 404 wird gemerkt“); „Kategorien werden
 * über den Teilekatalog aufgelöst“ → teile-kategorie-zusammenfassung-db
 * (Join auf rb_parts im Live-Filter bzw. in der Kategorienliste gestrichen →
 * dort rot).
 */
const { istAppModul } = require('../scripts/build-frontend');
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { haeltSet, haeltTeil } = require('./helpers/bestand');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

/**
 * import-/export-Syntax aus einer Moduldatei entfernen.
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '') // import { a, b } from '…';
    .replace(/^export\s+/gm, ''); // export function/const/let/class
  // registerActions() kommt sonst aus js/registry.js und ist nach dem
  // Entfernen der Importe nicht definiert. In der Sandbox interessiert die
  // Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
  // und test/bundle-smoke.test.js gegen den echten Quelltext. …
  return (
    'function registerActions() {}\n' + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n' + body
  );
}

const ROOT = path.join(__dirname, '..');

test('der Proxy kann verkleinern und tut es nur einmal je Bild', () => {
  const server = require('./helpers/sources').serverAll();
  assert.match(server, /req\.query\.thumb === '1'/, 'Der Proxy kennt kein thumb=1');
  assert.match(
    server,
    /_thumbInFlight/,
    'Ohne Zusammenfassung startet eine Kachelwand dieselbe Verkleinerung mehrfach',
  );
  // Die Cache-Dauern wurden gesenkt und um must-revalidate ergänzt, nachdem
  // ein langes max-age kaputte Antworten im Browser festgenagelt hatte
  // („200 from disk cache"). Geprüft wird jetzt nur noch, dass eine
  // Rückfragepflicht gesetzt ist.
  assert.match(server, /must-revalidate/, 'Ohne Rückfragepflicht bleiben Fehler im Browser stehen');

  const core = stripModuleSyntax(require('./helpers/sources').coreQuelle());
  assert.match(core, /thumb \? '&thumb=1' : ''/, 'imgUrl() reicht den Wunsch nicht weiter');
});

test('alle Listenbilder laden verzögert', () => {
  // Ohne loading="lazy" startet der Browser sämtliche Bilder einer Liste
  // gleichzeitig und drängt sie durch die ~6 Verbindungen pro Host — sie
  // tröpfeln dann sichtbar herein. Bei den Minifiguren fehlte das Attribut an
  // drei von vier Stellen, in Finanzen an beiden.
  const dir = path.join(ROOT, 'public', 'js');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(x => istAppModul(x))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/<img\s[^>]*>/g)) {
      const tag = m[0];
      if (!/\$\{/.test(tag)) continue; // kein dynamisches Bild
      if (/placeholder/.test(tag)) continue; // lokales SVG, winzig
      if (/loading="lazy"/.test(tag)) continue;
      bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [], `Listenbilder ohne loading="lazy": ${bad.join(', ')}`);
});

test('die Verkleinerung lässt keine Anfrage warten', () => {
  // Gemessen: Jimp braucht rund 150 ms je Bild und belegt dabei den
  // Event-Loop. Eine Kachelwand mit 60 Minifiguren ergäbe neun Sekunden, in
  // denen der Server für ALLE Anfragen steht.
  const server = require('./helpers/sources').serverAll();
  assert.match(
    server,
    /const THUMB_MAX_PARALLEL = \d+/,
    'Ohne Obergrenze laufen beliebig viele Verkleinerungen gleichzeitig',
  );
  assert.match(server, /function queueThumb/, 'Warteschlange fehlt');
  // Im Ausliefer-Pfad darf nicht auf die Verkleinerung gewartet werden.
  // Dieser Pfad IST seit einer früheren Runde src/katalog/bilder/imgCacheServe.ts — vorher ein
  // grosszügig geschnittenes Stück des Route-Rumpfs, was nach dem Umzug ins
  // Leere zeigte.
  const proxy = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/imgCacheServe.ts'), 'utf8');
  assert.doesNotMatch(proxy, /await makeProxyThumb/, 'Eine wartende Anfrage reiht 150 ms je Bild aneinander');
  assert.match(
    proxy,
    /queueThumb\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?cacheFile, thumbFile\)/,
    'Die Verkleinerung gehört in den Hintergrund',
  );
});

test('Teileliste an der Datenbank: Seiten, Farbfilter und Obergrenze auf beiden Wegen', { concurrency: 1 }, async t => {
  const _req = require('./helpers/sources').buildAndRequire();
  const { dbOderSkip } = require('./helpers/db');
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const H = require('./helpers/sources').handlerModul(_req);
  const PS = _req('src/teile/partsSummary.js');
  const NAME = `seiten-${process.pid}`,
    SN = `PP${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const U = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const TEILE = [
    ['pp1', 5, 'Rot'],
    ['pp2', 1, 'Blau'],
    ['pp3', 5, 'Rot'],
  ];
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('pp1','Eins'),('pp2','Zwei'),('pp3','Drei')
                ON CONFLICT (part_number) DO NOTHING`);
  for (const [nr, farbe, name] of TEILE) {
    await db.run(
      `INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES ($1,$2,$3)
                  ON CONFLICT (part_number,color_id) DO UPDATE SET color_name = EXCLUDED.color_name`,
      [nr, farbe, name],
    );
    await db.run(
      `INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare) VALUES ($1,$2,$3,1,false)`,
      [SN, nr, farbe],
    );
  }
  await haeltSet(db, U, SN, 1);
  for (const [nr, farbe] of TEILE) await haeltTeil(db, U, nr, { setNumber: SN, colorId: farbe, menge: 1 });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [U]);
    await db.run('DELETE FROM set_teile WHERE set_number=$1', [SN]);
    await db.run(`DELETE FROM part_color_catalog WHERE part_number IN ('pp1','pp2','pp3')`);
    await db.run(`DELETE FROM part_catalog WHERE part_number IN ('pp1','pp2','pp3')`);
    await db.pool.end().catch(() => {});
  });

  // Ohne exclude_manual antwortet immer die Live-Abfrage; mit, nach dem Aufbau, die Zusammenfassung.
  let abfrage = { page: 1 };
  const pruefe = async weg => {
    const seite1 = await H.getParts(U, { ...abfrage, page_size: 2 });
    const seite2 = await H.getParts(U, { ...abfrage, page: 2, page_size: 2 });
    assert.equal(seite1.source, weg);
    // Ohne total weiss der Client nicht, wann Schluss ist.
    assert.deepEqual([seite1.total, seite1.parts.length, seite2.parts.length, seite1.page_size], [3, 2, 1, 2], weg);
    const rot = await H.getParts(U, { ...abfrage, page_size: 50, color: 'Rot' });
    // Auch die Quelle: Ein Fehler im Filter fiele sonst unbemerkt auf die Live-Abfrage zurück.
    assert.deepEqual(
      [rot.source, ...rot.parts.map(p => p.part_number).sort()],
      [weg, 'pp1', 'pp3'],
      `${weg}: Farbe Rot`,
    );
    assert.equal((await H.getParts(U, { ...abfrage, page_size: 100000 })).page_size, 500, `${weg}: Obergrenze`);
  };
  await pruefe('db');
  // Der Set-Weg darf mehr auf einmal (eine ganze Teileliste), aber nicht beliebig viel.
  assert.equal((await H.getParts(U, { set_number: SN, page_size: 100000 })).page_size, 5000);
  await PS.rebuildNow(U);
  abfrage = { exclude_manual: '1', page: 1 };
  await pruefe('summary');
});

test('nachgeladen wird nur im sichtbaren Teile-Tab', async () => {
  const beobachter = [];
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
  const { w, d, aufrufe, ruhig } = await oeffneOberflaeche(
    { '/v1/parts': seite },
    {
      vorher(w) {
        w.IntersectionObserver = class {
          constructor(cb) {
            beobachter.push(cb);
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      },
    },
  );
  try {
    const seiten = () => aufrufe.filter(a => /\/api\/v1\/parts\?/.test(a.url) && /exclude_manual/.test(a.url)).length;
    await reiter(w, 'parts');
    assert.ok(await warte(() => seiten() >= 2), 'Die erste Seite füllt den Schirm nicht, die zweite kommt nicht');
    await ruhig();
    const sichtbar = () => {
      for (const cb of beobachter) cb([{ isIntersecting: true }]);
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

test('Argumente aus data-arg werden als Zeichenkette behandelt', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/minifigs/manual': { success: true, figs: [{ fig_number: 'fig-000001', fig_name: 'Figur', quantity: 2 }] },
    '/v1/auth/users': {
      success: true,
      users: [
        { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' },
        { id: 4, username: 'dora', is_admin: false, is_active: true, created_at: '2026-10-04T00:00:00Z' },
      ],
    },
  });
  try {
    // Plus im Mengenfeld: aus 2 wird 3, nicht "21".
    await reiter(w, 'minifigs');
    assert.ok(await warte(() => d.querySelector('#manual-figs-list [data-click="openManDetail"]')));
    d.querySelector('#manual-figs-list [data-click="openManDetail"]').click();
    assert.ok(await warte(() => d.querySelector('[data-click="manQtyChange"][data-arg="1"]')), 'Kein Mengenknopf');
    assert.equal(d.getElementById('man-det-qty').value, '2');
    d.querySelector('[data-click="manQtyChange"][data-arg="1"]').click();
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v1/minifigs/fig-000001'))));
    assert.deepEqual(JSON.parse(aufrufe.find(a => a.method === 'PUT').body), { quantity: 3 });

    // Rechte geben: is_admin kommt als "0" an, und !"0" wäre false.
    await reiter(w, 'settings');
    assert.ok(await warte(() => d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="4"]')));
    d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="4"]').click();
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/4/admin'))));
    assert.equal(JSON.parse(aufrufe.find(a => a.url.includes('/v1/auth/users/4/admin')).body).is_admin, true);
  } finally {
    w.close();
  }
});
