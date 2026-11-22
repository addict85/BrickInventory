/**
 * Precomputed parts summary (src/parts/summary.ts).
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const { keineDb } = require('./helpers/db');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// ── Static checks (always) ────────────────────────────────────────────
test('the invalidation hangs on a trigger, not on calls', () => {
  // Since 0052 the triggers stand in a migration, no longer in the code.
  const src = fs.readFileSync(path.join(ROOT, 'db/migrations/0052-teilezusammenfassung-stand.sql'), 'utf8');
  assert.match(src, /FOR EACH STATEMENT/, 'Zeilen-Trigger würden bei einem CSV-Import 171 000 Mal feuern');
  for (const tbl of ['parts', 'sets']) {
    assert.match(src, new RegExp(`'${tbl}'`), `kein Trigger auf ${tbl}`);
  }
  assert.match(src, /bump_parts_version/, 'Versionszähler fehlt');

  // The counter hangs PER ACCOUNT — see the test further down. A global
  // counter (one row, id=1) invalidated the summary of all accounts
  // as soon as anybody wrote anything.
  assert.match(src, /parts_version_user/, 'Der Zähler muss je Konto geführt werden');
  assert.doesNotMatch(
    src,
    /UPDATE parts_version SET v = v \+ 1 WHERE id = 1/,
    'Der globale Zähler entwertet fremde Zusammenfassungen mit',
  );
  // All three operations need their own transition table.
  for (const [op, ref] of [
    ['INSERT', 'NEW TABLE AS neu'],
    ['DELETE', 'OLD TABLE AS alt'],
    ['UPDATE', 'OLD TABLE AS alt NEW TABLE AS neu'],
  ]) {
    assert.ok(src.includes(ref), `${op}: Übergangstabelle fehlt (${ref})`);
  }
  // On UPDATE BOTH sides count: if a row moves within the household between
  // accounts, the summaries of sender AND target are outdated.
  assert.match(
    src,
    /SELECT user_id FROM alt UNION SELECT user_id FROM neu/,
    'Ein Kontowechsel muss beide Zusammenfassungen entwerten',
  );
});

test('the live query stays as a fallback', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(
    h,
    /if \(summary\) return summary;/,
    'Ohne Rückfall wäre ein Fehler beim Aufbau ein Totalausfall der Ansicht',
  );
  const src = fs.readFileSync(path.join(ROOT, 'src/parts/summary.ts'), 'utf8');
  assert.match(src, /return false;/, 'summaryFresh muss Misserfolg melden können');
});

test('set_number and storage deliberately bypass the summary', () => {
  // Two filters, one reason: the summary is condensed by part and color
  // and cannot filter by anything that differs WITHIN a
  // group.
  const h = require('./helpers/sources').handlerQuelle();
  const row = /if \(filter\.withoutManual && ([^)]*)\)/.exec(h)?.[1] || '';
  assert.ok(
    row.includes('!filter.set_number'),
    'Die Teile EINES Sets sind ein anderer Anwendungsfall — dort ist die Live-Abfrage passend und schnell genug',
  );
  assert.ok(
    row.includes('!filter.storage'),
    'Der Lagerort steht in der Zusammenfassung nur verdichtet — ein Filter darauf träfe die Gruppe falsch',
  );
});

// ── Integration test (only with DB) ──────────────────────────────────────────
let db,
  H,
  PS,
  S,
  skip = null;
try {
  // Build into dist/ instead of in place — see helpers/sources.js.
  const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  environment({ SESSION_SECRET: 'test' });
  db = testData();
  H = require('./helpers/sources').handlerModule(_req);
  PS = _req('src/parts/summary.js');
  S = _req('src/inventory/metrics.js');
} catch (e) {
  skip = e.message;
}

test('summary matches the live query and does not go stale', { skip: skip || undefined }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const U = 990501;
  const clean = async () => {
    await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
    await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
    await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  };
  await clean();
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum','x',false) ON CONFLICT DO NOTHING",
    [U],
  );
  // Two sets, the second one present twice — the quantity must be multiplied along.
  await holdsSet(db, U, 'A-1', 1);
  await holdsSet(db, U, 'B-1', 2);
  // Since migration 0034 color label and name stand in the catalogs.
  // Not incidental here: the checks below look for the group via
  // `color_name === 'Rot'`.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES
    ('3001','Brick 2x4'),('3002','Plate 1x2'),('3003','Tile 1x1')
    ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
    ('3001',5,'Rot'),('3002',1,'Blau'),('3003',2,'Gruen')
    ON CONFLICT (part_number, color_id) DO NOTHING`);
  await holdsPart(db, U, '3001', { setNumber: 'A-1', quantity: 3, colorId: 5 });
  await holdsPart(db, U, '3001', { setNumber: 'B-1', quantity: 4, colorId: 5 });
  await holdsPart(db, U, '3002', { setNumber: 'A-1', quantity: 1, colorId: 1 });
  // The set list for 3003 already stands in the catalog now; below only the
  // stock row is added (a catalog change would update the group immediately).
  await db.run(`INSERT INTO set_parts (set_number, part_number, color_id, quantity) VALUES ('A-1','3003',2,9)
                ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET quantity = 9`);

  // Since the fix summaryFresh() NO longer builds in the request. The first
  // access of a user without a summary is therefore served from the
  // live query while the build starts in the background. For the
  // content check here it is built explicitly once.
  const first = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(first.source, 'db', 'ohne vorhandene Zusammenfassung muss die Live-Abfrage einspringen statt zu warten');
  await PS.rebuildNow(U);

  const r1 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r1.source, 'summary', 'die Zusammenfassung wurde nicht benutzt');
  assert.equal(r1.total, 2, 'zwei Teil/Farb-Gruppen erwartet');
  const rot = r1.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot.total_quantity, 3 * 1 + 4 * 2, 'die Set-Menge muss in die Teilemenge eingehen');

  // Change to parts → trigger → next read access rebuilds
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES ($1,'A-1','3003',2,'set')`,
    [U],
  );
  // The read access must NOT block any more now: it delivers the old
  // state and only triggers the build. Only afterwards are the numbers right again.
  const stale = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(stale.total, 2, 'der Lesezugriff soll den alten Stand liefern, nicht warten');
  await PS.rebuildNow(U);
  const r2 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r2.total, 3, 'nach dem Aufbau muss die neue Gruppe enthalten sein');

  // Change to the SET QUANTITY → likewise. Since migration 0036 it stands in
  // the acquisition, no longer in sets.quantity — and that is why the
  // invalidation trigger now also hangs on set_acquisitions (src/parts/summary.ts).
  // Without it the number here would stay and look plausible while doing so.
  await db.run("UPDATE set_acquisitions SET quantity=3 WHERE user_id=$1 AND set_number='B-1'", [U]);
  await PS.rebuildNow(U);
  const r3 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  const rot3 = r3.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot3.total_quantity, 3 * 1 + 4 * 3, 'eine geänderte Set-Menge muss durchschlagen');

  // The write of a FOREIGN account must invalidate nothing
  const FREMD = 990502;
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',false) ON CONFLICT DO NOTHING",
    [FREMD],
  );
  await PS.rebuildNow(U);
  assert.equal(await PS.summaryFresh(U, { strict: true }), true, 'Vorbedingung: die eigene Zusammenfassung ist frisch');
  await holdsPart(db, FREMD, '9999', { quantity: 1, colorId: 7 });
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    true,
    'Ein fremdes Konto darf die eigene Zusammenfassung nicht entwerten',
  );
  // The own change, on the other hand, does. `updated_at=updated_at` writes
  // nothing new — the trigger hangs on the UPDATE, not on the value.
  await db.run("UPDATE sets SET updated_at=updated_at WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    false,
    'Eine eigene Änderung an sets muss die Zusammenfassung entwerten',
  );

  // ── And a change to the ACQUISITIONS likewise ─────────────────────────
  //
  // New with migration 0036: the set quantity stands there. Without the trigger on
  // set_acquisitions this assertion would be the only place at which the
  // error would show — and it is here exactly for that reason.
  await PS.rebuildNow(U);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    true,
    'Vorbedingung: nach dem Neuaufbau ist die Zusammenfassung frisch',
  );
  // A changed purchase price does not invalidate (since 0052), a quantity does.
  await db.run("UPDATE set_acquisitions SET purchase_price = 1 WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    true,
    'Ein Kaufpreis ändert keine Teilemenge — die Zusammenfassung bleibt gültig',
  );
  await db.run("UPDATE set_acquisitions SET quantity=quantity+1 WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    false,
    'Eine Änderung an den Erfassungen muss die Zusammenfassung entwerten — die ' +
      'Setmenge steht dort (Migration 0036), und total_quantity rechnet mit ihr',
  );
  await db.run('DELETE FROM parts WHERE user_id=$1', [FREMD]);
  await PS.rebuildNow(U);

  // Statistics and color filter come from the same source
  const stats = await H.partStatsQuery(U);
  assert.equal(stats.unique_parts, 3);
  const colors = await H.partColorsQuery(U);
  assert.equal(colors.length, 3);

  // page limits
  const p1 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 2 });
  const p2 = await H.partsQuery(U, { exclude_manual: '1', page: 2, page_size: 2 });
  assert.equal(p1.parts.length, 2);
  assert.equal(p2.parts.length, 1);
  assert.equal(p1.total, 3, 'total muss die Gesamtzahl sein, nicht die der Seite');

  await clean();
  await db.run('DELETE FROM users WHERE id=$1', [U]);
});

test('the rebuild does not block the request', () => {
  // Core of the most recently reported error: summaryFresh() rebuilt SYNCHRONOUSLY
  // on an outdated version. Because the trigger raises the version on every
  // change to parts (CSV import, adding a set,
  // catalog enrichment), the next call of the parts tab paid the …
  const src = fs.readFileSync(path.join(ROOT, 'src/parts/summary.ts'), 'utf8');
  const fn = src.slice(
    src.indexOf('export async function summaryFresh'),
    src.indexOf('export async function rebuildNow'),
  );
  assert.ok(fn.length > 0, 'summaryFresh nicht gefunden');
  assert.doesNotMatch(
    fn,
    /await rebuild\(/,
    'summaryFresh darf nicht im Request aufbauen — genau das waren die drei Sekunden',
  );
  assert.match(
    fn,
    /rebuildInBackground\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?/,
    'Der Aufbau muss in den Hintergrund',
  );
  assert.match(
    fn,
    /return state !== null/,
    'Veralteter Stand wird ausgeliefert; ohne jeden Stand übernimmt die Live-Abfrage',
  );

  assert.match(src, /neuaufbau: new Map/, 'Ohne Sperre starten parallele Anfragen denselben Aufbau mehrfach');
  assert.match(
    src,
    /export async function rebuildNow/,
    'Für Stellen, die garantiert aktuelle Zahlen brauchen, muss es einen blockierenden Weg geben',
  );
});

test('metrics use no outdated state', () => {
  // Web app and Android query the same statistics via two endpoints.
  // During a background rebuild one read from the summary
  // and the other live — the parity check thereby failed reproducibly.
  // With strict both fall back to the live query together.
  const ps = fs.readFileSync(path.join(ROOT, 'src/parts/summary.ts'), 'utf8');
  assert.match(ps, /opts\?: \{ strict\?: boolean \}/, 'strict-Variante fehlt');
  assert.match(ps, /if \(opts\?\.strict\) return false;/, 'Ein veralteter Stand muss unter strict abgelehnt werden');

  const h = require('./helpers/sources').handlerQuelle();
  // Since the household view the helper gets a LIST of accounts (uids)
  // and checks each one individually; strict applies unchanged.
  assert.match(
    h,
    /await summaryFresh\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?uids, \{ strict: true \}\)/,
    'partStatsQuery muss strict aufrufen',
  );
  // The list may still take the outdated state — there it does not matter
  assert.match(
    h,
    /tryPartsSummary\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?userId/,
    'Der Listenpfad bleibt unverändert',
  );
});

test('both paths of the metrics count THE SAME — also with manual parts', { skip: skip || undefined }, async t => {
  // The finding
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const U = 990502;
  await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
  await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',false) ON CONFLICT DO NOTHING",
    [U],
  );
  await holdsSet(db, U, 'A-1', 1);
  await holdsPart(db, U, '3001', { setNumber: 'A-1', quantity: 3, colorId: 5 });
  await holdsPart(db, U, '9999', { quantity: 11, colorId: 7 });

  // Path 1: from the summary.
  await PS.rebuildNow(U);
  const fromSummary = await H.partStatsQuery([U]);

  // Path 2: the fallback. The summary is removed for it — then
  // summaryFresh(strict) delivers false, and partStatsQuery goes live.
  await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  const fromLive = await H.partStatsQuery([U]);

  assert.deepEqual(
    fromLive,
    fromSummary,
    'Die beiden Wege zählen Verschiedenes. Aus der Zusammenfassung: ' +
      `${JSON.stringify(fromSummary)}, live: ${JSON.stringify(fromLive)}. ` +
      'Das manuell erfasste Teil (Menge 11) gehört in keine der Set-Mengen.',
  );

  // Kinds and colors count both sources, like the list below (see
  // parts-metrics-single-db.test.js); the quantity stays separated by source.
  assert.equal(fromSummary.unique_parts, 2, 'Das manuelle Teil fehlt in den Sorten');
  assert.equal(fromSummary.unique_colors, 2, 'Die Farbe des manuellen Teils fehlt');
  assert.equal(fromSummary.total_parts, 3, 'Die Menge des manuellen Teils steckt in der Summe');
  // Shown separately: the parts tab counts both together, like the
  // tile of the collection (/v2/stats). Counter-check (01.11.2026): manual_parts in
  // kennzahlen() fixed to 0 → red „Die einzeln erfassten Teile fehlen …“.
  assert.equal(fromSummary.manual_parts, 11, 'Die einzeln erfassten Teile fehlen in der Aufschlüsselung');
  const total = await S.getStats([U]);
  assert.deepEqual(
    [total.total_parts, total.set_parts, total.manual_parts],
    [14, 3, 11],
    'Die Kachel der Sammlung zeigt nicht dieselbe Summe wie der Teile-Reiter',
  );

  await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
  await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
});

// Close the connection pool — otherwise the test process hangs after the last
// test and the runner reports the file as failed, although every
// check was green. Without a reachable database this never showed: then
// no connection was opened at all.
test('close connections', async () => {
  await db.pool.end().catch(() => {});
});
