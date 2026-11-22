/**
 * Acquisition list in the detail dialog of manual parts and minifigures.
 *
 * The quantity and daily rules run against the database, the reloading of the
 * list in the whole UI (jsdom).
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   A  manQtySave() loads the list only when increasing (`if (qty > 2)` around the
 *      fetch) → red “the acquisition list is reloaded in BOTH directions”
 *   B  passeManualQuantityAn: `if (soll > bisher)` → `if (soll > bisher && bisher > 0)`
 *      → red “a quantity increase creates even without an existing acquisition …”
 *   C  entriesNewestFirst sorts ASC → red “the LIFO reduction …”
 *   D  ENTRY_TABLES: key of the part without color_id → red “the
 *      daily rule applies to all three kinds …” (plus “increase …” and “edit path …”)
 *   E  in src/collection/acquisitions.ts `if (clash)` → `if (false)` → red “the
 *      edit path rejects what the daily rule forbids” (500 instead of 409)
 *   F  deletePart() without deletePartEntries → red “deleting a
 *      manual entry clears the purchase prices along”
 *   G  valueManual() with `acquisitions: []` instead of `rows` → red “the
 *      valuation delivers one row per purchase price …”
 *   H  pmRows() always draws only one row (`return pmRow(it, label, null,
 *      situation, text)`) → red “the finances show one row per purchase price …”
 *   I  in src/collection/deletion.ts `.catch(() => {})` on deletePartEntries → red in
 *      ratschen.test.js “silent catches …” (covers the deleted case “no
 *      silent error on stock tables any more”)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = f => require('./helpers/sources').serviceSource(f);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the acquisition list is reloaded in BOTH directions', async t => {
  // When decreasing, the server removes acquisitions; reloading only when
  // increasing left deleted entries standing in the dialog.
  const { openUi, reiter } = require('./helpers/ui');
  const row = (id, quantity, tag) => ({
    id,
    quantity: quantity,
    purchase_price: 0.5,
    unit_price: 0.5,
    condition: 'N',
    created_at: `${tag}T10:00:00Z`,
    currency: 'EUR',
    user_id: 1,
  });
  let erfassungen = [row(1, 1, '2026-10-01'), row(2, 1, '2026-10-02')];
  const { w, d, warte, aufrufe } = await openUi({
    '/v2/parts/manual': {
      success: true,
      total: 1,
      page: 1,
      page_size: 50,
      parts: [
        { part_number: '3002', part_name: 'Stein 2 x 3', color_id: 5, color_name: 'Red', quantity: 2, user_id: 1 },
      ],
    },
    '/v2/parts/3002/5/acquisitions': () => ({ success: true, acquisitions: erfassungen }),
    '/v2/parts/3002/5': { success: true, quantity: 1 },
  });
  t.after(() => w.close());
  await reiter(w, 'parts');
  assert.ok(await warte(() => d.querySelector('#manual-parts-list .man-tile')), 'Die Kachel des manuellen Teils fehlt');
  d.querySelector('#manual-parts-list .man-tile').click();
  assert.ok(await warte(() => d.getElementById('man-det-qty')), 'Das Mengenfeld im Detail fehlt');
  const vorher = d.getElementById('man-acq-summary')?.textContent;

  erfassungen = [row(1, 1, '2026-10-01')];
  const ab = aufrufe.length;
  const field = /** @type {HTMLInputElement} */ (d.getElementById('man-det-qty'));
  field.value = '1';
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok(await warte(() => aufrufe.slice(ab).some(a => a.method === 'PUT')), 'Die Menge wird nicht gespeichert');
  assert.ok(
    await warte(() =>
      aufrufe.slice(ab).some(a => a.method === 'GET' && a.url.includes('/v2/parts/3002/5/acquisitions')),
    ),
    'Nach dem Verringern wird die Erfassungsliste nicht neu geholt',
  );
  assert.ok(
    await warte(() => d.getElementById('man-acq-summary')?.textContent !== vorher),
    'Die Zusammenfassung im Detail zeigt noch die gelöschte Erfassung',
  );
});

