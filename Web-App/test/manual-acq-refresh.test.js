/**
 * Erfassungsliste im Detail-Dialog manueller Teile und Minifiguren.
 * Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#kopf
 *
 * Die Mengen- und Tagesregeln laufen gegen die Datenbank, das Nachladen der
 * Liste in der ganzen Oberfläche (jsdom).
 *
 * Gegenproben (08.11.2026 gemessen, jeweils zurückgenommen):
 *   A  manQtySave() lädt die Liste nur beim Erhöhen (`if (qty > 2)` um den
 *      Abruf) → rot „die Erfassungsliste wird in BEIDE Richtungen nachgeladen“
 *   B  passeManuelleMengeAn: `if (soll > bisher)` → `if (soll > bisher && bisher > 0)`
 *      → rot „eine Mengenerhöhung legt auch ohne bestehende Erfassung …“
 *   C  erfassungenNeuesteZuerst sortiert ASC → rot „die LIFO-Reduktion …“
 *   D  ERFASSUNGS_TABELLEN: Schlüssel des Teils ohne color_id → rot „die
 *      Tagesregel gilt für alle drei Arten …“ (dazu „Erhöhung …“ und „Bearbeiten-Pfad …“)
 *   E  in src/sammlung/erfassungen.ts `if (clash)` → `if (false)` → rot „der
 *      Bearbeiten-Pfad lehnt ab, was die Tagesregel verbietet“ (500 statt 409)
 *   F  loescheTeil() ohne loescheTeilErfassungen → rot „das Löschen eines
 *      manuellen Eintrags räumt die Kaufpreise mit ab“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pruefeParameter } = require('./helpers/sources');

const read = f => require('./helpers/sources').dienstQuelle(f);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('die Erfassungsliste wird in BEIDE Richtungen nachgeladen', async t => {
  // Beim Verringern entfernt der Server Erfassungen; nur beim Erhöhen neu zu
  // laden liess gelöschte Einträge im Dialog stehen.
  const { oeffneOberflaeche, reiter } = require('./helpers/oberflaeche');
  const zeile = (id, menge, tag) => ({
    id,
    quantity: menge,
    purchase_price: 0.5,
    unit_price: 0.5,
    condition: 'N',
    created_at: `${tag}T10:00:00Z`,
    currency: 'EUR',
    user_id: 1,
  });
  let erfassungen = [zeile(1, 1, '2026-10-01'), zeile(2, 1, '2026-10-02')];
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/parts/manual': {
      success: true,
      total: 1,
      page: 1,
      page_size: 50,
      parts: [
        { part_number: '3002', part_name: 'Stein 2 x 3', color_id: 5, color_name: 'Red', quantity: 2, user_id: 1 },
      ],
    },
    '/v1/parts/3002/5/acquisitions': () => ({ success: true, acquisitions: erfassungen }),
    '/v1/parts/3002/5': { success: true, quantity: 1 },
  });
  t.after(() => w.close());
  await reiter(w, 'parts');
  assert.ok(await warte(() => d.querySelector('#manual-parts-list .man-tile')), 'Die Kachel des manuellen Teils fehlt');
  d.querySelector('#manual-parts-list .man-tile').click();
  assert.ok(await warte(() => d.getElementById('man-det-qty')), 'Das Mengenfeld im Detail fehlt');
  const vorher = d.getElementById('man-acq-summary')?.textContent;

  erfassungen = [zeile(1, 1, '2026-10-01')];
  const ab = aufrufe.length;
  const feld = /** @type {HTMLInputElement} */ (d.getElementById('man-det-qty'));
  feld.value = '1';
  feld.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok(await warte(() => aufrufe.slice(ab).some(a => a.method === 'PUT')), 'Die Menge wird nicht gespeichert');
  assert.ok(
    await warte(() =>
      aufrufe.slice(ab).some(a => a.method === 'GET' && a.url.includes('/v1/parts/3002/5/acquisitions')),
    ),
    'Nach dem Verringern wird die Erfassungsliste nicht neu geholt',
  );
  assert.ok(
    await warte(() => d.getElementById('man-acq-summary')?.textContent !== vorher),
    'Die Zusammenfassung im Detail zeigt noch die gelöschte Erfassung',
  );
});

