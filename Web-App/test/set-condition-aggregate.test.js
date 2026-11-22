/**
 * Condition aggregate of a set.
 *
 * Aggregate, condition on creation and in the market price: set-state-aggregate-db.test.js.
 *
 * Counter-check (08.11.2026): in theme-boot.js apply() without the ALLOWED check →
 * red “an unknown theme value resets nothing”.
 * Counter-check (08.11.2026): `applySetAggregate(d.set)` deleted in acqSave
 * or applySetAggregate without renderGallery() → red “the tile takes the
 * condition from the server's response”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { checkParameter } = require('./helpers/sources');
const { openUi, warte } = require('./helpers/ui');

test('the aggregate rule now exists in only one place', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /function conditionAggregate/, 'Der gemeinsame Helfer fehlt');
  // Neither setsLesen()/readSet() nor the manual lists may ever phrase the rule
  // on their own — it stands in conditionFromAcquisitions().
  // Two parameters, not three: the third was the stored condition of the
  // master row. Migration 0032 took it from the sets, 0035 from the parts and
  // minifigures — there is no fallback left it could point to.
  checkParameter(h, 'conditionFromAcquisitions', ['acqCount', 'usedCount'], 'der gemeinsame Regel-Helfer fehlt');
  // Hide comments: the explanatory text at the helper quotes the rule itself.
  const code = h.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // The anchor deliberately names NO variable name: it used to be called
  // `usedCount`, and when the typing made a normalized `used` of it,
  // the old pattern found nothing any more — the test reported 0 instead of 1.
  // Meant is the RULE, not its notation. Phrased like this it catches …
  const inlineRules = [...code.matchAll(/\b\w+ > 0 \? 'U'/g)];
  assert.equal(
    inlineRules.length,
    1,
    `Die Regel steht ${inlineRules.length}× im Code — sie gehört genau einmal in conditionFromAcquisitions()`,
  );
});

test('an unknown theme value resets nothing', () => {
  // That was the cause of the flicker at login: showApp() passes
  // d.settings.app_theme on, and a missing value switched to 'classic'
  // — including cache poisoning.
  const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const dom = new jsdom.JSDOM('<!doctype html><html data-theme="brick"><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const w = dom.window;
  w.fetch = () => new Promise(() => {});
  w.eval(fs.readFileSync(path.join(ROOT, 'public', 'js', 'theme-boot.js'), 'utf8'));
  for (const wert of [undefined, null, '', 'gibtsnicht']) {
    assert.equal(w.__bimApplyTheme(wert), null, `${wert} wurde als Design angenommen`);
    assert.equal(
      w.document.documentElement.getAttribute('data-theme'),
      'brick',
      `${wert} hat das Design zurückgesetzt`,
    );
    assert.equal(w.localStorage.getItem('bim_theme'), 'brick', `${wert} hat den Cache überschrieben`);
  }
  w.close();
});

test('a manually entered part gets market price and entry', () => {
  // Two gaps: the market price was fetched without a condition (i.e. the new price,
  // even for „Gebraucht"), and no row arose at all in
  // part_acquisitions — the purchase price only stood in the master table, while
  // detail view and condition rule work with the acquisitions. …
  const src =
    fs.readFileSync(path.join(ROOT, 'src/finances/marketPrice.ts'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src/parts/manualParts.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function addManualPart'), src.indexOf('async function changeManualPart'));

  // The condition must go into the price determination — otherwise the new price comes, even
  // for „Gebraucht".
  const withoutState = [
    ...src.matchAll(
      /(?:currentPartMarketPrice|currentPartMarketPrice)\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?([^)]*)\)/g,
    ),
  ]
    .filter(m => !m[1].includes('function')) // not the definition itself
    .filter(m => m[1].split(',').length < 4);
  assert.equal(
    withoutState.length,
    0,
    'Diese Aufrufe holen den Marktpreis OHNE Zustand:\n  ' +
      withoutState.map(m => m[0]).join('\n  ') +
      '\nDann fällt die Ermittlung intern auf den Standardzustand zurück, und ein ' +
      'als gebraucht erfasstes Teil bekommt den Neupreis.',
  );
  // Self-proof: without occurrences an empty list says nothing.
  const allCalls = [
    ...src.matchAll(
      /(?:currentPartMarketPrice|currentPartMarketPrice)\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?/g,
    ),
  ];
  assert.ok(allCalls.length >= 4, `Nur ${allCalls.length} Vorkommen von currentPartMarketPrice( — Muster veraltet?`);
  // Two paths: newly created and captured again — BOTH need an
  // acquisition. The second used to end with `return { action: 'updated' }`
  // without creating one; a differing acquisition date got lost in the process.
  //
  // Since hardened-93 writing happens via addPurchaseAtTag(), which tops up the
  // row of the day in the same condition instead of creating a second one.
  const writes = [
    ...fn.matchAll(
      /(?:addPurchaseAtTag|bookDailyEntry)\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?'part', uid,/g,
    ),
  ];
  assert.equal(
    writes.length,
    2,
    `${writes.length} statt 2 Erfassungs-Schreibvorgänge — Neuanlage und Zweiterfassung brauchen je einen`,
  );
  assert.match(fn, /createdAt: acquiredAt/, 'Das Erfassungsdatum muss übernommen werden');
  // The rule, not its notation
  assert.match(
    fn,
    /price: erfassungsPreis/,
    'Die Erfassung nimmt nicht den Preis, der ohne Marktpreis NULL ist ' +
      '(src/finances/priceRule.ts, acquisitionPrice) — in der Erfassung hiesse eine 0 ' +
      '„für null Franken gekauft"',
  );
  const regel = fs.readFileSync(path.join(ROOT, 'src/finances/priceRule.ts'), 'utf8');
  assert.match(
    regel,
    /erfassungsPreis:\s*kaufpreis > 0 \? kaufpreis : null/,
    'src/finances/priceRule.ts wandelt die 0 der Stammzeile nicht mehr in NULL für die Erfassung',
  );
  assert.match(fn, /condition: effectiveCondition/, 'Die Erfassung braucht den Zustand');
});

test('the minifigure market price asks BrickLink even without a separate BL number', () => {
  // The fetch only ran when a differing bl_fig_number was stored.
  // For manually captured figures that is the exception — mostly the
  // own number matches the BrickLink number. The fetch was
  // skipped, the parts estimate took over, and without a
  // parts composition from Rebrickable it delivers nothing: no price at all.
  const src = fs.readFileSync(path.join(ROOT, 'src/finances/marketPrice.ts'), 'utf8');
  // Since an earlier round the fetch is called figMarketPriceWithOrigin: it delivers
  // next to the price the condition it comes from. currentMinifigMarketPrice
  // stands next to it as a thin wrapper and only passes the number on — what is checked
  // here is the fetch itself, not the wrapper.
  const fn = src.slice(
    src.indexOf('async function figMarketPriceWithOrigin'),
    src.indexOf('async function manuellerFigurenkauf'),
  );
  assert.ok(fn.length > 0, 'Der Minifiguren-Preisabruf ist nicht mehr zu finden');

  assert.match(fn, /for \(const num of \[blFigNumber, figNumber\]\)/, 'Beide Nummern müssen versucht werden');
  assert.doesNotMatch(
    fn,
    /if \(blFigNumber\) \{\s*const priceData/,
    'Der Abruf darf nicht mehr an einer separaten BL-Nummer hängen',
  );

  // Order: BrickLink first, parts estimate only as a fallback
  const iLoop = fn.indexOf('for (const num of');
  const iEst = fn.indexOf('estimateMinifigsPrice');
  assert.ok(iLoop > 0 && iEst > iLoop, 'Die Teile-Schätzung gehört hinter den BrickLink-Abruf');

  // And it estimates in the DETERMINED condition, not in the default condition: without
  // a BrickLink number the estimate is the only price there is — if it
  // ran fixed on „Neu", a figure captured as used got the new price
  // of its parts. For figures WITH a number the condition had long been considered;
  // exactly the case without a number fell through.
  assert.match(
    fn,
    /estimateMinifigsPrice\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?figNumber, userId, effCond\)/,
    'Der ermittelte Zustand muss in die Schätzung',
  );

  const est = src.slice(
    src.indexOf('async function estimateFigPriceFromParts'),
    src.indexOf('async function currentMinifigMarketPrice'),
  );
  assert.match(
    est,
    /fetchPartPrice\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?blPartNum, p\.color_id \?\? NO_COLOR, cond,/,
    'Die Teilepreise müssen im übergebenen Zustand geholt werden',
  );
  assert.doesNotMatch(
    est.replace(/\/\/[^\n]*/g, ''),
    /fetchPartPrice\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?[^)]*DEFAULT_PRICE_CONDITION/,
    'Kein fester Standardzustand mehr in der Schätzung',
  );

  // And the valuation calls it per condition — otherwise two rows with
  // different conditions would show the same market price.
  const fc = require('./helpers/sources').finanzQuelle();
  // viewerId instead of uid: since the household view „whose settings"
  // and „whose data" are two quantities. The estimate needs the SETTINGS
  // (currency) of the asking account — and still the condition.
  // Estimating happens in the job preise_nachladen; the valuation queues the condition.
  assert.match(
    fc,
    /kind: 'schaetzung', number: key, condition: cond/,
    'Die Minifiguren-Bewertung muss den Zustand mitgeben',
  );
});

