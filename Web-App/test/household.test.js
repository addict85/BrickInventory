/**
 * Household — link accounts.
 *
 * The rules in code and schema; what can be executed runs against the
 * database here or in household-db.test.js.
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   A  createInvitation stores the code instead of its hash → red “the
 *      invitation code is only stored as a hash …”
 *   B  darfSchreibenFuer asks householdOf() instead of the link → red
 *      “write rights never come from memory”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkParameter } = require('./helpers/sources');
const kompakt = require('./helpers/sources').kompakt;

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('invitation and write right against the database', { concurrency: 1 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const hh = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const namen = [`hh_haupt_${process.pid}`, `hh_unter_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    hh.reportHouseholdChange();
    await db.pool.end().catch(() => {});
  });

  await t.test('an account does not link with itself', async () => {
    // Several parent accounts are allowed (migration 0046); the schema forbids linking
    // with oneself. Counter-check (09.11.2026): rule account_links_no_self removed → red.
    await assert.rejects(
      db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $1)', [ids[0]]),
      (/** @type {any} */ e) => e.code === '23514',
    );
  });

  await t.test('the invitation code is only stored as a hash in the database', async () => {
    // As with API tokens: whoever reads the database should not be able to redeem an invitation.
    // Like a request of the account: invitations stand under its row security.
    const { code } = await require('./helpers/sources').asAccount(ids[0], () => hh.createInvitation(ids[0]));
    assert.ok(code, 'kein Code erzeugt');
    const zeilen = await db.all('SELECT token_hash FROM account_link_invites WHERE main_user_id = $1', [ids[0]]);
    assert.equal(zeilen.length, 1);
    assert.notEqual(zeilen[0].token_hash, code, 'Der Code steht im Klartext in der Datenbank');
    const roh = code.replace(/[\s-]/g, '').toUpperCase();
    assert.ok(!zeilen[0].token_hash.toUpperCase().includes(roh), 'Der Code steht (umformatiert) in der Datenbank');
    assert.match(zeilen[0].token_hash, /^[0-9a-f]{64}$/, 'Gespeichert wird ein SHA-256-Hash');
  });

  await t.test('write rights never come from memory', async () => {
    // The view is remembered (household-memory-db.test.js); about a
    // write access only the state of the database may decide.
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [ids[0], ids[1]]);
    hh.reportHouseholdChange();
    // Under the main account's row security: the runtime role does not see foreign links (0121).
    const als = (uid, f) => require('./helpers/sources').asAccount(uid, f);
    assert.deepEqual(
      (await als(ids[0], () => hh.householdOf(ids[0]))).memberIds,
      ids,
      'Vorbedingung: das Unterkonto ist gemerkt',
    );
    assert.equal(await als(ids[0], () => hh.darfSchreibenFuer(ids[0], ids[1])), true);
    // Unlinked from outside without this process hearing of it.
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [ids[0]]);
    assert.deepEqual(
      (await als(ids[0], () => hh.householdOf(ids[0]))).memberIds,
      ids,
      'Vorbedingung: das Gedächtnis ist noch alt',
    );
    assert.equal(
      await als(ids[0], () => hh.darfSchreibenFuer(ids[0], ids[1])),
      false,
      'darfSchreibenFuer entscheidet nach dem gemerkten Blickfeld',
    );
    assert.deepEqual(
      await als(ids[0], () => hh.schreibbereich(ids[0])),
      [ids[0]],
      'schreibbereich entscheidet nach dem gemerkten Blickfeld',
    );
    assert.equal(await als(ids[1], () => hh.darfSchreibenFuer(ids[1], ids[1])), true, 'Eigene Daten immer');
  });
});