test('Mengen und Erfassungen manueller Einträge gegen die Datenbank', { concurrency: 1 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dbOderSkip(t, _req);
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
  const { updateManualPart } = _req('src/teile/manuelleTeile.js');
  const { updateManualFig } = _req('src/figuren/manuelleFiguren.js');
  const { recordAcquisitionForDay } = _req('src/bestand/acquisitions.js');
  const { testServer } = require('./helpers/server');
  const { base } = testServer(_req, {
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const teilZeilen = (pn, cid = 5) =>
    db.all(
      `SELECT id, quantity FROM part_acquisitions WHERE user_id = $1 AND part_number = $2 AND color_id = $3
      ORDER BY created_at, id`,
      [uid, pn, cid],
    );

  await t.test('eine Mengenerhöhung legt auch ohne bestehende Erfassung eine Zeile an', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-leer', 5, 'manual')`, [
      uid,
    ]);
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'ma-fig-leer', 'manual')`, [uid]);
    await updateManualPart(uid, 'ma-leer', 5, { quantity: 3 });
    await updateManualFig(uid, 'ma-fig-leer', { quantity: 2 });
    assert.deepEqual(
      (await teilZeilen('ma-leer')).map(r => r.quantity),
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

  await t.test('die LIFO-Reduktion entfernt die neueste Erfassung zuerst', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-lifo', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
                  VALUES ($1, 'ma-lifo', 5, 2, 1, 'N', NOW() - INTERVAL '3 days'),
                         ($1, 'ma-lifo', 5, 1, 2, 'N', NOW())`,
      [uid],
    );
    const [alt] = await teilZeilen('ma-lifo');
    await updateManualPart(uid, 'ma-lifo', 5, { quantity: 2 });
    assert.deepEqual(
      await teilZeilen('ma-lifo'),
      [{ id: alt.id, quantity: 2 }],
      'Beim Verringern muss die heutige Erfassung zuerst weichen, nicht die älteste',
    );
    await updateManualPart(uid, 'ma-lifo', 5, { quantity: 1 });
    assert.deepEqual(await teilZeilen('ma-lifo'), [{ id: alt.id, quantity: 1 }]);
  });

  await t.test('die Tagesregel gilt für alle drei Arten mit ihrem eigenen Schlüssel', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, 'ma-1') ON CONFLICT DO NOTHING`, [uid]);
    const erfasse = (art, keys) => recordAcquisitionForDay(art, uid, keys, { quantity: 1, price: 4, condition: 'N' });
    for (const [art, keys] of [
      ['set', ['ma-1']],
      ['part', ['ma-tag', 5]],
      ['fig', ['ma-fig-tag']],
    ]) {
      assert.deepEqual(await erfasse(art, keys), { merged: false }, `${art}: die erste Erfassung des Tages`);
      assert.deepEqual(
        await erfasse(art, keys),
        { merged: true },
        `${art}: der zweite Kauf desselben Tages stockt nicht auf`,
      );
    }
    // Eine andere Farbe ist ein anderes Teil, kein zweiter Kauf.
    assert.deepEqual(
      await erfasse('part', ['ma-tag', 7]),
      { merged: false },
      'Eine andere Farbe wurde mit der ersten zusammengelegt',
    );
    assert.deepEqual(
      (await teilZeilen('ma-tag', 5)).map(r => r.quantity),
      [2],
    );
    assert.deepEqual(
      (await teilZeilen('ma-tag', 7)).map(r => r.quantity),
      [1],
    );
  });

  await t.test('der Bearbeiten-Pfad lehnt ab, was die Tagesregel verbietet', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-datum', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
                  VALUES ($1, 'ma-datum', 5, 1, 1.5, 'N', NOW()),
                         ($1, 'ma-datum', 5, 1, 1.5, 'N', NOW() - INTERVAL '5 days')`,
      [uid],
    );
    const [frueher, heute] = await teilZeilen('ma-datum');
    const tag = async id =>
      (
        await db.get(
          `SELECT to_char(COALESCE(tag, (created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') AS t
         FROM part_acquisitions WHERE id = $1`,
          [id],
        )
      ).t;
    const aendere = (id, body) =>
      fetch(`${base}/api/v1/parts/ma-datum/5/acquisitions/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const r = await aendere(frueher.id, { date: await tag(heute.id) });
    assert.equal(r.status, 409, 'Ein Datum, an dem derselbe Kauf schon steht, muss abgelehnt werden');
    assert.equal((await r.json()).code, 'datum_belegt');
    assert.equal(
      (await aendere(frueher.id, { date: await tag(heute.id), condition: 'U' })).status,
      200,
      'Ein anderer Zustand am selben Tag ist eine eigene Erfassung und erlaubt',
    );
  });

  await t.test('das Löschen eines manuellen Eintrags räumt die Kaufpreise mit ab', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-weg', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price)
                  VALUES ($1, 'ma-weg', 5, 2, 3)`,
      [uid],
    );
    const r = await fetch(`${base}/api/v1/parts/ma-weg/5`, { method: 'DELETE' });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(await teilZeilen('ma-weg'), [], 'Verwaiste Erfassungen zählen in den Finanzsummen weiter');
  });
});

