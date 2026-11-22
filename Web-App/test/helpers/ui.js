/**
 * The whole web UI in jsdom: real index.html, real bundle, and a
 * fetch that delivers a predefined response per path. That way a test checks what
 * the UI makes of a server response, without server and without browser.
 */
const fs = require('node:fs');
const path = require('node:path');
const { complete } = require('./contract-fill');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
// TEST_BUENDEL: the bundle with source map from test-run.js --coverage.
const { BUNDLE_FILE, placeBundleSafe } = require('./bundle');
placeBundleSafe();
const BUNDLE_PATH = process.env.TEST_BUENDEL || BUNDLE_FILE;
const BUNDLE = fs.readFileSync(BUNDLE_PATH, 'utf8');

const ANMELDUNG = {
  '/v2/startup-status': { ready: true, progress: 0, total: 0, step: null, sub: null },
  '/v2/auth/me': {
    success: true,
    loggedIn: true,
    user: { id: 1, username: 'anna', is_admin: true, secondFactorRequired: false },
  },
  '/v2/sets/household-members': { success: true, members: [{ id: 1, username: 'anna', is_self: true, depth: 0 }] },
  '/v2/stats': {
    success: true,
    stats: {
      total_sets: 0,
      total_quantity: 0,
      total_pieces: 0,
      total_parts: 0,
      total_minifigs: 0,
      total_instructions: 0,
      currency: 'EUR',
      default_condition: 'N',
      user_default_condition: null,
    },
  },
  '/v2/sets': { success: true, sets: [], count: 0, total: 0, themes: [] },
  '/v2/parts': { success: true, parts: [], total: 0, page: 1, page_size: 50, source: 'db' },
  '/v2/parts/stats': { success: true, stats: { unique_parts: 0, unique_colors: 0, total_parts: 0 } },
  '/v2/parts/colors': { success: true, colors: [] },
  '/v2/parts/categories': { success: true, categories: [] },
  '/v2/parts/manual': { success: true, parts: [], total: 0, page: 1, page_size: 0 },
  '/v2/parts/brick-colors': { success: true, colors: [] },
  '/v2/minifigs': { success: true, figs: [], total: 0 },
  '/v2/minifigs/stats': { success: true, stats: { types: 0, total_quantity: 0, manual: 0, unique_figs: 0 } },
  '/v2/minifigs/manual': { success: true, figs: [], total: 0, page: 1, page_size: 0 },
  '/v2/finance/valuation': {
    success: true,
    currency: 'EUR',
    total_value: '0',
    condition: 'N',
    foreign_currency_purchases: 0,
    converted_purchase_prices: 0,
    prices_pending: 0,
    guide_type: 'sold',
    ttl_hours: 24,
    cache_ttl_hours: 24,
    sets: [],
    totals: { min: '0', avg: '0', max: '0', qty_avg: '0' },
    value_total: 0,
    total: 0,
    page: 1,
    page_size: 0,
  },
  '/v2/finance/parts-valuation': {
    success: true,
    currency: 'EUR',
    parts: [],
    total_value: '0',
    foreign_currency_purchases: 0,
    converted_purchase_prices: 0,
    prices_pending: 0,
    value_total: 0,
    total: 0,
    page: 1,
    page_size: 0,
  },
  '/v2/finance/minifigs-valuation': {
    success: true,
    currency: 'EUR',
    figs: [],
    total_value: '0',
    foreign_currency_purchases: 0,
    converted_purchase_prices: 0,
    prices_pending: 0,
    value_total: 0,
    total: 0,
    page: 1,
    page_size: 0,
  },
  '/v2/finance/pnl': {
    success: true,
    currency: 'EUR',
    sets: [],
    totals: {
      purchase: '0',
      current: '0',
      foreign_currency_purchases: 0,
      converted_purchase_prices: 0,
      pnl_current: '0',
      pnl_purchase: '0',
      pnl_percent: null,
      sets_purchase: '0',
      parts_purchase: '0',
      figs_purchase: '0',
      grand_total: '0',
    },
    total: 0,
    page: 1,
    page_size: 0,
  },
  '/v2/finance/portfolio-history': {
    success: true,
    currency: 'EUR',
    period: '1y',
    points: [],
    y_axis: [],
    data_points: 0,
    period_change_pct: null,
  },
  '/v2/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: 'probe' } },
  '/v2/auth/users': {
    success: true,
    users: [
      {
        id: 1,
        username: 'anna',
        is_admin: true,
        is_active: true,
        second_factor: false,
        awaiting_confirmation: false,
        created_at: '2026-10-01T00:00:00Z',
        announced: [{ type: 'deactivate', effective_at: '2026-10-02T00:00:00Z' }],
      },
    ],
  },
  '/v2/admin/api-limits': { success: true, limits: { rebrickable: 25000, bricklink: 4000, brickset: 100 } },
};

const SIGNED_OUT = {
  '/v2/startup-status': ANMELDUNG['/v2/startup-status'],
  '/v2/auth/me': { success: true, loggedIn: false },
};

// An error in a loader that the UI itself does not catch should
// not end the test run; it lands in `fehler` and the test can see it.
const error = [];
process.on('unhandledRejection', e => {
  error.push(e);
});

let _contract;
const vertrag = () => {
  if (!_contract) {
    require('./sources').buildDist();
    _contract = {
      ...require(path.join(ROOT, 'dist', 'src', 'contract', 'index.js')),
      Fehler: require(path.join(ROOT, 'dist', 'src', 'contract', 'base.js')).ErrorBody,
    };
  }
  return _contract;
};