test('the parts estimate lands in cache and history', () => {
  // Reported: in the detail dialog of a minifigure WITHOUT a BrickLink number there were
  // only dashes at market price (new) and (used), the history stayed empty —
  // although purchase prices were captured in both conditions.
  const src =
    fs.readFileSync(path.join(ROOT, 'src/finances/marketPrice.ts'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src/minifigs/manualMinifigs.ts'), 'utf8');
  const est = src.slice(
    src.indexOf('async function estimateFigPriceFromParts'),
    src.indexOf('async function currentMinifigMarketPrice'),
  );

  // Cache and history per condition are checked by test/minifigs-estimate-store-db.test.js.
  // Only with a real price: a zero point would look like a crash in the chart.
  assert.match(est, /if \(priced === 0\) return null;/, 'Ohne bepreiste Teile darf nichts geschrieben werden');

  // And when creating, the determined price must go into the acquisition
  // Since the date adoption created_at belongs to the column list.
  // Both paths (new creation and second capture), read without comments.
  const withoutComment = src.replace(/\/\/[^\n]*/g, '');
  const erfassungen = [
    ...withoutComment.matchAll(
      /(?:addPurchaseAtTag|bookDailyEntry)\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?'fig', uid, \[num\], \{\s*quantity,\s*price: (?:re\.)?acquisitionPrice/g,
    ),
  ];
  assert.equal(erfassungen.length, 2, 'Die Erfassung muss den tatsächlich verwendeten Kaufpreis tragen');
});

test('manual minifigures also create a row on every entry', () => {
  // The same early exit as with the parts: `if (existing) { … return }`
  // ended the path before an acquisition arose. The quantity rose, but no
  // purchase price and no differing acquisition date.
  const src = fs.readFileSync(path.join(ROOT, 'src/minifigs/manualMinifigs.ts'), 'utf8');
  const fn = src.slice(
    src.indexOf('async function addManualMinifig'),
    src.indexOf('async function addManualMinifig') + 6000,
  );

  const writes = [
    ...fn.matchAll(
      /(?:addPurchaseAtTag|bookDailyEntry)\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?'fig', uid, \[num\]/g,
    ),
  ];
  assert.equal(
    writes.length,
    2,
    `${writes.length} statt 2 Erfassungs-Schreibvorgänge — Neuanlage und Zweiterfassung brauchen je einen`,
  );
  assert.match(fn, /createdAt: acquiredAt/, 'Das Erfassungsdatum muss übernommen werden');
  // The second capture must determine the price via the same function
  assert.match(
    fn,
    /const re = await manualMinifigPurchase\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?uid, \{/,
    'Die Zweiterfassung darf die Preislogik nicht neu ausformulieren',
  );
});

test('entries without a purchase price are filled in', () => {
  // During the CSV import the set is often not yet in the price cache, and the
  // BrickLink fetch fails for many sets on the daily quota. The acquisition
  // then arose without a purchase price — the market price appeared later nevertheless
  // as soon as the price job filled the cache. Exactly this deviation was reported.
  const job =
    fs.readFileSync(path.join(ROOT, 'src/inventory/purchasePriceBackfill.ts'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'src/inventory/repository/backfill.ts'), 'utf8');

  assert.match(
    job,
    /async function backfillAcquisitions\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?\)/,
    'Nachtrag fehlt',
  );
  // Independent of the set row: backfillSets() only sees sets with a NULL price
  assert.match(
    job,
    /FROM \$\{l\.setErfassungen\(\)\} e\s+WHERE purchase_price IS NULL/,
    'Der Nachtrag muss alle preislosen Erfassungen finden',
  );
  // The condition of the ACQUISITION determines the price, not that of the set
  assert.match(
    job,
    /(?:k\.finances\.)?currentMarketPrice\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?row\.set_number, row\.user_id, row\.condition \|\| null\)/,
    'Ein gebraucht erfasstes Exemplar braucht den Gebrauchtpreis',
  );
  // No mirroring into the sets row
  assert.doesNotMatch(
    job.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''),
    /UPDATE sets SET/,
    'Der Nachtrag schreibt wieder in die sets-Zeile — dort gibt es seit ' +
      'Migration 0032 weder Kaufpreis noch Zustand',
  );
  assert.match(job, /\(\) => backfillAcquisitions\(k\)/, 'Der Durchlauf ist nicht eingehängt');

  // And the import itself should end without a price less often
  // The set service reads the market price from cache and history via finanzen (owner of price_history).
  const sets =
    require('./helpers/sources').setCoreSource() +
    fs.readFileSync(path.join(ROOT, 'src/finances/repository/priceCache.ts'), 'utf8');
  assert.match(
    sets,
    /FROM price_history[\s\S]{0,200}ORDER BY \(condition = \$3\) DESC, recorded_at DESC/,
    'Die Historie fehlt als letzter Rückfall beim Import',
  );
});

test('new sets fetch the right condition, not the default', () => {
  // When creating a new set neither the sets row nor the
  // set_acquisitions row exists yet. conditionsNeededFor() therefore found nothing and
  // fell back to 'N' — a set imported as „Gebraucht" got the
  // new price as purchase price, because the subsequent price query for 'U' still …
  const job = fs.readFileSync(path.join(ROOT, 'src/finances/priceRun.ts'), 'utf8');
  const { hatParameter } = require('./helpers/sources');
  assert.ok(hatParameter(job, 'conditionsNeededFor', 'hintCondition', true), 'Der Hinweis-Parameter fehlt');
  assert.match(
    job,
    /if \(hintCondition === 'U' \|\| hintCondition === 'N'\) own\.add\(hintCondition\);/,
    'Der Hinweis muss in die Liste der zu holenden Zustände einfliessen',
  );
  assert.ok(hatParameter(job, 'fetchPriceForSet', 'hintCondition', true), 'fetchPriceForSet muss den Hinweis annehmen');
  assert.match(
    job,
    /conditionsNeededFor\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?setNumber, userId, hintCondition\)/,
    'fetchPriceForSet muss den Hinweis weiterreichen',
  );

  // And aktuellerMarktpreis must pass it along when creating — exactly at the
  // place where the row does not exist yet.
  const preis = fs.readFileSync(path.join(ROOT, 'src/finances/marketPrice.ts'), 'utf8');
  assert.match(
    preis,
    /fetchPriceForSet\(k, setNumber, userId, condition\)/,
    'aktuellerMarktpreis muss den angefragten Zustand als Hinweis übergeben',
  );
});