test('web app and app get the same endpoints', () => {
  // Stage 6: the four household routes now exist only once, under
  // /api/v1; the web app calls the same address (requireToken takes both
  // credentials). Previously this check spanned TWO files and required
  // that both offer everything — the weaker version of the same statement.
  const src = read('routes/api_v1/settings.ts');
  for (const fn of ['householdStatus', 'createInvitation', 'joinHousehold', 'unlinkAccounts']) {
    assert.ok(src.includes(fn), `routes/api_v1/settings.ts: ${fn} fehlt`);
  }
  // And the second version must not come back: every household route exactly once.
  for (const pfad of [
    "/api/v1/settings/household'",
    "/api/v1/settings/household/invite'",
    "/api/v1/settings/household/redeem'",
    "/api/v1/settings/household/unlink'",
  ])
    assert.equal(src.split(pfad).length - 1, 1, `${pfad} steht nicht genau einmal in routes/api_v1/settings.ts`);
  // No own rule in the route — they are in src/household/household.ts.
  assert.doesNotMatch(src, /account_links/, 'Routen dürfen nicht selbst gegen account_links abfragen');
});

test('the web app offers inviting and redeeming to every account', () => {
  // An account can belong to several main accounts; each needs its own
  // invitation. A hidden input field prevented exactly that.
  const js = require('./helpers/sources').ansichtQuelle('settings');
  assert.match(js, /inviteEl\.style\.display = ''/);
  assert.match(js, /redeemEl\.style\.display = ''/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Household view: lists, finances, moving, write rights
// ═══════════════════════════════════════════════════════════════════════════

test("the household's portfolio curve is retroactive", () => {
  // The statement stays, the way there has changed: the
  // portfolio snapshots ('__portfolio__<id>') no longer exist. They
  // lay at different times per account — added up they would yield
  // drops that never happened — and they recorded what WAS …
  const p = require('./helpers/sources').portfolioSource();
  assert.doesNotMatch(
    p,
    /__portfolio__/,
    'Der Schnappschuss-Weg ist zurück — er kann weder rückwirkend rechnen ' +
      'noch den heutigen Bestand über die Zeit zeigen',
  );
  assert.match(p, /GROUP BY s\.set_number/, 'Dasselbe Set in zwei Konten darf nicht doppelt in die Summe');
  assert.match(p, /FROM price_history ph/, 'Die Kurve muss aus dem Preisverlauf je Set entstehen');
});

test('moving goes via the daily rule, not via UPDATE user_id', () => {
  // A direct UPDATE would leave two entries of the same day in the target account
  // — exactly the state the edit path rejects.
  // ohneKommentare(): the RATIONALES of these rules stand in setMove.ts as a
  // comment, and they QUOTE the statements that must no longer exist …
  const mv = kompakt(
    require('./helpers/sources').ohneKommentare(require('./helpers/sources').serviceSource('src/sets/setMove.ts')),
  );
  assert.ok(
    mv.includes("bookDailyEntry('set', toId, [sn]"),
    'Erfassungen müssen einzeln über den gemeinsamen Helfer wandern',
  );
  assert.doesNotMatch(mv, /UPDATE set_acquisitions SET user_id/, 'Kein direktes Umhängen der Erfassungen');
  // If the target account already owns the set, the quantities add up because
  // the ENTRIES move — here stood for that
  // `UPDATE sets SET quantity = quantity + $1`. With migration 0036 the
  // column no longer exists, and a quantity UPDATE on `sets` would now be an
  // error. So checked exactly the other way round.
  assert.doesNotMatch(
    mv,
    /UPDATE\s+sets\s+SET[^;`']*\bquantity\s*=/,
    'Die Stückzahl eines Sets wird nicht mehr geschrieben — sie steht in ' +
      'set_acquisitions und wird beim Lesen gerechnet (db/stockQuantity.ts)',
  );

  // The switch of the whole set has lived in the v1 factory since an earlier round.
  const src = read('routes/api_v1/sets.ts');
  // This is a PATTERN rule: it catches a deleted line. That the
  // lock really applies — on (source account, set) and not on the
  // target account or a fixed key — runs in
  // test/lock-on-move-db.test.js via the real address; both
  // together, not one instead of the other.
  assert.ok(src.includes('sets.moveSet('), 'Die Route ruft den Dienst');
  assert.ok(
    kompakt(read('src/sets/setMove.ts')).includes('setEntriesReassign(t, sn, fromId'),
    'Das Verschieben läuft über setEntriesReassign',
  );
  assert.ok(kompakt(mv).includes('sperren: [{ konto: fromId, schluessel: sn }]'), 'Serialisiert über das Quellkonto');
  // The whole set and single purchase prices run through THE SAME implementation — the
  // partial case is no special path but the general case with a selection.
  const acq = read('routes/api_v1/acquisitions.ts');
  const calls =
    (mv.match(/setEntriesReassign\(t, sn/g) || []).length + (acq.match(/setEntriesReassign\(t, sn/g) || []).length;
  assert.ok(
    calls >= 1,
    'Der Eigentümerwechsel muss über setEntriesReassign laufen — in routes/sets.ts ' +
      '(ganzes Set) oder in der gemeinsamen Fabrik (einzelne Kaufpreise)',
  );
});

test('manual parts and minifigures carry the owner', () => {
  // Unlike sets they are NOT condensed: two accounts with the same
  // part are two stocks with their own quantity and own purchase price, and every
  // edit path leads to exactly one row. Without a badge the list would look
  // like a duplicate row.
  const h = kompakt(require('./helpers/sources').handlerQuelle());
  // Checked on the parameters, not on the wording: one day tightening `rows: any[]`
  // to `rows: Row[]` is an improvement and must not appear here as an
  // error (see checkParameter() in the helper).
  checkParameter(h, 'besitzerAnhaengen', ['uids', 'rows']);
  assert.match(
    h,
    /if \(uids\.length < 2 \|\| !rows\?\.length\) return rows;/,
    'Im Einzelkonto darf keine Plakette erscheinen',
  );
  // The table name before it is allowed since migration 0031: the query
  // joins the stock to resolve the storage location name and must therefore
  // qualify its columns (`t.id` instead of `id`). The statement stays
  // the same — without user_id in the selection there is no owner.
  assert.match(
    h,
    /SELECT (?:t\.)?id, (?:t\.)?user_id, (?:t\.)?part_number/,
    'Ohne user_id in der Abfrage gibt es keinen Besitzer',
  );

  const fc = kompakt(require('./helpers/sources').finanzQuelle());
  const uses = (fc.match(/await (?:kx?\.household\.)?besitzerAnhaengen\(uids,/g) || []).length;
  // Since UI review 12 also the sets: every row is the stock of one account.
  assert.equal(uses, 3, 'Set-, Teile- und Minifiguren-Bewertung brauchen den Besitzer');
});

test('the parts summary carries across several accounts too', () => {
  // The table is built PER ACCOUNT. For the household it reads over all
  // involved accounts and condenses over part_key — the same part in
  // two accounts yields ONE row with the sum, just like the same part from
  // two sets within one account.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(
    h,
    /const groupSql = multi \? ' GROUP BY part_key, color_id' : '';/,
    'Ohne Gruppierung erschiene dasselbe Teil je Konto einmal',
  );
  assert.match(
    h,
    /SELECT 1 FROM parts_summary WHERE \$\{where\} GROUP BY part_key, color_id/,
    'Auch die Gesamtzahl muss Teile zählen, nicht Konten',
  );
  assert.match(
    h,
    /COUNT\(DISTINCT ps\.part_key\)::int AS unique_parts/,
    'COUNT(*) zählte im Haushalt Konten statt Teile — und ::int muss bleiben, ' +
      'sonst hängt der JSON-Typ am Zweig (früher: SUM(BIGINT) käme als Zahl, ' +
      'SUM(INTEGER) als Text)',
  );

  // The view is only fresh if it is for EVERY account — “two of three
  // are current" would yield a sum of fresh and old stocks.
  const ps = read('src/parts/summary.ts');
  assert.match(ps, /const results = await Promise\.all\(ids\.map\(id => summaryFresh\((?:k, )?id, opts\)\)\);/);
  assert.match(ps, /return results\.every\(Boolean\);/);
});

test('the UI shows owners and account selection only in the household', () => {
  // In a single account every tile would say “belongs to me" — pure noise.
  const gal = kompakt(require('./helpers/sources').frontendQuelle());
  assert.match(gal, /export function ownerBadges/);
  assert.match(gal, /if \(!item\?\.owners\?\.length\) return '';/);
  // A selection with a single option is no selection.
  assert.match(gal, /if \(members\.length < 2\) \{ box\.style\.display = 'none'; continue; \}/);
  // All three add forms get the same list — set, manual
  // part, manual minifigure. Previously the account selection was only there for sets.
  // Since then there are FOUR forms — the catalog dialog (“add to
  // gallery") was the only one not connected and always added to the …
  for (const feld of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner']) {
    assert.ok(
      gal.includes(`'${feld}'`),
      `Die Kontoauswahl fehlt im Erfassungsweg ${feld} — dort landet dann alles ` +
        'stillschweigend beim eigenen Konto',
    );
  }
  assert.match(gal, /\['add-owner', 'ap-owner', 'af-owner'/, 'Die Kontoauswahl gehört in alle drei Erfassen-Formulare');
  const fig = kompakt(require('./helpers/sources').frontendQuelle());
  assert.match(fig, /owner_user_id: selectedOwner\('ap-owner'\)/);
  assert.match(fig, /owner_user_id: selectedOwner\('af-owner'\)/);
  // And the owner badge on the manual tiles.
  assert.match(fig, /\$\{ownerBadges\(p\)\}/);
  assert.match(fig, /\$\{ownerBadges\(f\)\}/);
  // The move box in the set dialog is removed: moving goes via
  // the PURCHASE PRICE, row by row. What is checked now is that the
  // owner column in the purchase price dialog only appears in the household — and
  // in BOTH dialogs (sets and manual entries).
  const adm = kompakt(require('./helpers/sources').adminSource());
  assert.doesNotMatch(
    adm,
    /renderMoveBox|moveSetToAccount/,
    'Das ganze Set darf nicht mehr auf einmal verschoben werden',
  );
  const ownerCols = (
    adm.match(/acquisition\.members\.length > 1 \? (?:html)?`<th>\$\{t(?:Raw)?\('household\.owner'\)\}<\/th>` : ''/g) ||
    []
  ).length;
  assert.equal(ownerCols, 2, 'Eigentümer-Spalte fehlt in einem der beiden Kaufpreis-Dialoge');
});

test('the account filter applies per view and is sent along everywhere', () => {
  // Whoever sees the whole household in the gallery may want only their own
  // numbers in the finances — hence a separate value per view.
  const core = require('./helpers/sources').coreSource();
  // 'wanted' was added on 24.09. (Marco's specification: “In der Merkliste
  // noch einen Filter analog den Sets einbauen inkl. Inhaber"). The server
  // always understood `accounts=` on /v1/wanted — only the
  // choice in the UIs was missing.
  assert.match(core, /export const SCOPE_VIEWS = \['gallery', 'parts', 'minifigs', 'finance', 'wanted'\];/);
  assert.match(core, /localStorage\.getItem\('bim_scope_' \+ view\)/, 'Die Wahl soll einen Neuladen überleben');
  // 'all' is the server's default and is omitted.
  assert.match(core, /if \(m && m !== 'all'\) p\.set\('accounts', m\);/);

  // Each of the five views appends it to its queries.
  assert.match(read('public/js/collection.js'), /addScopeParam\(p, 'gallery'\)/);
  assert.match(read('public/js/parts.js'), /addScopeParam\(p, 'parts'\)/);
  assert.match(read('public/js/minifigs.js'), /addScopeParam\(p, 'minifigs'\)/);
  assert.match(read('public/js/wanted.js'), /addScopeParam\(p, 'wanted'\)/);

  // In the finances tab ALL four queries — otherwise a sum from one
  // view would stand next to a listing from another.
  const fin = read('public/js/finances.js') + read('public/js/value-curve.js');
  // Addresses under /v1 since stage 5 — the rule is unchanged: ALL four
  // queries of the tab carry the same filter.
  for (const ep of [
    '/v1/finance/valuation',
    '/v1/finance/parts-valuation',
    '/v1/finance/minifigs-valuation',
    '/v1/finance/pnl',
  ]) {
    assert.ok(
      fin.includes(`'${ep}'+scopeQuery('finance')`) || fin.includes(`\`${ep}\${scopeQuery('finance')}\``),
      `${ep} ohne Kontofilter`,
    );
  }
  assert.match(
    fin,
    /portfolio-history\?period=\$\{_chartPeriod\}\$\{scopeMode\('finance'\)/,
    'Auch die Kurve muss dem Filter folgen',
  );
});

test('the switch only reloads the affected view', () => {
  // Reloading all four at once would touch three views that
  // nobody looks at — and trigger price fetches in doing so.
  const gal = kompakt(require('./helpers/sources').frontendQuelle());
  assert.match(gal, /export function onScopeChange\(view\)/);
  assert.match(gal, /if \(view === 'finance'\) emit\('financesLoad'\);/);
  // The parts and minifigures tabs have TWO lists — the one from sets and the
  // manually entered one. The manual area loads via its own endpoint
  // and otherwise stayed unfiltered.
  assert.match(gal, /if \(view === 'parts'\) \{ loadParts\(\); loadManualParts\(\); \}/);
  // And it only appears for a main account with sub-accounts.
  assert.match(gal, /if \(!isMain\) \{ el\.style\.display = 'none'; continue; \}/);
  assert.match(gal, /initScopeSelects\(members\);/);
  // One entry per sub-account, by name.
  assert.match(
    gal,
    /subs\.map\(m => (?:html)?`<option value="\$\{m\.id\}">/,
    'Die Auswahl muss jedes Unterkonto einzeln führen',
  );
});

test('moving ONLY goes via the purchase price', async () => {
  // Moving a set as a whole sounds convenient but hides what
  // actually moves: three entries are three purchases that in the household
  // may belong to different children. Whoever wants to move everything changes
  // every row — and sees how many there are in doing so. …
  const { moveSet } = require('./helpers/sources').areaPage('sets');
  await assert.rejects(
    moveSet(1, '10294-1', 1, 2, []),
    (/** @type {any} */ e) => e.art === 'ungueltig' && e.code === 'kaufpreise_angeben',
    'move ohne acquisition_ids muss abgelehnt werden',
  );

  // And the UI does not even offer it.
  assert.doesNotMatch(require('./helpers/sources').adminSource(), /renderMoveBox|moveSetToAccount/);
  assert.doesNotMatch(read('public/index.html'), /m-move-box/);
});

/**
 * What this rule checks, and what NOT
 */
test('manual parts and minifigures also move via the purchase price', () => {
  // The same rule for all three kinds. A manually entered part has no
  // contents — only quantity and entry move.
  const mv = kompakt(read('src/inventory/reassign.ts'));
  assert.match(mv, /export async function manualEntryReassign/);
  assert.match(mv, /addPurchaseAtTag\(t, kind, toId, keyValues/, 'Auch hier gilt: eine Tageszeile je Konto');

  // The entry routes now only stand in the v1 factory, which
  // now serves web app AND app. The rule applies unchanged — it is only checked in
  // ONE place instead of three, because there is only one left.
  // Parts and minifigures go via the same call; the kind comes from the table.
  // Since the layer rebuild the rule stands in the service; the route only calls it.
  const f = 'src/collection/acquisitions.ts';
  const src = kompakt(read(f));
  assert.ok(src.includes('t.inventory.manualEntryReassign(art, keys, id, from, to)'), `${f}: Wechsel fehlt`);
  assert.match(
    src,
    /if \(to === null\) fachfehler\('verboten', 'kein_schreibrecht'\)/,
    `${f}: ohne Schreibrecht muss 403 kommen`,
  );
});

test('the app routes know the owner change', () => {
  // ── Where this test comes from ──────────────────────────────────────────
  // The Android app sent owner_user_id to the v1 PUT routes — but the factory
  // only read quantity, price and condition. The request went through as an EMPTY update
  // and answered success:true: the switch in the app was a
  // silent no-op, without error message and without movement.
  const v1 = read('src/collection/acquisitions.ts');
  assert.match(v1, /body\.owner_user_id/, 'Der Erfassungsdienst muss owner_user_id auswerten');
  assert.match(
    v1,
    /t\.sets\.setEntriesReassign\(String\(keys\[0\]\), from, to, \[id\]\)/,
    'Sets wandern über dieselbe Umsetzung wie beim Verschieben',
  );
  assert.match(v1, /t\.inventory\.manualEntryReassign\(art, keys, id, from, to\)/);
});