test('quantities and acquisitions of manual entries against the database', { concurrency: 1 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `macq_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { changeManualPart } = _req('src/parts/manualParts.js');
  const { updateManualMinifig } = _req('src/minifigs/manualMinifigs.js');
  const { addPurchaseAtTag } = _req('src/inventory/acquisitions.js');
  const { testServer } = require('./helpers/server');
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const partRows = (pn, cid = 5) =>
    db.all(
      `SELECT id, quantity FROM part_acquisitions WHERE user_id = $1 AND part_number = $2 AND color_id = $3
      ORDER BY created_at, id`,
      [uid, pn, cid],
    );

  await t.test('a quantity increase creates a row even without an existing acquisition', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-leer', 5, 'manual')`, [
      uid,
    ]);
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'ma-fig-leer', 'manual')`, [uid]);
    await changeManualPart(uid, 'ma-leer', 5, { quantity: 3 });
    await updateManualMinifig(uid, 'ma-fig-leer', { quantity: 2 });
    assert.deepEqual(
      (await partRows('ma-leer')).map(r => r.quantity),
      [3],
      'Die Menge stieg, die Erfassungsliste blieb leer',
    );
    const fig = await db.get(
      `SELECT COALESCE(SUM(quantity),0)::int AS q FROM minifig_acquisitions
                               WHERE user_id = $1 AND fig_number = 'ma-fig-leer'`,
      [uid],
    );
    assert.equal(fig.q, 2, 'Bei der Minifigur stieg die Menge ohne Erfassung');
  });

  await t.test('the LIFO reduction removes the newest acquisition first', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-lifo', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
                  VALUES ($1, 'ma-lifo', 5, 2, 1, 'N', NOW() - INTERVAL '3 days'),
                         ($1, 'ma-lifo', 5, 1, 2, 'N', NOW())`,
      [uid],
    );
    const [alt] = await partRows('ma-lifo');
    await changeManualPart(uid, 'ma-lifo', 5, { quantity: 2 });
    assert.deepEqual(
      await partRows('ma-lifo'),
      [{ id: alt.id, quantity: 2 }],
      'Beim Verringern muss die heutige Erfassung zuerst weichen, nicht die älteste',
    );
    await changeManualPart(uid, 'ma-lifo', 5, { quantity: 1 });
    assert.deepEqual(await partRows('ma-lifo'), [{ id: alt.id, quantity: 1 }]);
  });

  await t.test('the daily rule applies to all three kinds with their own key', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, 'ma-1') ON CONFLICT DO NOTHING`, [uid]);
    const record = (kind, keys) => addPurchaseAtTag(kind, uid, keys, { quantity: 1, price: 4, condition: 'N' });
    for (const [kind, keys] of [
      ['set', ['ma-1']],
      ['part', ['ma-tag', 5]],
      ['fig', ['ma-fig-tag']],
    ]) {
      assert.deepEqual(await record(kind, keys), { merged: false }, `${kind}: die erste Erfassung des Tages`);
      assert.deepEqual(
        await record(kind, keys),
        { merged: true },
        `${kind}: der zweite Kauf desselben Tages stockt nicht auf`,
      );
    }
    // Another color is another part, not a second purchase.
    assert.deepEqual(
      await record('part', ['ma-tag', 7]),
      { merged: false },
      'Eine andere Farbe wurde mit der ersten zusammengelegt',
    );
    assert.deepEqual(
      (await partRows('ma-tag', 5)).map(r => r.quantity),
      [2],
    );
    assert.deepEqual(
      (await partRows('ma-tag', 7)).map(r => r.quantity),
      [1],
    );
  });

  await t.test('the edit path rejects what the daily rule forbids', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-datum', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
                  VALUES ($1, 'ma-datum', 5, 1, 1.5, 'N', NOW()),
                         ($1, 'ma-datum', 5, 1, 1.5, 'N', NOW() - INTERVAL '5 days')`,
      [uid],
    );
    const [frueher, heute] = await partRows('ma-datum');
    const tag = async id =>
      (
        await db.get(
          `SELECT to_char(COALESCE(day, (created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') AS t
         FROM part_acquisitions WHERE id = $1`,
          [id],
        )
      ).t;
    const aendere = (id, body) =>
      fetch(`${base}/api/v2/parts/ma-datum/5/acquisitions/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const r = await aendere(frueher.id, { date: await tag(heute.id) });
    assert.equal(r.status, 409, 'Ein Datum, an dem derselbe Kauf schon steht, muss abgelehnt werden');
    assert.equal((await r.json()).code, 'date_taken');
    assert.equal(
      (await aendere(frueher.id, { date: await tag(heute.id), condition: 'U' })).status,
      200,
      'Ein anderer Zustand am selben Tag ist eine eigene Erfassung und erlaubt',
    );
  });

  await t.test('deleting a manual entry clears the purchase prices along', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-weg', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price)
                  VALUES ($1, 'ma-weg', 5, 2, 3)`,
      [uid],
    );
    const r = await fetch(`${base}/api/v2/parts/ma-weg/5`, { method: 'DELETE' });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(await partRows('ma-weg'), [], 'Verwaiste Erfassungen zählen in den Finanzsummen weiter');
  });

  await t.test('the valuation delivers one row per purchase price, legacy data without', async () => {
    const { valueParts, valueMinifigs } = _req('src/finances/financeCalc.js');
    await db.run(
      `INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-preis', 5, 'manual'),
                  ($1, 'ma-alt', 5, 'manual')`,
      [uid],
    );
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'ma-fig-preis', 'manual')`, [uid]);
    for (const [tag, preis] of [
      [3, 2],
      [1, 4],
    ]) {
      await db.run(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, created_at)
                    VALUES ($1, 'ma-preis', 5, 1, $2, NOW() - make_interval(days => $3))`,
        [uid, preis, tag],
      );
      await db.run(
        `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, created_at)
                    VALUES ($1, 'ma-fig-preis', 1, $2, NOW() - make_interval(days => $3))`,
        [uid, preis, tag],
      );
    }
    const parts = (await valueParts(uid, [uid])).parts;
    const minifigs = (await valueMinifigs(uid, [uid])).figs;
    const preise = e => (e?.acquisitions ?? []).map(a => a.purchase_price).sort();
    assert.deepEqual(preise(parts.find(p => p.part_number === 'ma-preis')), [2, 4], 'Teil: eine Zeile je Kaufpreis');
    assert.deepEqual(
      preise(minifigs.find(f => f.fig_number === 'ma-fig-preis')),
      [2, 4],
      'Figur: eine Zeile je Kaufpreis',
    );
    assert.deepEqual(parts.find(p => p.part_number === 'ma-alt')?.acquisitions, [], 'Altbestand ohne Erfassung');
  });
});