// Price and history route in the condition of the set are checked on the server by test/price-state-of-sets-db.test.js.
test('exactly ONE condition resolution for single sets — setState', () => {
  // Fifth location of the same error in this session: valueSets,
  // aktuellerMarktpreis, gainAndLoss, the web app history route and now the
  // Android API each had their own version. From now on exactly one function for
  // callers without already loaded acq_count/used_count fields.
  const fc = require('./helpers/sources').finanzQuelle();
  // Since the household view it also takes a list of accounts — the
  // main account queries the condition of a set that belongs to a sub-account.
  checkParameter(fc, 'conditionOfSet', ['uid', 'setNumber'], 'der gemeinsame Helfer fehlt');
  assert.match(
    fc,
    /export async function conditionOfSet\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?/,
    'Der Helfer muss exportiert sein',
  );

  // Both callers must really import it, not put an own
  // query next to it.
  // The history routes only call it indirectly now — via
  // src/finances/priceHistory.ts, which web app and Android share.
  const helper = fs.readFileSync(path.join(ROOT, 'src/finances/priceHistory.ts'), 'utf8');
  // REPHRASED to: the import line was checked LITERALLY.
  // Since the fix for the BrickLink keys priceHistory.ts fetches two more names
  // from the same file — the line now reads
  //     import { setState, resolveBlColorId, resolveBlPartNumber } … …
  assert.match(
    helper,
    /import \{[^}]*\bsetState\b[^}]*\} from '\.\/financeCalc';/,
    'src/finances/priceHistory.ts muss den gemeinsamen Helfer benutzen',
  );

  // The price route of the Android API still resolves by itself (it fetches a
  // price, not a history) — exactly one occurrence.
  const apiV1 = fs.readFileSync(path.join(ROOT, 'src/sets/prices.ts'), 'utf8');
  const uses = (apiV1.match(/sk\.finances\.setState\(scope, sn\)/g) || []).length;
  assert.equal(uses, 1, 'Die /price-Route muss ihn benutzen; der Verlauf geht über priceHistory.ts');
});

