/**
 * Die ganze Weboberfläche in jsdom: echtes index.html, echtes Bündel, und ein
 * fetch, der je Pfad eine vorgegebene Antwort liefert. So prüft ein Test, was
 * die Oberfläche aus einer Serverantwort macht, ohne Server und ohne Browser.
 * Ausführlich: docs/begruendungen/test/helpers/oberflaeche.js.md#kopf
 */
const fs = require('node:fs');
const path = require('node:path');
const { vervollstaendige } = require('./vertrag-fuellen');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
// TEST_BUENDEL: das Bündel mit Sourcemap aus test-lauf.js --abdeckung.
const BUNDLE_PFAD = process.env.TEST_BUENDEL || path.join(ROOT, 'public', 'js', 'app.bundle.js');
const BUNDLE = fs.readFileSync(BUNDLE_PFAD, 'utf8');

const ANMELDUNG = {
  '/v1/startup-status': { ready: true, progress: 0, total: 0 },
  '/v1/auth/me': { success: true, loggedIn: true, user: { id: 1, username: 'anna', is_admin: true, zweiterFaktorPflicht: false } },
  '/v1/sets/household-members': { success: true, members: [{ id: 1, username: 'anna', is_self: true, tiefe: 0 }] },
  '/v1/stats': { success: true, stats: { total_sets: 0, total_quantity: 0, total_pieces: 0, total_parts: 0, total_minifigs: 0, total_instructions: 0 } },
  '/v1/sets': { success: true, sets: [], count: 0, total: 0, themes: [] },
  '/v1/parts': { success: true, parts: [], total: 0, page: 1, page_size: 50 },
  '/v1/parts/stats': { success: true, stats: { unique_parts: 0, unique_colors: 0, total_parts: 0 } },
  '/v1/parts/colors': { success: true, colors: [] },
  '/v1/parts/categories': { success: true, categories: [] },
  '/v1/parts/manual': { success: true, parts: [], total: 0, page: 1, page_size: 0 },
  '/v1/parts/brick-colors': { success: true, colors: [] },
  '/v1/minifigs': { success: true, figs: [], total: 0 },
  '/v1/minifigs/stats': { success: true, stats: { types: 0, total_quantity: 0, manual: 0 } },
  '/v1/minifigs/manual': { success: true, figs: [], total: 0, page: 1, page_size: 0 },
  '/v1/finance/valuation': { success: true, currency: 'EUR', total_value: '0', condition: 'N', kaufpreise_fremde_waehrung: 0, sets: [], totals: { min: '0', avg: '0', max: '0', qty_avg: '0' }, wert_gesamt: 0, total: 0, page: 1, page_size: 0 },
  '/v1/finance/parts-valuation': { success: true, currency: 'EUR', parts: [], total_value: '0', kaufpreise_fremde_waehrung: 0, wert_gesamt: 0, total: 0, page: 1, page_size: 0 },
  '/v1/finance/minifigs-valuation': { success: true, currency: 'EUR', figs: [], total_value: '0', kaufpreise_fremde_waehrung: 0, wert_gesamt: 0, total: 0, page: 1, page_size: 0 },
  '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { purchase: '0', current: '0', kaufpreise_fremde_waehrung: 0 }, total: 0, page: 1, page_size: 0 },
  '/v1/finance/portfolio-history': { success: true, currency: 'EUR', period: '1y', points: [], y_axis: [] },
  '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: 'probe' } },
  '/v1/auth/users': { success: true, users: [{ id: 1, username: 'anna', is_admin: true, is_active: true, zweiter_faktor: false, created_at: '2026-10-01T00:00:00Z' }] },
  '/v1/admin/api-limits': { success: true, limits: { rebrickable: 25000, bricklink: 4000, brickset: 100 } },
};

const ABGEMELDET = {
  '/v1/startup-status': ANMELDUNG['/v1/startup-status'],
  '/v1/auth/me': { success: true, loggedIn: false },
};

// Ein Fehler in einem Lader, den die Oberfläche selbst nicht abfängt, soll
// den Testlauf nicht beenden; er landet in `fehler` und der Test kann ihn sehen.
const fehler = [];
process.on('unhandledRejection', e => { fehler.push(e); });

let _vertrag;
const vertrag = () => {
  if (!_vertrag) {
    require('./sources').baueDist();
    _vertrag = { ...require(path.join(ROOT, 'dist', 'src', 'vertrag', 'index.js')),
                 Fehler: require(path.join(ROOT, 'dist', 'src', 'vertrag', 'grund.js')).Fehler };
  }
  return _vertrag;
};

/**
 * Die Antwort, wie der Server sie senden dürfte: Fehlende Pflichtfelder
 * ergänzt das Schema der Route (vertrag-fuellen.js); ein falscher Typ wirft. Eine absichtlich kaputte Antwort trägt
 * `$vertragswidrig: '<Grund>'` und geht unverändert hinaus.
 */
