/**
 * Smoke test for the frontend bundle.
 *
 * “every handler from the markup is registered” has run since 08.11.2026 on the
 * running bundle in actions-dispatcher-ui.test.js (counter-check:
 * `closePwModal,` deleted from registerActions() → red there).
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  bindGlobalErrorHandlers() without the 'unhandledrejection' listener → red “unhandled errors …”
 *   B  the same without the 'error' listener → red the same test (script error)
 *   C  in apiRaw `if (res.status === 401) emit('sessionEnded', path)` removed → red “a 401 leads back …”
 *   D  showLogin() called without `expired: true` on sessionEnded → red the same test (no reason)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { BUNDLE_FILE: BUNDLE, placeBundleSafe } = require('./helpers/bundle');
const { portOf } = require('./helpers/server');
placeBundleSafe();
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('the bundle is built', () => {
  assert.ok(fs.existsSync(BUNDLE), 'public/js/app.bundle.js fehlt trotz placeBundleSafe()');
});

test('index.html loads the bundle and the language file in the right order', () => {
  const iLocale = HTML.indexOf('/locales/');
  const iBundle = HTML.indexOf('app.bundle.js');
  assert.ok(iLocale > 0, 'Sprachdatei fehlt');
  assert.ok(iBundle > 0, 'Bündel fehlt');
  assert.ok(
    iLocale < iBundle,
    'Die Sprachdatei muss VOR dem Bündel stehen — i18n.js liest window.I18N_DE beim Auswerten',
  );
});

test('the bundle can be evaluated without throwing', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  // At startup the app calls network and storage — stub both, otherwise it fails
  // on missing browser capabilities instead of on a real error.
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  window.matchMedia =
    window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.I18N_DE = {};
  window.__APP_VERSION = 'test';
  window.scrollTo = () => {};

  const errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  try {
    window.eval(fs.readFileSync(BUNDLE, 'utf8'));
  } catch (e) {
    assert.fail(`Bündel wirft beim Auswerten: ${e.message}`);
  }
  assert.deepEqual(errors, [], `Fehler beim Auswerten: ${errors.join('; ')}`);

  // Close the window, otherwise the app keeps the process open: startApp() sets up
  // intervals for status queries, and jsdom timers keep running as real
  // Node timers — the test thereby ran into the timeout although it
  // had passed in substance.
  dom.window.close();
});

test('api() delivers an object on every failure instead of throwing', async () => {
  // Where this test comes from
  const http = require('node:http');
  const srv = http.createServer((q, r) => {
    const sende = (code, typ, body) => {
      r.writeHead(code, { 'content-type': typ });
      r.end(body);
    };
    if (q.url === '/api/html502') return sende(502, 'text/html', '<html>502 Bad Gateway</html>');
    if (q.url === '/api/json500')
      return sende(500, 'application/json', JSON.stringify({ success: false, error: 'kaputt' }));
    if (q.url === '/api/bare500') return sende(500, 'application/json', JSON.stringify({ message: 'oops' }));
    return sende(200, 'application/json', JSON.stringify({ success: true, wert: 42 }));
  });
  await new Promise(r => srv.listen(0, () => r(null)));
  const port = portOf(srv);

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: `http://localhost:${port}/` });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  const realFetch = globalThis.fetch; // capture BEFORE overwriting
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    MutationObserver: window.MutationObserver,
    IntersectionObserver:
      window.IntersectionObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    Node: window.Node,
    Element: window.Element,
    location: window.location,
    history: window.history,
    URLSearchParams: window.URLSearchParams,
    fetch: (u, o) => realFetch(`http://localhost:${port}${u}`, o),
  });

  try {
    const core = await import(`file://${path.join(ROOT, 'public', 'js', 'api.js')}`);

    const ok = await core.api('GET', '/ok');
    assert.equal(ok.success, true, 'Der Normalfall muss unverändert durchgehen');
    assert.equal(ok.wert, 42);

    // The case that used to throw: error status with an HTML body.
    const html = await core.api('GET', '/html502');
    assert.equal(html.success, false, 'Eine HTML-Fehlerseite muss als Fehlschlag ankommen');
    assert.equal(html.status, 502);
    assert.ok(html.error, 'Ohne Text hätte der Aufrufer nichts anzuzeigen');

    // Server error WITH its own message: it must be passed through.
    const json = await core.api('GET', '/json500');
    assert.equal(json.error, 'kaputt', 'Die Servermeldung darf nicht überschrieben werden');

    // JSON without success/error (e.g. from an intermediate layer) is completed.
    const bare = await core.api('GET', '/bare500');
    assert.equal(bare.success, false);
    assert.ok(bare.error);

    // Network error: no status, but the same shape.
    globalThis.fetch = () => Promise.reject(new Error('offline'));
    const netz = await core.api('GET', '/x');
    assert.equal(netz.success, false);
    assert.equal(netz.networkError, true, 'Offline soll unterscheidbar bleiben');
  } finally {
    srv.close();
    dom.window.close();
  }
});

test('unhandled errors do not only end up in the console', async () => {
  // In the real bundle: a rejected promise and a script error from our own code show a message.
  const { openUi, warte } = require('./helpers/ui');
  const { de } = require('./helpers/sources').loadTranslations();
  const { w, d } = await openUi();
  const toasts = () => d.getElementById('toasts')?.textContent || '';
  const ours = { stack: 'Error: kaputt\n    at http://localhost/js/app.bundle.js:1:1' };
  w.console.error = () => {};
  try {
    const rejection = new w.Event('unhandledrejection');
    Object.assign(rejection, { reason: ours });
    w.dispatchEvent(rejection);
    assert.ok(await warte(() => toasts().includes(de['api.unexpected'])), `promise: ${toasts()}`);
    for (const el of d.querySelectorAll('#toasts > *')) el.remove();
    await new Promise(r => setTimeout(r, 5100)); // one message per five seconds
    w.dispatchEvent(new w.ErrorEvent('error', { error: ours, message: 'kaputt' }));
    assert.ok(await warte(() => toasts().includes(de['api.unexpected'])), `script: ${toasts()}`);
  } finally {
    w.close();
  }
});

test('a 401 leads back to the login, not into a dead UI', async () => {
  const { openUi, reiter, warte } = require('./helpers/ui');
  const { de } = require('./helpers/sources').loadTranslations();
  const { w, d } = await openUi({
    '/v2/parts': { $status: 401, success: false, error: 'Nicht angemeldet', code: 'not_signed_in' },
  });
  try {
    assert.equal(d.getElementById('login-screen').style.display, 'none', 'Vorbedingung: angemeldet');
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.getElementById('login-screen').style.display === 'flex'), 'no login after 401');
    assert.equal(d.getElementById('app').style.display, 'none');
    assert.ok(
      await warte(() => (d.getElementById('login-hint')?.textContent || '').includes(de['auth.session_expired'])),
      `no reason given: ${d.getElementById('login-hint')?.textContent}`,
    );
  } finally {
    w.close();
  }
});