// The database lock of the rebuild is checked by test/parts-summary-lock-db.test.js.

test('CDN requests force IPv4', () => {
  // Without an IPv6 route image fetches ran silently until the deadline. The set image download
  // during import goes via the shared fetch helper; that it and the pool
  // of the image CDNs force IPv4 is checked by the test below on the running code.
  const setsFile = fs.readFileSync(path.join(ROOT, 'src/images/setImages.ts'), 'utf8');
  assert.match(
    setsFile,
    /await (?:k\.externalSources\.sources\s*\.)?(?:hole(?:Https|Bild)|fetch(?:Https|Image))\(url, \{/,
    'Der Hintergrund-Download beim Import muss ebenfalls IPv4 erzwingen — dieselbe Ursache, derselbe Ort',
  );
});

test('IPv4 is forced on ALL outgoing HTTPS calls, not only in the image proxy', async () => {
  // The server has no IPv6 route; without family: 4 every outgoing
  // connection hangs silently until the deadline. abruf.ts is the one way out.
  // Counter-check (05.11.2026): family: 4 deleted from https.get in abruf.ts or from the pool → red.
  const _req = require('./helpers/sources').buildAndRequire();
  const { holeHttps } = _req('src/infra/fetch.js');
  const { openImage } = _req('clients/imageCdn.js');
  const { recording } = require('./helpers/https-recording');
  const hosts = ['cdn.rebrickable.com'];
  const url = 'https://cdn.rebrickable.com/media/sets/1-1.jpg';
  const aufrufe = await recording(async () => {
    await holeHttps(url, { hosts, maxBytes: 1000, timeoutMs: 5000 }).catch(() => {});
    await holeHttps(url, { hosts, maxBytes: 1000, timeoutMs: 5000, methode: 'POST', rumpf: '{}' }).catch(() => {});
    await openImage(url, { maxBytes: 1000, pool: true }).catch(() => {});
  });
  assert.deepEqual(
    aufrufe.map(a => [a.kind, a.options.family]),
    [
      ['get', 4],
      ['request', 4],
      ['get', 4],
    ],
  );
  assert.equal(aufrufe[2].options.agent?.options?.family, 4, 'der Pool der Bild-CDNs erzwingt IPv4 nicht');
});

test('the background job for parts and minifigures now creates preview images', () => {
  // Reported: manually captured parts (and the same pattern also applied to
  // minifigures) never got a preview. Cause: the hourly
  // background job downloaded the image and updated image_local,
  // but never called vorschauErzeugenAus() — unlike for sets (the same …
  const src = require('./helpers/sources').serverAll();

  const partsLoop = src.slice(
    src.indexOf('for (const p of manualParts) {'),
    src.indexOf('for (const f of figsToFetch) {'),
  );
  // REPHRASED to: the WORDING of the line was checked
  //     const { vorschauErzeugenAus } = require('./src/images/thumbs');
  // When converting the late require() into real import statements it became
  // an import at the file head — the check turned red without its …
  assert.match(src, /vorschauErzeugenAus/, 'vorschauErzeugenAus ist in server.ts nicht mehr verfügbar');
  assert.match(
    partsLoop,
    /(?:vorschauErzeugenAus|\w+\.images\.createPreview)\(local\)\.catch\(logAndContinue\('[^']+'\)\);/,
    'Die Teile-Schleife muss vorschauErzeugenAus() nach einem erfolgreichen Download aufrufen',
  );

  const figsLoop = src.slice(
    src.indexOf('for (const f of figsToFetch) {'),
    src.lastIndexOf("await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht'"),
  );
  assert.match(
    figsLoop,
    /(?:vorschauErzeugenAus|\w+\.images\.createPreview)\(local\)\.catch\(logAndContinue\('[^']+'\)\);/,
    'Die Minifiguren-Schleife muss vorschauErzeugenAus() nach einem erfolgreichen Download aufrufen',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Which badges the tile shows (hardened-91)
// ═══════════════════════════════════════════════════════════════════════════
// utils/handlers.ts no longer exists since (split by …
const { buildAndRequire, handlerModule } = require('./helpers/sources');
const { conditionsFromAcquisitions, conditionFromAcquisitions } = handlerModule(buildAndRequire());

test('mixed entries result in TWO badges', () => {
  // The reported case: one copy new, one used. Until now the
  // tile only showed „Gebraucht" — the new acquisition was invisible although it
  // enters the valuation with its own price.
  assert.deepEqual(conditionsFromAcquisitions(2, 1), ['N', 'U']);
  // And the single statement next to it stays what it was.
  assert.equal(conditionFromAcquisitions(2, 1), 'U');
});

test('only one condition results in one badge', () => {
  assert.deepEqual(conditionsFromAcquisitions(3, 0), ['N'], 'alle Erfassungen neu → nur Neu');
  assert.deepEqual(conditionsFromAcquisitions(2, 2), ['U'], 'alle Erfassungen gebraucht → nur Gebraucht');
});

test('without entries “Neu” applies', () => {
  // Without acquisitions there is no stored value that counted: for
  // manual positions it fills in an acquisition and checks afterwards
  // that none remained without one; for parts and figures from a set …
  assert.deepEqual(conditionsFromAcquisitions(0, 0), ['N']);
  assert.equal(conditionFromAcquisitions(0, 0), 'N');
});

test('the order is fixed: new before used', () => {
  // Sorted by frequency the badges would swap places on the next purchase
  // — on a tile that one skims, exactly that stands out
  // as „has something changed?".
  assert.deepEqual(conditionsFromAcquisitions(5, 4), ['N', 'U']);
  assert.deepEqual(conditionsFromAcquisitions(5, 1), ['N', 'U']);
});

test('the tiles do not compute the badges themselves', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'components.js'), 'utf8');
  assert.match(gal, /export function condBadges/, 'Eine gemeinsame Fassung für Set-, Teile- und Minifiguren-Kacheln');
  // One badge, no copies with hard-coded colors instead of the CSS classes:
  // no row may carry a condition label AND an own color.
  for (const f of ['public/js/parts.js', 'public/js/minifigs.js', 'public/js/finances.js']) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    const inline = lines.filter(l => /common\.condition_(used|new)/.test(l) && /background:\s*var\(/.test(l));
    assert.equal(inline.length, 0, `${f}: Zustandsfarben gehören in die CSS-Klassen cond-new/cond-used`);
  }
});

test('the purchase price on the tile is quantity-weighted, not the maximum', () => {
  // MAX(purchase_price) showed the value 160 for 2x100 and 1x160.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /avg_purchase_price/, 'Der gewichtete Kaufpreis fehlt im Aggregat');
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'collection.js'), 'utf8');
  assert.match(
    gal,
    /s\.avg_purchase_price \?\? s\.max_purchase_price/,
    'Die Kachel muss den gewichteten Wert bevorzugen',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Login with email (hardened-100)
// ═══════════════════════════════════════════════════════════════════════════
const authModule = buildAndRequire()('src/account/nameRules.js');
const { loginNameValid, USERNAME_RE, EMAIL_RE } = authModule;

test('the login name may be an e-mail address', () => {
  // Above the field stands „Benutzername oder E-Mail", and the query searches in
  // both columns — but in front of it stood a guard that only allowed the
  // username pattern. The @ fell through, and the message spoke of
  // allowed characters in the username.
  assert.ok(loginNameValid('marco@example.com'));
  assert.ok(loginNameValid('marco.meier+lego@sub.example.co.uk'));
  assert.ok(loginNameValid('marco'), 'Benutzername muss weiterhin gehen');
  assert.ok(loginNameValid('mar_co.1-x'));
});

test('obvious nonsense still does not reach the query', () => {
  // The guard is not superfluous: it keeps garbage away from the query and from the
  // brute-force counter, which counts per IP and login name.
  for (const bad of [
    '',
    'ab',
    'marco meier',
    'kein@at',
    '@example.com',
    'a'.repeat(300) + '@example.com',
    "' OR 1=1 --",
  ]) {
    assert.equal(loginNameValid(bad), false, `\`${bad}\` sollte abgelehnt werden`);
  }
});

test('registration and profile stay with the username pattern', () => {
  // Otherwise somebody could enter another person's email address as a username
  // and pull that person's login to himself — the login searches in both
  // columns.
  assert.equal(USERNAME_RE.test('marco@example.com'), false);
  assert.ok(EMAIL_RE.test('marco@example.com'));
  // That /register applies this rule is checked by password-rule-db.test.js.
});

test('both login paths check the same', async () => {
  // Web app and Android API go through checkCredentials(); there an
  // unusable name is dropped before counter or database see it.
  // Counter-check (11.11.2026): the form check deleted in checkCredentials() → red here.
  const { checkCredentials } = buildAndRequire()('src/account/loginCheck.js');
  for (const name of ['a b', "' OR 1=1 --", '@example.com'])
    assert.deepEqual(
      await checkCredentials({ ip: '192.0.2.1' }, name, 'irgendein-Passwort'),
      { ok: false, absage: { kind: 'invalid', code: 'enter_name_or_email' } },
      name,
    );

  const dateien = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? dateien(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const alle = [...dateien(path.join(ROOT, 'routes')), ...dateien(path.join(ROOT, 'src'))];
  assert.ok(alle.length >= 30, `nur ${alle.length} Dateien durchsucht — Pfade veraltet?`);

  const kopien = alle
    .filter(f => /\/\^\[A-Za-z0-9_\.-\]\{3,32\}\$\/\.test\(\s*username\s*\)/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(ROOT, f));
  assert.deepEqual(kopien, [], `eigene Kopie des Benutzernamen-Musters statt USERNAME_RE: ${kopien.join(', ')}`);
});

test('the tile takes the condition from the server response', async () => {
  // The web app does not recompute the rule: it takes the aggregate of the PUT response. The gallery list
  // deliberately no longer answers afterwards — the tile may only come from the response to the change.
  const SET = { set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 1, conditions: ['N'], condition: 'N' };
  let listen = 0;
  const { w, d } = await openUi({
    '/v2/sets': () => (++listen === 1 ? { success: true, total: 1, themes: [], sets: [SET] } : new Promise(() => {})),
    '/v2/sets/10294-1': { success: true, set: SET },
    '/v2/sets/10294-1/acquisitions': {
      success: true,
      acquisitions: [
        {
          id: 7,
          quantity: 1,
          purchase_price: 100,
          condition: 'N',
          currency: 'EUR',
          created_at: '2026-10-01T10:00:00Z',
          user_id: 1,
        },
      ],
      totals: { quantity: 1, amount: 100, currency: 'EUR' },
    },
    '/v2/sets/10294-1/acquisitions/7': {
      success: true,
      set: { set_number: '10294-1', conditions: ['U'], condition: 'U' },
    },
  });
  const badges = () => d.querySelector('#gallery .sc .sbadges')?.textContent ?? '';
  try {
    assert.ok(await warte(() => /Neu/.test(badges())), `vorher: ${badges()}`);
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => d.querySelector('[data-click="openAcqModal"]')));
    d.querySelector('[data-click="openAcqModal"]').click();
    assert.ok(
      await warte(() => d.querySelector('select[data-change="acqSave"][data-arg3="cond"]')),
      'Keine Zustandswahl',
    );
    const wahl = d.querySelector('select[data-change="acqSave"][data-arg3="cond"]');
    wahl.value = 'U';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => /Gebraucht/.test(badges()) && !/Neu/.test(badges())), `nachher: ${badges()}`);
  } finally {
    w.close();
  }
});