test('the finances show one row per purchase price, the legacy data in one', async t => {
  const { openUi, reiter } = require('./helpers/ui');
  const erfassung = (id, preis) => ({
    id,
    condition: 'N',
    quantity: 1,
    purchase_price: preis,
    avg_price: 3,
    total_avg: '3.00',
    value_total: 3,
    pnl_pct: null,
    pnl_percent: null,
  });
  const teil = (nr, acquisitions) => ({
    part_number: nr,
    part_name: `Teil ${nr}`,
    color_id: 5,
    color_name: 'Red',
    quantity: acquisitions.length || 1,
    condition: 'N',
    conditions: ['N'],
    acquisitions,
    avg_price: 3,
    purchase_price: 3,
    value_total: 3 * (acquisitions.length || 1),
    total_value: '3.0000',
    display_value: '3.00',
  });
  const { w, d, warte } = await openUi({
    '/v2/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '9.00',
      value_total: 9,
      parts: [teil('ma-zwei', [erfassung(1, 2), erfassung(2, 4)]), teil('ma-alt', [])],
    },
  });
  t.after(() => w.close());
  await reiter(w, 'finance');
  assert.ok(await warte(() => d.querySelector('[data-fin-kind] tbody tr')), 'Kein Abschnitt der manuellen Teile');
  const zeilen = [...d.querySelectorAll('[data-fin-kind] tbody tr')].map(z => z.textContent);
  assert.equal(zeilen.filter(z => z.includes('Teil ma-zwei')).length, 2, zeilen.join('\n'));
  assert.equal(zeilen.filter(z => z.includes('Teil ma-alt')).length, 1, zeilen.join('\n'));
});

test('no create path writes directly into an acquisition table', () => {
  // Prohibition: acquisitions only arise via addPurchaseAtTag — otherwise
  // the daily rule (entry-per-state-db.test.js) would not apply to every path.
  for (const f of [
    'src/parts/manualParts.ts',
    'src/minifigs/manualMinifigs.ts',
    'routes/api/sets.ts',
    'routes/api/setsImport.ts',
    'src/sets/service.ts',
    'src/sets/content.ts',
  ]) {
    const src = strip(read(f));
    assert.doesNotMatch(
      src,
      /INSERT INTO (part|minifig|set)_acquisitions/,
      `${f}: Erfassungen gehören über addPurchaseAtTag geschrieben`,
    );
  }
  for (const f of [
    'routes/api/sets.ts',
    'routes/api/setsImport.ts',
    'src/parts/manualParts.ts',
    'src/minifigs/manualMinifigs.ts',
    'routes/api/acquisitions.ts',
    'src/collection/acquisitions.ts',
  ]) {
    assert.doesNotMatch(
      strip(read(f)),
      /SELECT id FROM \w+_acquisitions WHERE[\s\S]{0,160}created_at[^\n]*::date/,
      `${f}: keine eigene Kopie der Tagesprüfung`,
    );
  }
});

