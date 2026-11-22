/**
 * Trusted Types in the real app (Chrome): the CSP requires them, markup
 * only enters the page via setHtml()/fuegeHtmlEin(), every other
 * assignment to innerHTML fails with TypeError, foreign script addresses
 * likewise. The collection still builds up, and the log window
 * (own document, inherits the CSP) shows its entries.
 *
 * Counter-checks (measured 05.11.2026, each on its own; D on 09.11.2026):
 *   A  the two Trusted Types lines removed from the CSP (server.ts) → red:
 *      “the CSP requires Trusted Types” and “innerHTML outside …” (no error)
 *   B  in setHtml() again `el.innerHTML = einsetzen(content)` (bundle
 *      rebuilt) → red already at the start: the login form does not appear
 *   C  the policy left out in logviewer.js (string to innerHTML)
 *      → red: “the log window …”
 *   D  report-uri/report-to removed from the CSP (server.ts) → red: “the CSP
 *      requires Trusted Types and reports violations …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

test('Trusted Types', { timeout: 180_000 }, async t => {
  const app = await startApp(t, { name: `tt_${process.pid}`, bestand: patternCollection });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }

  await t.test('the CSP requires Trusted Types and reports violations to the server', async () => {
    const r = await fetch(`http://127.0.0.1:${app.port}/`);
    const csp = r.headers.get('content-security-policy') ?? '';
    assert.match(csp, /(^|; )require-trusted-types-for 'script'(;|$)/, csp);
    assert.match(csp, /(^|; )trusted-types app default(;|$)/, csp);
    assert.match(csp, /(^|; )report-uri \/csp-bericht; report-to csp(;|$)/, csp);
    assert.equal(r.headers.get('reporting-endpoints'), 'csp="/csp-bericht"');
    // Also without an origin, as the browser sends a report: accepted, without content.
    const bericht = await fetch(`http://127.0.0.1:${app.port}/csp-bericht`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', 'sec-fetch-site': 'same-origin' },
      body: '{}',
    });
    assert.equal(bericht.status, 204);
  });

  await t.test('setHtml() builds the collection, innerHTML outside throws TypeError', async () => {
    assert.ok(
      (await app.b.auswerten(`document.querySelectorAll('#gallery .sc').length`)) > 0,
      'keine Kachel in der Sammlung',
    );
    const fehler = await app.b.auswerten(`(() => {
      const versuch = (f) => { try { f(); return 'kein Fehler'; } catch (e) { return e.name; } };
      const div = document.createElement('div');
      return {
        innerHTML: versuch(() => { div.innerHTML = '<b>x</b>'; }),
        insertAdjacentHTML: versuch(() => div.insertAdjacentHTML('beforeend', '<img src=x>')),
        leer: versuch(() => { div.innerHTML = ''; }),
        script: versuch(() => { document.createElement('script').src = 'https://fremd.example/x.js'; }),
        ownScript: versuch(() => { document.createElement('script').src = '/locales/en.js'; }),
      };
    })()`);
    assert.deepEqual(fehler, {
      innerHTML: 'TypeError',
      insertAdjacentHTML: 'TypeError',
      leer: 'kein Fehler',
      script: 'TypeError',
      ownScript: 'kein Fehler',
    });
  });

  await t.test('the log window shows its entries', async () => {
    // With a user gesture, otherwise Chrome blocks the window and the app reports it via alert().
    await app.b.tab('Runtime.evaluate', {
      userGesture: true,
      returnByValue: true,
      expression: `(() => {
      window.alert = () => {}; const o = window.open; window.__fenster = null;
      window.open = (...a) => (window.__fenster = o.apply(window, a));
      document.querySelector('[data-click="openLogViewer"]').click(); return true; })()`,
    });
    await app.bis(
      `!!window.__fenster?.document.getElementById('log-wrap')?.firstElementChild`,
      'Protokollfenster mit Inhalt',
      200,
    );
    const f =
      await app.b.auswerten(`({ klasse: window.__fenster.document.getElementById('log-wrap').firstElementChild.className,
      stand: window.__fenster.document.getElementById('status').textContent })`);
    assert.match(f.klasse, /^(ll|leer)\b/);
    assert.doesNotMatch(f.stand, /Fehler/, f.stand);
    await app.b.auswerten(`window.__fenster.close(); true`);
  });
});
