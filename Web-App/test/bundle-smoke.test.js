/**
 * Rauchtest für das Frontend-Bündel.
 *
 * „jeder Handler aus dem Markup ist angemeldet“ läuft seit dem 08.11.2026 am
 * laufenden Bündel in aktionen-dispatcher-oberflaeche.test.js (Gegenprobe:
 * `closePwModal,` aus registerActions() gestrichen → dort rot).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.join(__dirname, '..');
const { BUENDEL: BUNDLE, stelleBuendelSicher } = require('./helpers/buendel');
stelleBuendelSicher();
const HTML   = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('das Bündel ist gebaut', () => {
  assert.ok(fs.existsSync(BUNDLE), 'public/js/app.bundle.js fehlt trotz stelleBuendelSicher()');
});

test('index.html lädt das Bündel und die Sprachdatei in der richtigen Reihenfolge', () => {
  const iLocale = HTML.indexOf('/locales/');
  const iBundle = HTML.indexOf('app.bundle.js');
  assert.ok(iLocale > 0, 'Sprachdatei fehlt');
  assert.ok(iBundle > 0, 'Bündel fehlt');
  assert.ok(iLocale < iBundle,
    'Die Sprachdatei muss VOR dem Bündel stehen — i18n.js liest window.I18N_DE beim Auswerten');
});

test('das Bündel lässt sich auswerten, ohne zu werfen', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  // Die App ruft beim Start Netz und Speicher — beides stubben, sonst scheitert
  // sie an fehlenden Browser-Fähigkeiten statt an einem echten Fehler.
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener(){}, removeEventListener(){} }));
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

  // Fenster schliessen, sonst hält die App den Prozess offen: startApp() legt
  // Intervalle für Statusabfragen an, und jsdom-Timer laufen als echte
  // Node-Timer weiter — der Test lief dadurch in den Timeout, obwohl er
  // inhaltlich bestanden hatte.
  dom.window.close();
});

// HINWEIS: Hier stand der Versuch eines Wächters gegen vergessene Importe —
// erst als Klick-Test durch alle Reiter, dann als statische Prüfung "jeder
// modulfremde Aufruf muss importiert sein".
//
// Beide sind wieder entfernt, weil sie nicht funktionierten:
//   • Der Klick-Test scheiterte an abgewiesenen Zusagen aus den Datenabrufen.
//     Der Node-Test-Runner rechnet die dem Test an, unabhängig von einem
//     eigenen unhandledRejection-Abfang.
//   • Die statische Prüfung meldete NICHTS, als der fehlende Import von
//     initCatalog zur Gegenprobe wieder entfernt wurde. Ein Test, der grün
//     bleibt, während der Fehler vorhanden ist, ist schlechter als kein Test:
//     Er erzeugt Sicherheit, die es nicht gibt.

test('api() liefert bei jedem Fehlschlag ein Objekt statt zu werfen', async () => {
  // Woher dieser Test kommt
  const http = require('node:http');
  const srv = http.createServer((q, r) => {
    const sende = (code, typ, körper) => { r.writeHead(code, { 'content-type': typ }); r.end(körper); };
    if (q.url === '/api/html502') return sende(502, 'text/html', '<html>502 Bad Gateway</html>');
    if (q.url === '/api/json500') return sende(500, 'application/json', JSON.stringify({ success:false, error:'kaputt' }));
    if (q.url === '/api/bare500') return sende(500, 'application/json', JSON.stringify({ message:'oops' }));
    return sende(200, 'application/json', JSON.stringify({ success:true, wert:42 }));
  });
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: `http://localhost:${port}/` });
  const { window } = dom;
  window.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
  window.scrollTo = () => {};
  const echterFetch = globalThis.fetch;   // VOR dem Überschreiben festhalten
  Object.assign(globalThis, {
    window, document: window.document,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    MutationObserver: window.MutationObserver,
    IntersectionObserver: window.IntersectionObserver || class { observe(){} unobserve(){} disconnect(){} },
    Node: window.Node, Element: window.Element,
    location: window.location, history: window.history,
    URLSearchParams: window.URLSearchParams,
    fetch: (u, o) => echterFetch(`http://localhost:${port}${u}`, o),
  });

  try {
    const core = await import(`file://${path.join(ROOT, 'public', 'js', 'api.js')}`);

    const ok = await core.api('GET', '/ok');
    assert.equal(ok.success, true, 'Der Normalfall muss unverändert durchgehen');
    assert.equal(ok.wert, 42);

    // Der Fall, der vorher warf: Fehlerstatus mit HTML-Körper.
    const html = await core.api('GET', '/html502');
    assert.equal(html.success, false, 'Eine HTML-Fehlerseite muss als Fehlschlag ankommen');
    assert.equal(html.status, 502);
    assert.ok(html.error, 'Ohne Text hätte der Aufrufer nichts anzuzeigen');

    // Server-Fehler MIT eigener Meldung: die muss durchgereicht werden.
    const json = await core.api('GET', '/json500');
    assert.equal(json.error, 'kaputt', 'Die Servermeldung darf nicht überschrieben werden');

    // JSON ohne success/error (z. B. aus einer Zwischenschicht) wird ergänzt.
    const bare = await core.api('GET', '/bare500');
    assert.equal(bare.success, false);
    assert.ok(bare.error);

    // Netzfehler: kein Status, aber dieselbe Form.
    globalThis.fetch = () => Promise.reject(new Error('offline'));
    const netz = await core.api('GET', '/x');
    assert.equal(netz.success, false);
    assert.equal(netz.networkError, true, 'Offline soll unterscheidbar bleiben');
  } finally {
    srv.close();
    dom.window.close();
  }
});

test('unbehandelte Fehler landen nicht nur in der Konsole', () => {
  // Ergänzung zum Test darüber: api() deckt den Regelfall ab, aber nicht einen
  // Fehler in einem Rückruf oder eine Zusage, die niemand einsammelt. Ohne
  // Auffangnetz sieht der Benutzer davon nichts — er klickt, und es passiert
  // einfach nichts.
  const init = fs.readFileSync(path.join(ROOT, 'public', 'js', 'fehlerfang.js'), 'utf8');
  assert.match(init, /addEventListener\('unhandledrejection'/,
    'Abgewiesene Zusagen brauchen ein Auffangnetz');
  assert.match(init, /addEventListener\('error'/, 'Skriptfehler ebenso');
  const sitzung = fs.readFileSync(path.join(ROOT, 'public', 'js', 'sitzung.js'), 'utf8');
  assert.match(sitzung, /startApp\(\)\s*\{\s*\n\s*bindGlobalErrorHandlers\(\);/,
    'Die Handler müssen VOR allem anderen hängen, sonst fehlt gerade der Startfehler');
});

test('ein 401 führt zurück zur Anmeldung, nicht in eine tote Oberfläche', () => {
  // Woher dieser Test kommt
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /if \(res\.status === 401\) melde\('sitzungBeendet', path\);/,
    'Der 401 muss zentral behandelt werden, nicht an 88 Aufrufstellen');
  const sitzung = fs.readFileSync(path.join(ROOT, 'public', 'js', 'sitzung.js'), 'utf8');
  const von = sitzung.indexOf("abonniere('sitzungBeendet'");
  assert.ok(von > 0, 'Niemand reagiert auf das Sitzungsende');
  const fn = sitzung.slice(von, sitzung.indexOf('\n});\n', von));
  assert.match(fn, /if \(!ME\) return;/,
    'Ohne angemeldeten Zustand gibt es keine Sitzung zu beenden');
  assert.match(fn, /\/auth\/me/, '/auth/me beantwortet mit 401 nur „nicht angemeldet"');
  assert.match(fn, /\/auth\/login/, 'Ein falsches Passwort ist kein Sitzungsende');
  assert.match(fn, /showLogin\(\{ abgelaufen: true \}\)/, 'Die Anmeldemaske muss zurückkommen');
  // Die Meldung steht einmal in der Anmeldekarte (showLogin), nicht als Toast.
  assert.match(core, /o\.abgelaufen \? tRaw\('auth\.session_expired'\)/, 'Ohne Meldung wüsste niemand, warum');

  // Der Text muss in beiden Sprachen existieren — sonst steht der Schlüssel da.
  for (const lang of ['de', 'en']) {
    const dict = fs.readFileSync(path.join(ROOT, 'public', 'locales', `${lang}.js`), 'utf8');
    assert.ok(dict.includes("'auth.session_expired'"), `${lang}.js: Text fehlt`);
  }
});
