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
const { openUi, waitFor } = require('./helpers/ui');

test('the aggregate rule now exists in only one place', () => {
  const h = require('./helpers/sources').handlerSource();
  assert.match(h, /function conditionAggregate/, 'The shared helper is missing');
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
    `The rule appears ${inlineRules.length}× in the code — it belongs exactly once in conditionFromAcquisitions()`,
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
  for (const value of [undefined, null, '', 'gibtsnicht']) {
    assert.equal(w.__bimApplyTheme(value), null, `${value} was accepted as a design`);
    assert.equal(w.document.documentElement.getAttribute('data-theme'), 'brick', `${value} reset the design`);
    assert.equal(w.localStorage.getItem('bim_theme'), 'brick', `${value} overwrote the cache`);
  }
  w.close();
});

// Price and history route in the condition of the set are checked on the server by test/price-state-of-sets-db.test.js.
test('exactly ONE condition resolution for single sets — setState', () => {
  // Fifth location of the same error in this session: valueSets,
  // aktuellerMarktpreis, gainAndLoss, the web app history route and now the
  // Android API each had their own version. From now on exactly one function for
  // callers without already loaded acq_count/used_count fields.
  const fc = require('./helpers/sources').financeSource();
  // Since the household view it also takes a list of accounts — the
  // main account queries the condition of a set that belongs to a sub-account.
  checkParameter(fc, 'conditionOfSet', ['uid', 'setNumber'], 'der gemeinsame Helfer fehlt');
  assert.match(
    fc,
    /export async function conditionOfSet\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?/,
    'The helper must be exported',
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
    'src/finances/priceHistory.ts must use the shared helper',
  );

  // The price route of the Android API still resolves by itself (it fetches a
  // price, not a history) — exactly one occurrence.
  const apiV1 = fs.readFileSync(path.join(ROOT, 'src/sets/prices.ts'), 'utf8');
  const uses = (apiV1.match(/sk\.finances\.setState\(scope, sn\)/g) || []).length;
  assert.equal(uses, 1, 'The /price route must use it; the history goes via priceHistory.ts');
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
    'The background download on import must also force IPv4 — same cause, same place',
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
  const calls = await recording(async () => {
    await holeHttps(url, { hosts, maxBytes: 1000, timeoutMs: 5000 }).catch(() => {});
    await holeHttps(url, { hosts, maxBytes: 1000, timeoutMs: 5000, method: 'POST', bodyText: '{}' }).catch(() => {});
    await openImage(url, { maxBytes: 1000, pool: true }).catch(() => {});
  });
  assert.deepEqual(
    calls.map(a => [a.kind, a.options.family]),
    [
      ['get', 4],
      ['request', 4],
      ['get', 4],
    ],
  );
  assert.equal(calls[2].options.agent?.options?.family, 4, 'the pool of image CDNs does not force IPv4');
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
  assert.deepEqual(conditionsFromAcquisitions(3, 0), ['N'], 'all acquisitions new → only new');
  assert.deepEqual(conditionsFromAcquisitions(2, 2), ['U'], 'all acquisitions used → only used');
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
  assert.match(gal, /export function condBadges/, 'One shared version for set, part and minifigure tiles');
  // One badge, no copies with hard-coded colors instead of the CSS classes:
  // no row may carry a condition label AND an own color.
  for (const f of ['public/js/parts.js', 'public/js/minifigs.js', 'public/js/finances.js']) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    const inline = lines.filter(l => /common\.condition_(used|new)/.test(l) && /background:\s*var\(/.test(l));
    assert.equal(inline.length, 0, `${f}: condition colours belong in the CSS classes cond-new/cond-used`);
  }
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
  assert.ok(loginNameValid('marco'), 'A user name must still work');
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
    assert.equal(loginNameValid(bad), false, `\`${bad}\` should be rejected`);
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
      { ok: false, refusal: { kind: 'invalid', code: 'enter_name_or_email' } },
      name,
    );

  const files = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const all = [...files(path.join(ROOT, 'routes')), ...files(path.join(ROOT, 'src'))];
  assert.ok(all.length >= 30, `only ${all.length} files searched — paths outdated?`);

  const copies = all
    .filter(f => /\/\^\[A-Za-z0-9_\.-\]\{3,32\}\$\/\.test\(\s*username\s*\)/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(ROOT, f));
  assert.deepEqual(copies, [], `own copy of the user name pattern instead of USERNAME_RE: ${copies.join(', ')}`);
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
    assert.ok(await waitFor(() => /Neu/.test(badges())), `before: ${badges()}`);
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await waitFor(() => d.querySelector('[data-click="openAcqModal"]')));
    d.querySelector('[data-click="openAcqModal"]').click();
    assert.ok(
      await waitFor(() => d.querySelector('select[data-change="acqSave"][data-arg3="cond"]')),
      'no condition choice',
    );
    const choice = d.querySelector('select[data-change="acqSave"][data-arg3="cond"]');
    choice.value = 'U';
    choice.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => /Gebraucht/.test(badges()) && !/Neu/.test(badges())), `after: ${badges()}`);
  } finally {
    w.close();
  }
});