function pruefeAntwort(methode, url, daten) {
  if (!daten || typeof daten !== 'object' || daten === UNBELEGT || daten.$vertragswidrig) return daten;
  const pfad = '/api' + String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '').split('?')[0];
  const { routeFuerAnfrage, Fehler } = vertrag();
  const status = daten.$status ?? 200;
  const schema = status >= 400 ? Fehler : routeFuerAnfrage(methode.toUpperCase(), pfad)?.antwort;
  if (!schema) return daten;
  const rumpf = Array.isArray(daten) ? daten
    : Object.fromEntries(Object.entries(daten).filter(([k]) => !k.startsWith('$')));
  // Fehlerantworten werden nicht ergänzt: error und code sagt der Test selbst.
  const wert = status >= 400 ? rumpf : vervollstaendige(schema, JSON.parse(JSON.stringify(rumpf)));
  const r = schema.safeParse(wert);
  if (!r.success) {
    throw new Error(`Testantwort verletzt den Vertrag: ${methode} ${pfad} (${status}): `
      + r.error.issues.slice(0, 6).map(i => `${i.path.join('.') || '$'}: ${i.message}`).join(' | '));
  }
  return Array.isArray(daten) ? wert : { ...wert, $status: daten.$status };
}

// Nicht vorgegebene Pfade: Der Test stützt sich nicht auf sie, also keine Vertragsprüfung.
const UNBELEGT = Object.freeze({ success: true });

function antwortFuer(antworten, url, o = {}) {
  const pfad = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '').split('?')[0];
  const a = Object.prototype.hasOwnProperty.call(antworten, pfad) ? antworten[pfad] : UNBELEGT;
  return typeof a === 'function' ? a(url, o) : a;
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
 * @param {object} [opt]        { angemeldet = true, sprache = 'de', browserSprache, vorher(w) }
 */
async function oeffneOberflaeche(antworten = {}, opt = {}) {
  const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const alle = { ...(opt.angemeldet === false ? ABGEMELDET : ANMELDUNG), ...antworten };
  // Die Sprache des Kontos gewinnt beim Laden über die gespeicherte — also beide setzen.
  if (opt.sprache && !antworten['/v1/settings/raw'])
    alle['/v1/settings/raw'] = { success: true, settings: { ...ANMELDUNG['/v1/settings/raw'].settings, language: opt.sprache } };
  const dom = new jsdom.JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const aufrufe = [];
  try { w.localStorage.setItem('bim_lang', opt.sprache || 'de'); } catch (_) { /* jsdom ohne Speicher */ }
  // Eine Antwort darf ein Promise sein (verzögert) oder werfen (Netzfehler);
  // `$status` setzt den HTTP-Status, z. B. { $status: 500, success: false }.
  let offen = 0;
  w.fetch = async (url, o = {}) => {
    aufrufe.push({ url: String(url), method: o.method || 'GET', body: o.body, headers: o.headers || {} });
    offen++;
    let daten;
    try { daten = await antwortFuer(alle, url, o); } finally { setTimeout(() => offen--, 0); }
    // Ausserhalb des Fensters geworfen: Die Oberfläche finge den Fehler sonst als Netzfehler ab.
    try { daten = pruefeAntwort(o.method || 'GET', url, daten); } catch (e) { setImmediate(() => { throw e; }); }
    const status = daten?.$status ?? 200;
    return { ok: status < 400, status, headers: { get: () => 'application/json' },
             json: async () => JSON.parse(JSON.stringify(daten)) };
  };
  w.console.warn = () => {};
  if (opt.browserSprache) Object.defineProperty(w.navigator, 'language', { value: opt.browserSprache });
  // jsdom kennt keinen IntersectionObserver; nachgeladen wird hier nichts.
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  // Die Wörterbücher lädt index.html als eigene <script>-Tags.
  for (const l of ['de', 'en']) w.eval(fs.readFileSync(path.join(ROOT, 'public', 'locales', l + '.js'), 'utf8'));
  if (opt.vorher) opt.vorher(w);
  // Mit Dateinamen statt w.eval(): So ordnet V8 die Abdeckung dem Bündel zu.
  new (require('node:vm').Script)(BUNDLE, { filename: BUNDLE_PFAD }).runInContext(dom.getInternalVMContext());
  if (w.document.readyState === 'loading')
    await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  if (opt.angemeldet !== false)
    await warte(() => w.document.getElementById('app')?.style.display !== 'none' && w.document.getElementById('app')?.style.display !== '');
  await takt(20);
  /** Bis keine Antwort mehr aussteht und die Oberfläche die letzte verarbeitet hat. */
  const ruhig = async (ms = 3000) => {
    const ok = await warte(() => offen === 0, ms);
    for (let i = 0; i < 3; i++) await takt(0);
    return ok;
  };
  return { w, d: w.document, aufrufe, warte, takt, ruhig, fehler };
}

/** Einen Reiter öffnen, wie ein Klick in der Leiste. */
async function reiter(w, name) {
  w.document.querySelector(`.ntab[data-tab="${name}"]`).click();
  await takt(50);
}

/** Eine Sicht aus dem Benutzermenü öffnen (Konto, Gutscheine, …). */
async function sicht(w, name) {
  w.document.querySelector(`.umenu-item[data-arg="${name}"]`).click();
  await takt(50);
}

module.exports = { oeffneOberflaeche, reiter, sicht, warte, takt, ANMELDUNG, ABGEMELDET, pruefeAntwort };
