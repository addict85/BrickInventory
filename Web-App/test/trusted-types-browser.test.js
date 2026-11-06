/**
 * Trusted Types in der echten App (Chrome): Die CSP verlangt sie, Markup
 * kommt nur über setzeHtml()/fuegeHtmlEin() in die Seite, jede andere
 * Zuweisung an innerHTML scheitert mit TypeError, fremde Skript-Adressen
 * ebenso. Die Sammlung baut sich trotzdem auf, und das Protokollfenster
 * (eigenes Dokument, erbt die CSP) zeigt seine Einträge.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  die beiden Trusted-Types-Zeilen aus der CSP (server.ts) entfernt → rot:
 *      „die CSP verlangt Trusted Types“ und „innerHTML ausserhalb …“ (kein Fehler)
 *   B  in setzeHtml() wieder `el.innerHTML = einsetzen(inhalt)` (Bündel neu
 *      gebaut) → rot schon beim Start: Die Anmeldemaske erscheint nicht
 *   C  in logviewer.js die Richtlinie weggelassen (Zeichenkette an innerHTML)
 *      → rot: „das Protokollfenster …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

test('Trusted Types', { timeout: 180_000 }, async t => {
  const app = await starteApp(t, { name: `tt_${process.pid}`, bestand: musterSammlung });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }

  await t.test('die CSP verlangt Trusted Types', async () => {
    const csp = (await fetch(`http://127.0.0.1:${app.port}/`)).headers.get('content-security-policy') ?? '';
    assert.match(csp, /(^|; )require-trusted-types-for 'script'(;|$)/, csp);
    assert.match(csp, /(^|; )trusted-types app default(;|$)/, csp);
  });

  await t.test('setzeHtml() baut die Sammlung, innerHTML ausserhalb wirft TypeError', async () => {
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
        skript: versuch(() => { document.createElement('script').src = 'https://fremd.example/x.js'; }),
        eigenesSkript: versuch(() => { document.createElement('script').src = '/locales/en.js'; }),
      };
    })()`);
    assert.deepEqual(fehler, {
      innerHTML: 'TypeError',
      insertAdjacentHTML: 'TypeError',
      leer: 'kein Fehler',
      skript: 'TypeError',
      eigenesSkript: 'kein Fehler',
    });
  });

  await t.test('das Protokollfenster zeigt seine Einträge', async () => {
    // Mit Nutzergeste, sonst blockiert Chrome das Fenster und die App meldet es per alert().
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