test('the legacy data is merged once into one row per day', () => {
  // The new rule only applies on the next write — already existing
  // duplicate rows do not disappear by themselves.
  const mig = read('db/migrations/0004-erfassung-pro-tag.sql');
  for (const t of ['set_acquisitions', 'part_acquisitions', 'minifig_acquisitions']) {
    assert.ok(mig.includes(`FROM ${t}`), `${t} fehlt im Zusammenfassen`);
  }
  assert.match(mig, /HAVING COUNT\(\*\) > 1/, 'Nur echte Doppelzeilen anfassen');
  assert.match(
    mig,
    /FILTER \(WHERE purchase_price IS NOT NULL\)/,
    'Preislose Zeilen dürfen den Nenner nicht aufblähen',
  );
  assert.match(mig, /CASE WHEN g\.gebraucht = 1 THEN 'U' ELSE 'N' END/, 'Gebraucht gewinnt — wie im Schreibpfad');
  // Grouping is per entry AND day; purchases on different days stay
  // separate, they are the reason for the acquisition history.
  assert.match(mig, /GROUP BY user_id, set_number, created_at::date/);
});

test('the quantity increase averages the purchase price instead of leaving it', () => {
  // The earlier branch only increased the quantity for an acquisition of today. A
  // copy bought today at the current market price thereby vanished into the
  // old unit price — the row showed two pieces at the price of the first.
  const src = require('./helpers/sources').kompakt(require('./helpers/sources').setCoreSource());
  const fn = src.slice(
    src.indexOf('async function alignEntriesToQuantity'),
    src.indexOf('async function writeInLastEntry'),
  );
  assert.doesNotMatch(
    fn,
    /UPDATE set_acquisitions SET quantity = quantity \+ \$1/,
    'Kein direktes Aufstocken mehr — das entscheidet addPurchaseAtTag',
  );
  assert.match(
    fn,
    /await bookEntry\(sk, \{ konto: userId, setNumber, menge: delta, kaufpreis: plan\.price, zustand: plan\.condition,/,
    'Auch die Erhöhung läuft über den gemeinsamen Schreibweg',
  );
  // The price comes from priceForNewEntry() — extracted, because the
  // BrickLink fetch in it must run BEFORE the advisory lock (a network call
  // in an open transaction would hold lock and connection).
  assert.match(
    fn,
    /pricePlan \?\? \(?await priceForNewEntry\(sk, userId, setNumber\)/,
    'Ein vorab ermittelter Preis muss durchgereicht werden können',
  );
  // Target of the quantity change is the account `ziel` (without a setting the own one, in the household the chosen one).
  // The checked RULE is unchanged: determine the price (network call), THEN lock.
  assert.match(
    src,
    /const plan = [\s\S]{0,120}priceForNewEntry\(sk, target, sn\)[\s\S]{0,400}sk\.transact\(/,
    'In changeSet muss der Preis VOR der Sperre stehen',
  );
  assert.doesNotMatch(src, /function isToday\(/, 'Die eigene Tagesprüfung gehört entfernt');
});

test('a quantity change runs under the inventory lock', () => {
  // Where this test comes from
  const src = require('./helpers/sources').setCoreSource();
  const fn = src
    .slice(src.indexOf('async function changeSet'), src.indexOf("router.put('/:setNumber'"))
    // Comments gone: the explanatory text above quotes the old call including
    // .catch(() => {}) and would otherwise trigger the check itself.
    .replace(/\/\/[^\n]*/g, '');
  // Target is the account `ziel` — the rule stays: ONE locked transaction for quantity and acquisitions.
  assert.match(
    fn,
    /sperren: \[\{ konto: target, schluessel: sn \}\]/,
    'Menge und Erfassungen gehören in EINE gesperrte Transaktion',
  );
  assert.doesNotMatch(
    fn,
    /alignEntriesToQuantity\([^)]*\)\.catch\(/,
    'Ein verschluckter Fehler hinterlässt eine Menge ohne passende Erfassungen',
  );
  assert.doesNotMatch(
    fn,
    /await db\.run\('UPDATE sets SET quantity/,
    'Die Mengenänderung darf nicht an der Transaktion vorbei laufen',
  );
  // And the difference must come from the TOTAL QUANTITY of the scope, not
  // from the row of a single account — otherwise the detail would show a
  // household number while the „+" calculated against another one.
  // Since migration 0036 the query stands in db/stockQuantity.ts; here …
  assert.match(
    fn,
    /repo\.setMenge\(s\.db, 'blickfeld', readField/,
    'Die Ausgangsmenge muss über das Blickfeld summiert werden',
  );
});
