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
  assert.ok(fs.existsSync(BUNDLE), 'public/js/app.bundle.js is missing despite placeBundleSafe()');
});

test('index.html loads the bundle and the language file in the right order', () => {
  const iLocale = HTML.indexOf('/locales/');
  const iBundle = HTML.indexOf('app.bundle.js');
  assert.ok(iLocale > 0, 'Language file is missing');
  assert.ok(iBundle > 0, 'Bundle is missing');
  assert.ok(
    iLocale < iBundle,
    'The language file must come BEFORE the bundle — i18n.js reads window.I18N_DE on evaluation',
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
    assert.fail(`Bundle throws on evaluation: ${e.message}`);
  }
  assert.deepEqual(errors, [], `Errors on evaluation: ${errors.join('; ')}`);

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
    assert.equal(ok.success, true, 'The normal case must pass through unchanged');
    assert.equal(ok.wert, 42);

    // The case that used to throw: error status with an HTML body.
    const html = await core.api('GET', '/html502');
    assert.equal(html.success, false, 'An HTML error page must arrive as a failure');
    assert.equal(html.status, 502);
    assert.ok(html.error, 'Without a text the caller would have nothing to show');

    // Server error WITH its own message: it must be passed through.
    const json = await core.api('GET', '/json500');
    assert.equal(json.error, 'kaputt', 'The server message must not be overwritten');

    // JSON without success/error (e.g. from an intermediate layer) is completed.
    const bare = await core.api('GET', '/bare500');
    assert.equal(bare.success, false);
    assert.ok(bare.error);

    // Network error: no status, but the same shape.
    globalThis.fetch = () => Promise.reject(new Error('offline'));
    const netz = await core.api('GET', '/x');
    assert.equal(netz.success, false);
    assert.equal(netz.networkError, true, 'Offline should remain distinguishable');
  } finally {
    srv.close();
    dom.window.close();
  }
});

test('unhandled errors do not only end up in the console', async () => {
  // In the real bundle: a rejected promise and a script error from our own code show a message.
  const { openUi, warte } = require('./helpers/ui');
  const { de } = require('./helpers/sources').loadTranslations();
  const ours = { stack: 'Error: kaputt\n    at http://localhost/js/app.bundle.js:1:1' };
  // One window per kind: the net reports at most one message per five seconds.
  /** @type {[string, (w: any) => void][]} */
  const kinds = [
    [
      'promise',
      w => {
        const rejection = new w.Event('unhandledrejection');
        Object.assign(rejection, { reason: ours });
        w.dispatchEvent(rejection);
      },
    ],
    ['script', w => w.dispatchEvent(new w.ErrorEvent('error', { error: ours, message: 'kaputt' }))],
  ];
  for (const [kind, raise] of kinds) {
    const { w, d } = await openUi();
    w.console.error = () => {};
    try {
      raise(w);
      const toasts = () => d.getElementById('toasts')?.textContent || '';
      assert.ok(await warte(() => toasts().includes(de['api.unexpected'])), `${kind}: ${toasts()}`);
    } finally {
      w.close();
    }
  }
});

test('a 401 leads back to the login, not into a dead UI', async () => {
  const { openUi, reiter, warte } = require('./helpers/ui');
  const { de } = require('./helpers/sources').loadTranslations();
  const { w, d } = await openUi({
    '/v2/parts': { $status: 401, success: false, error: 'Nicht angemeldet', code: 'not_signed_in' },
  });
  try {
    assert.equal(d.getElementById('login-screen').style.display, 'none', 'precondition: signed in');
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