test('kein Anlege-Pfad schreibt direkt in eine Erfassungstabelle', () => {
  // Verbot: Erfassungen entstehen nur über recordAcquisitionForDay — sonst
  // gälte die Tagesregel (erfassung-je-zustand-db.test.js) nicht für jeden Weg.
  for (const f of [
    'src/teile/manuelleTeile.ts',
    'src/figuren/manuelleFiguren.ts',
    'routes/api_v1/sets.ts',
    'src/sets/dienst.ts',
  ]) {
    const src = strip(read(f));
    assert.doesNotMatch(
      src,
      /INSERT INTO (part|minifig|set)_acquisitions/,
      `${f}: Erfassungen gehören über recordAcquisitionForDay geschrieben`,
    );
  }
  for (const f of [
    'routes/api_v1/sets.ts',
    'src/teile/manuelleTeile.ts',
    'src/figuren/manuelleFiguren.ts',
    'routes/api_v1/acquisitions.ts',
    'src/sammlung/erfassungen.ts',
  ]) {
    assert.doesNotMatch(
      strip(read(f)),
      /SELECT id FROM \w+_acquisitions WHERE[\s\S]{0,160}created_at[^\n]*::date/,
      `${f}: keine eigene Kopie der Tagesprüfung`,
    );
  }
});

test('der Altbestand wird einmalig auf eine Zeile je Tag zusammengefasst', () => {
  // Die neue Regel greift erst beim nächsten Schreiben — bereits bestehende
  // Doppelzeilen verschwinden nicht von selbst.
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
  // Gruppiert wird je Eintrag UND Tag; Käufe an verschiedenen Tagen bleiben
  // getrennt, sie sind der Grund für die Erfassungshistorie.
  assert.match(mig, /GROUP BY user_id, set_number, created_at::date/);
});