/**
 * The response as the server may send it: missing required fields are
 * completed by the route's schema (contract-fill.js); a wrong type throws. A deliberately broken response carries
 * `$contractViolating: '<reason>'` and goes out unchanged.
 */
function checkResponse(methode, url, daten) {
  if (!daten || typeof daten !== 'object' || daten === UNASSIGNED || daten.$contractViolating) return daten;
  const path =
    '/api' +
    String(url)
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api/, '')
      .split('?')[0];
  const { routeForRequest, Fehler } = vertrag();
  const status = daten.$status ?? 200;
  const schema = status >= 400 ? Fehler : routeForRequest(methode.toUpperCase(), path)?.response;
  if (!schema) return daten;
  const rumpf = Array.isArray(daten)
    ? daten
    : Object.fromEntries(Object.entries(daten).filter(([k]) => !k.startsWith('$')));
  // Error responses are not completed: the test states error and code itself.
  const wert = status >= 400 ? rumpf : complete(schema, JSON.parse(JSON.stringify(rumpf)));
  const r = schema.safeParse(wert);
  if (!r.success) {
    throw new Error(
      `Test response violates the contract: ${methode} ${path} (${status}): ` +
        r.error.issues
          .slice(0, 6)
          .map(i => `${i.path.join('.') || '$'}: ${i.message}`)
          .join(' | '),
    );
  }
  return Array.isArray(daten) ? wert : { ...wert, $status: daten.$status };
}

// Paths not predefined: the test does not rely on them, so no contract check.
const UNASSIGNED = Object.freeze({ success: true });

function responseFor(antworten, url, o = {}) {
  const path = String(url)
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/api/, '')
    .split('?')[0];
  const a = Object.hasOwn(antworten, path) ? antworten[path] : UNASSIGNED;
  return typeof a === 'function' ? a(url, o) : a;
}

const takt = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Waits until `bedingung()` is true (at most `ms`). */
async function warte(bedingung, ms = 3000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await takt(10);
  }
  return bedingung();
}

/**
 * @param {object} [antworten]  path → response (object or function(url))
 * @param {{ loggedIn?: boolean, language?: string, browserLanguage?: string, before?: (w: any) => void, url?: string }} [opt]
 *   url: address of the page (default http://localhost/), e.g. https:// for a page with TLS.
 */
async function openUi(antworten = {}, opt = {}) {
  const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const alle = { ...(opt.loggedIn === false ? SIGNED_OUT : ANMELDUNG), ...antworten };
  // The account's language wins over the stored one on loading — so set both.
  if (opt.language && !antworten['/v2/settings/raw'])
    alle['/v2/settings/raw'] = {
      success: true,
      settings: { ...ANMELDUNG['/v2/settings/raw'].settings, language: opt.language },
    };
  const dom = new jsdom.JSDOM(HTML, {
    runScripts: 'outside-only',
    url: opt.url || 'http://localhost/',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const aufrufe = [];
  try {
    w.localStorage.setItem('bim_lang', opt.language || 'de');
  } catch (_) {
    /* jsdom without storage */
  }
  // A response may be a promise (delayed) or throw (network error);
  // `$status` sets the HTTP status, e.g. { $status: 500, success: false }.
  let open = 0;
  w.fetch = async (url, o = {}) => {
    aufrufe.push({ url: String(url), method: o.method || 'GET', body: o.body, headers: o.headers || {} });
    open++;
    let daten;
    try {
      daten = await responseFor(alle, url, o);
    } finally {
      setTimeout(() => open--, 0);
    }
    // Thrown outside the window: the UI would otherwise catch the error as a network error.
    try {
      daten = checkResponse(o.method || 'GET', url, daten);
    } catch (e) {
      setImmediate(() => {
        throw e;
      });
    }
    const status = daten?.$status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: { get: () => 'application/json' },
      json: async () => JSON.parse(JSON.stringify(daten)),
    };
  };
  w.console.warn = () => {};
  if (opt.browserLanguage) Object.defineProperty(w.navigator, 'language', { value: opt.browserLanguage });
  // jsdom knows no IntersectionObserver; nothing is loaded later here.
  w.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // index.html loads the dictionaries as separate <script> tags.
  for (const l of ['de', 'en']) w.eval(fs.readFileSync(path.join(ROOT, 'public', 'locales', l + '.js'), 'utf8'));
  if (opt.before) opt.before(w);
  // With file names instead of w.eval(): that way V8 attributes the coverage to the bundle.
  new (require('node:vm').Script)(BUNDLE, { filename: BUNDLE_PATH }).runInContext(dom.getInternalVMContext());
  if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  if (opt.loggedIn !== false)
    await warte(
      () =>
        w.document.getElementById('app')?.style.display !== 'none' &&
        w.document.getElementById('app')?.style.display !== '',
    );
  await takt(20);
  /** Until no response is pending anymore and the UI has processed the last one. */
  const ruhig = async (ms = 3000) => {
    const ok = await warte(() => open === 0, ms);
    for (let i = 0; i < 3; i++) await takt(0);
    return ok;
  };
  return { w, d: w.document, aufrufe, warte, takt, ruhig, error };
}

/** Open a tab, like a click in the bar. */
async function reiter(w, name) {
  w.document.querySelector(`.ntab[data-tab="${name}"]`).click();
  await takt(50);
}

/** Open a view from the user menu (account, vouchers, …). */
async function sicht(w, name) {
  w.document.querySelector(`.umenu-item[data-arg="${name}"]`).click();
  await takt(50);
}

module.exports = { openUi, reiter, sicht, warte, takt, ANMELDUNG, SIGNED_OUT, checkResponse };
