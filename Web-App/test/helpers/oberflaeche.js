/**
 * Die ganze Weboberfläche in jsdom: echtes index.html, echtes Bündel, und ein
 * fetch, der je Pfad eine vorgegebene Antwort liefert. So prüft ein Test, was
 * die Oberfläche aus einer Serverantwort macht, ohne Server und ohne Browser.
 *
 * Antworten: { '/v1/parts/manual': {...}, ... } je Pfad ohne Abfrage (?…).
 * Was fehlt, bekommt { success: true }. Jeder Aufruf landet in `aufrufe`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const BUNDLE = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.bundle.js'), 'utf8');

const ANMELDUNG = {
  '/v1/startup-status': { ready: true },
  '/v1/auth/me': { loggedIn: true, user: { id: 1, username: 'anna', is_admin: true } },
  '/v1/sets/household-members': { success: true, members: [{ id: 1, username: 'anna', is_self: true, tiefe: 0 }] },
  '/v1/stats': { success: true, stats: { total_sets: 0, total_parts: 0, total_minifigs: 0, total_instructions: 0 } },
  '/v1/sets': { success: true, sets: [], total: 0, themes: [] },
  '/v1/parts': { success: true, parts: [], total: 0 },
  '/v1/parts/stats': { success: true, stats: {} },
  '/v1/parts/colors': { success: true, colors: [] },
  '/v1/parts/categories': { success: true, categories: [] },
  '/v1/parts/manual': { success: true, parts: [] },
  '/v1/parts/brick-colors': { success: true, colors: [] },
  '/v1/minifigs': { success: true, figs: [], total: 0 },
  '/v1/minifigs/stats': { success: true, stats: { types: 0, total_quantity: 0 } },
  '/v1/minifigs/manual': { success: true, figs: [] },
  '/v1/finance/valuation': { success: true, currency: 'EUR', sets: [], totals: { min: '0', avg: '0', max: '0', qty_avg: '0' } },
  '/v1/finance/parts-valuation': { success: true, currency: 'EUR', parts: [], total_value: '0' },
  '/v1/finance/minifigs-valuation': { success: true, currency: 'EUR', figs: [], total_value: '0' },
  '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: {} },
  '/v1/finance/portfolio-history': { success: true, points: [] },
  '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: 'probe' } },
  '/v1/auth/users': { success: true, users: [{ id: 1, username: 'anna', is_admin: true, created_at: '2026-10-01T00:00:00Z' }] },
  '/v1/admin/api-limits': { success: true, limits: { rebrickable: 25000, bricklink: 4000, brickset: 100 } },
};

// Ein Fehler in einem Lader, den die Oberfläche selbst nicht abfängt, soll
// den Testlauf nicht beenden; er landet in `fehler` und der Test kann ihn sehen.
const fehler = [];
process.on('unhandledRejection', e => { fehler.push(e); });

function antwortFuer(antworten, url) {
  const pfad = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '').split('?')[0];
  const a = Object.prototype.hasOwnProperty.call(antworten, pfad) ? antworten[pfad] : { success: true };
  return typeof a === 'function' ? a(url) : a;
}

const takt = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Wartet, bis `bedingung()` wahr ist (höchstens `ms`). */
async function warte(bedingung, ms = 3000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await takt(10);
  }
  return bedingung();
}

/**
 * @param {object} [antworten]  Pfad → Antwort (Objekt oder Funktion(url))
 * @param {object} [opt]        { angemeldet = true, sprache = 'de' }
 */
async function oeffneOberflaeche(antworten = {}, opt = {}) {
  const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const alle = { ...(opt.angemeldet === false ? { '/v1/startup-status': { ready: true }, '/v1/auth/me': { loggedIn: false } } : ANMELDUNG), ...antworten };
  // Die Sprache des Kontos gewinnt beim Laden über die gespeicherte — also beide setzen.
  if (opt.sprache && !antworten['/v1/settings/raw'])
    alle['/v1/settings/raw'] = { success: true, settings: { ...ANMELDUNG['/v1/settings/raw'].settings, language: opt.sprache } };
  const dom = new jsdom.JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const aufrufe = [];
  try { w.localStorage.setItem('bim_lang', opt.sprache || 'de'); } catch (_) { /* jsdom ohne Speicher */ }
  w.fetch = async (url, o = {}) => {
    aufrufe.push({ url: String(url), method: o.method || 'GET', body: o.body });
    const daten = antwortFuer(alle, url);
    return { ok: true, status: 200, headers: { get: () => 'application/json' },
             json: async () => JSON.parse(JSON.stringify(daten)) };
  };
  w.console.warn = () => {};
  // jsdom kennt keinen IntersectionObserver; nachgeladen wird hier nichts.
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  // Die Wörterbücher lädt index.html als eigene <script>-Tags.
  for (const l of ['de', 'en']) w.eval(fs.readFileSync(path.join(ROOT, 'public', 'locales', l + '.js'), 'utf8'));
  w.eval(BUNDLE);
  if (w.document.readyState === 'loading')
    await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  if (opt.angemeldet !== false)
    await warte(() => w.document.getElementById('app')?.style.display !== 'none' && w.document.getElementById('app')?.style.display !== '');
  await takt(20);
  return { w, d: w.document, aufrufe, warte, takt, fehler };
}

/** Einen Reiter öffnen, wie ein Klick in der Leiste. */
async function reiter(w, name) {
  w.document.querySelector(`.ntab[data-tab="${name}"]`).click();
  await takt(50);
}

module.exports = { oeffneOberflaeche, reiter, warte, takt };