test('Teile und Minifiguren stehen in den Finanzen je Kaufpreis in einer Zeile', () => {
  const fc = require('./helpers/sources').finanzQuelle();
  // Drei: Sets, manuelle Teile, manuelle Minifiguren — alle drei Tabellen im
  // Finanzen-Reiter zeigen dieselbe Form.
  // Teile und Figuren teilen sich bewerteManuell(); zusammen mit bewerteSet() drei Wege.
  const acqLines = [...fc.matchAll(/acquisitions: rows,/g)];
  assert.equal(
    acqLines.length + (fc.match(/= bewerteManuell\(|\.\.\.bewerteManuell\(/g) || []).length - 1,
    3,
    'Alle drei Bewertungen müssen die Einzelzeilen mitliefern',
  );

  const fin = read('public/js/04-finance.js');
  pruefeParameter(fin, 'pmRows', ['it', 'label'], 'ein Eintrag ergibt eine Zeile je Erfassung');
  assert.match(
    fin,
    /const acqs = it\.acquisitions \|\| \[\];/,
    'Ohne Erfassungen (Altbestand) bleibt es bei der einen Zeile',
  );
});

test('die Mengenerhöhung mittelt den Kaufpreis, statt ihn stehen zu lassen', () => {
  // Der frühere Zweig erhöhte bei einer heutigen Erfassung NUR die Menge. Ein
  // heute dazugekauftes Exemplar zum aktuellen Marktpreis verschwand damit im
  // alten Stückpreis — die Zeile zeigte zwei Stück zum Preis des ersten.
  const src = require('./helpers/sources').setKernQuelle();
  const fn = src.slice(
    src.indexOf('async function adjustAcquisitionsToQuantity'),
    src.indexOf('async function addSet'),
  );
  assert.doesNotMatch(
    fn,
    /UPDATE set_acquisitions SET quantity = quantity \+ \$1/,
    'Kein direktes Aufstocken mehr — das entscheidet recordAcquisitionForDay',
  );
  assert.match(
    fn,
    /await recordAcquisition\(userId, setNumber, delta, plan\.price, plan\.condition, dbh, !!plan\.geschaetzt, plan\.currency \?\? null\);/,
    'Auch die Erhöhung läuft über den gemeinsamen Schreibweg',
  );
  // Der Preis kommt aus priceForNewAcquisition() — ausgelagert, weil der
  // BrickLink-Abruf darin VOR dem Advisory-Lock laufen muss (ein Netzaufruf
  // in offener Transaktion hielte Sperre und Verbindung).
  assert.match(
    fn,
    /pricePlan \?\? await priceForNewAcquisition\(userId, setNumber, dbh\)/,
    'Ein vorab ermittelter Preis muss durchgereicht werden können',
  );
  // Ziel der Mengenänderung ist seit einer früheren Runde das EIGENE Konto (`uid`) und
  // nicht mehr der Besitzer irgendeiner Haushaltszeile: Angezeigt wird die
  // Gesamtmenge, geschrieben wird die Differenz auf das eigene Konto. Die
  // geprüfte REGEL ist unverändert: Preis ermitteln (Netzaufruf), DANN sperren.
  assert.match(
    src,
    /const plan = [\s\S]{0,80}await priceForNewAcquisition\(uid, sn\)[\s\S]{0,400}withInventoryLock\(uid, sn/,
    'In updateSet muss der Preis VOR der Sperre stehen',
  );
  assert.doesNotMatch(src, /function isToday\(/, 'Die eigene Tagesprüfung gehört entfernt');
});

test('eine Mengenänderung läuft unter der Bestandssperre', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#src-stelle
  const src = require('./helpers/sources').setKernQuelle();
  const fn = src
    .slice(src.indexOf('async function updateSet'), src.indexOf("router.put('/:setNumber'"))
    // Kommentare weg: Der Erklärtext oben zitiert den alten Aufruf samt
    // .catch(() => {}) und würde die Prüfung sonst selbst auslösen.
    .replace(/\/\/[^\n]*/g, '');
  // Ziel ist seit einer früheren Runde das eigene Konto (`uid`) — die Regel bleibt:
  // EINE gesperrte Transaktion für Menge und Erfassungen.
  assert.match(fn, /withInventoryLock\(uid, sn/, 'Menge und Erfassungen gehören in EINE gesperrte Transaktion');
  assert.doesNotMatch(
    fn,
    /adjustAcquisitionsToQuantity\([^)]*\)\.catch\(/,
    'Ein verschluckter Fehler hinterlässt eine Menge ohne passende Erfassungen',
  );
  assert.doesNotMatch(
    fn,
    /await db\.run\('UPDATE sets SET quantity/,
    'Die Mengenänderung darf nicht an der Transaktion vorbei laufen',
  );
  // Und die Differenz muss aus der GESAMTMENGE des Blickfelds kommen, nicht
  // aus der Zeile eines einzelnen Kontos — sonst zeigte das Detail eine
  // Haushaltszahl an, während das „+" gegen eine andere rechnete.
  // Die Abfrage steht seit Migration 0036 in db/bestandsmenge.ts; hier …
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#stelle-3
  assert.match(
    fn,
    /repo\.setMenge\(dbh, 'blickfeld', leseFeld/,
    'Die Ausgangsmenge muss über das Blickfeld summiert werden',
  );
});

test('kein stiller Fehler mehr auf Bestandstabellen', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#tabellen
  const TABELLEN = [
    'sets',
    'parts',
    'minifigs',
    'set_acquisitions',
    'part_acquisitions',
    'minifig_acquisitions',
    'instructions',
  ];
  const schreibt = new RegExp(`\\b(UPDATE|INSERT INTO|DELETE FROM)\\s+(${TABELLEN.join('|')})\\b`);
  const dateien = [
    'routes/api_v1/sets.ts',
    'src/sets/dienst.ts',
    'src/sammlung/erfassungen.ts',
    'src/teile/manuelleTeile.ts',
    'src/figuren/manuelleFiguren.ts',
    'routes/api_v1/sets.ts',
    'routes/api_v1/parts.ts',
    'routes/api_v1/minifigs.ts',
    'routes/api_v1/acquisitions.ts',
    'src/sets/setMove.ts',
    'src/bestand/acquisitions.ts',
    // Seit einer früheren Runde nach Domänen aufgeteilt.
    'src/sets/abfragen.ts',
    'src/teile/abfragen.ts',
    'src/figuren/abfragen.ts',
  ];
  const fundstellen = [];
  for (const datei of dateien) {
    const zeilen = strip(read(datei)).split('\n');
    zeilen.forEach((zeile, i) => {
      if (!/\.catch\(\(\)\s*=>\s*\{\}\)/.test(zeile)) return;
      // Das Statement steht oft ein paar Zeilen über dem Catch (mehrzeilige
      // Aufrufe) — deshalb der Blick nach oben.
      const umfeld = zeilen.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (schreibt.test(umfeld)) fundstellen.push(`${datei}:${i + 1}`);
    });
  }
  assert.deepEqual(
    fundstellen,
    [],
    `Stiller Fehler auf einer Bestandstabelle: ${fundstellen.join(', ')} — ` +
      'entweder durchreichen oder logAndContinue() aus src/infra/fehler.ts',
  );
});
