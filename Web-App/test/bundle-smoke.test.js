/**
 * Rauchtest für das Frontend-Bündel.
 *
 * ── Warum es diesen Test braucht ────────────────────────────────────────────
 * Mit der Umstellung auf ES-Module hat sich die riskanteste Eigenschaft des
 * Frontends geändert: Vorher waren alle Handler globale Funktionen und der
 * Dispatcher fand sie über window[name]. Jetzt melden sich die Module bei einer
 * Registry an (js/00-registry.js). Vergisst ein Modul die Anmeldung — oder
 * bricht es beim Auswerten ab —, merkt man das NICHT beim Bauen und nicht beim
 * Typprüfen, sondern erst, wenn jemand auf den betroffenen Knopf klickt.
 *
 * Dieser Test wertet das gebaute Bündel in jsdom aus und prüft danach:
 *   1. Es läuft überhaupt durch (kein Fehler beim Modul-Init).
 *   2. Jeder im Markup verwendete data-click/data-change-Name ist auflösbar.
 *
 * Punkt 2 ist die eigentliche Zusicherung: Er ersetzt genau die Sicherheit,
 * die vorher darin lag, dass alles global war.
 *
 * Ausführen: npm test (setzt `npm run build:frontend` voraus)
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'public', 'js', 'app.bundle.js');
const HTML   = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/** Handler des Log-Betrachters: eigenes Popup, klassisches Skript, nicht im Bündel. */
const LOGVIEWER = new Set(['loadLogs', 'renderLogs', 'toggleAuto', 'toggleLevel']);

/** Alle im Markup und in den Vorlagen verwendeten Handlernamen. */
function handlerNames() {
  const names = new Set();
  const sources = [HTML];
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) {
    // 00-registry.js enthält Beispielnamen im Kommentar, kein Markup.
    if (/^\d\d-/.test(f) && f !== '00-registry.js') sources.push(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'));
  }
  for (const src of sources) {
    for (const m of src.matchAll(/data-(?:click|change|input|blur|keydown|mouseenter|mouseleave)="([A-Za-z_$][\w$]*)"/g)) {
      names.add(m[1]);
    }
  }
  // 'fn' stammt aus einem Kommentar-Beispiel in 01-core.js, nicht aus Markup.
  names.delete('fn');
  return [...names].filter(n => !LOGVIEWER.has(n)).sort();
}

test('das Bündel ist gebaut', () => {
  assert.ok(fs.existsSync(BUNDLE),
    'public/js/app.bundle.js fehlt — bitte `npm run build:frontend` ausführen');
});

test('jeder Handler aus dem Markup ist bei der Registry angemeldet', () => {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  // Die Registrierungen stehen als registerActions({ … }) im Bündel. Nach dem
  // Minifizieren heisst die Funktion anders, die Objektschlüssel bleiben aber
  // als Kurzschreibweise erhalten — deshalb wird gegen den Quelltext der
  // Module geprüft, nicht gegen das minifizierte Ergebnis.
  const registered = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    const s = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
    for (const m of s.matchAll(/registerActions\(\{([\s\S]*?)\}\);/g)) {
      for (const part of m[1].split(',')) {
        const key = part.trim().split(':')[0].trim();
        if (key) registered.add(key);
      }
    }
  }
  const missing = handlerNames().filter(n => !registered.has(n));
  assert.deepEqual(missing, [],
    `Nicht angemeldet — diese Knöpfe täten beim Klick nichts: ${missing.join(', ')}`);
  assert.ok(src.length > 1000, 'Bündel ist verdächtig klein');
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
//
// Die Lücke bleibt damit offen und ist hier benannt statt kaschiert: Ein
// vergessener Import in einem Funktionsrumpf fällt weiterhin erst im Browser
// auf. Wer das lösen will, braucht einen echten Parser (z. B. esbuild als
// Bibliothek mit Metafile-Analyse) statt Regex über den Quelltext.

test('api() liefert bei jedem Fehlschlag ein Objekt statt zu werfen', async () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // api() war `return (await fetch(...)).json()` — ohne Blick auf res.ok.
  // Jede nicht-JSON-Antwort (502/504 vom Reverse Proxy, 413, HTML-Fehlerseite)
  // liess .json() einen SyntaxError werfen: "Unexpected token '<'". Bei rund
  // 88 Aufrufstellen ist längst nicht jede in try/catch — für den Benutzer
  // hiess das: klicken, nichts passiert, keine Meldung. Die Fehlerbehandlung
  // war da (sie prüft d.success und zeigt d.error), sie bekam nur nie ein
  // Objekt zu sehen.
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
    const core = await import(`file://${path.join(ROOT, 'public', 'js', '01-core.js')}`);

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
  const init = fs.readFileSync(path.join(ROOT, 'public', 'js', '08-init.js'), 'utf8');
  assert.match(init, /addEventListener\('unhandledrejection'/,
    'Abgewiesene Zusagen brauchen ein Auffangnetz');
  assert.match(init, /addEventListener\('error'/, 'Skriptfehler ebenso');
  assert.match(init, /startApp\(\)\s*\{\s*\n\s*bindGlobalErrorHandlers\(\);/,
    'Die Handler müssen VOR allem anderen hängen, sonst fehlt gerade der Startfehler');
});

test('ein 401 führt zurück zur Anmeldung, nicht in eine tote Oberfläche', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Ein 401 wurde zu einem Hinweis pro Klick („Nicht angemeldet"), während
  // die Oberfläche weiter alte Daten zeigte und sich nicht mehr bedienen
  // liess. Die Android-App macht es längst richtig: Interceptor meldet den
  // 401, die App zeigt „Sitzung abgelaufen" und führt zur Anmeldung.
  //
  // Wahrscheinlicher geworden ist der Fall durch die Sitzungs-Bereinigung
  // beim Passwortwechsel — seitdem verwerfen alle drei Passwort-Wege
  // sämtliche Sitzungen des Kontos, offene Tabs landen also genau hier.
  //
  // Verhalten gegen einen echten kleinen Server nachgestellt:
  //   abgemeldet + 401 → nichts        (sonst Schleife auf der Anmeldemaske)
  //   angemeldet + 401 → login-screen: flex, app: none
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /if \(res\.status === 401\) meldeSitzungBeendet\(path\);/,
    'Der 401 muss zentral behandelt werden, nicht an 88 Aufrufstellen');
  assert.match(core, /function meldeSitzungBeendet/);

  const fn = core.slice(core.indexOf('function meldeSitzungBeendet'),
                        core.indexOf('export function fmtN'));
  assert.match(fn, /if \(!ME\) return;/,
    'Ohne angemeldeten Zustand gibt es keine Sitzung zu beenden');
  assert.match(fn, /\/auth\/me/, '/auth/me beantwortet mit 401 nur „nicht angemeldet"');
  assert.match(fn, /\/auth\/login/, 'Ein falsches Passwort ist kein Sitzungsende');
  assert.match(fn, /showLogin\(\)/, 'Die Anmeldemaske muss zurückkommen');
  assert.match(fn, /auth\.session_expired/, 'Ohne Meldung wüsste niemand, warum');

  // Der Text muss in beiden Sprachen existieren — sonst steht der Schlüssel da.
  for (const lang of ['de', 'en']) {
    const dict = fs.readFileSync(path.join(ROOT, 'public', 'locales', `${lang}.js`), 'utf8');
    assert.ok(dict.includes("'auth.session_expired'"), `${lang}.js: Text fehlt`);
  }
});
