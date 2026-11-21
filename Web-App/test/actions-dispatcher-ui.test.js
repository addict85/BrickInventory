/**
 * The dispatcher (js/actions.js) and image errors in jsdom on the bundle from
 * main.js, which additionally puts the registry on window: every handler name from
 * markup and templates is registered at runtime, a click passes arguments,
 * field value and `this` through, an image error is retried once before the
 * fallback applies, and the log window loads its script as a file.
 *
 * Counter-checks (measured 08.11.2026, each alone, reset afterwards):
 *   A  `closePwModal,` deleted from registerActions() in aktionen.js → red:
 *      “every handler from markup and templates is registered”
 *   B  in handle() the loop over data-arg… stopped after data-arg2
 *      (list without data-arg3) → red: “a click passes arguments …”
 *   C  `fn.apply(el, args)` → `fn(...args)` → red: “a click passes … this”
 *   D  the `true` (capture) removed from the error listener → red: “an image error
 *      is retried once …” and “the zoom keeps …” (error does not bubble)
 *   E  the branch `if (!el.dataset.retried && el.src)` removed → red: “an
 *      image error is retried once …”
 *   F  the branch for data-onerror="keep" removed → red: “the zoom keeps …”
 *   G  in openLogViewer back to `'<script>' + …` instead of logviewer.js → red:
 *      “the log window loads its script as a file”
 *   H  `import './actions.js';` deleted from main.js → red: all cases here
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTestbuendel } = require('./helpers/bundle');

process.env.TEST_BUENDEL = buildTestbuendel(
  'aktionen-dispatcher',
  "import { actionNames, registerActions } from './registry.js';\n" +
    'window.__registry = { actionNames, registerActions };\n',
);
const { openUi, warte, takt } = require('./helpers/ui');

const PUB = path.join(__dirname, '..', 'public');

/** Handler names in the markup and in the templates (structure); whether they are registered is told by the runtime. */
function namesInMarkup() {
  const quellen = [
    fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'),
    ...fs
      .readdirSync(path.join(PUB, 'js'))
      .filter(f => isAppModule(f) && f !== 'registry.js')
      .map(f =>
        fs
          .readFileSync(path.join(PUB, 'js', f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1'),
      ),
  ];
  const namen = new Set();
  for (const s of quellen)
    for (const m of s.matchAll(/data-(?:click|change|input|blur|keydown)="([A-Za-z_$][\w$]*)"/g)) namen.add(m[1]);
  // The log viewer runs in its own window with its own table (logviewer-ui.test.js).
  for (const n of ['loadLogs', 'renderLogs', 'toggleAuto', 'toggleLevel']) namen.delete(n);
  return [...namen].sort();
}

test('every handler from markup and templates is registered', async () => {
  const { w } = await openUi();
  try {
    const namen = namesInMarkup();
    assert.ok(namen.length > 100, `nur ${namen.length} Namen gefunden — greift die Suche noch?`);
    const angemeldet = new Set(w.__registry.actionNames());
    assert.deepEqual(
      namen.filter(n => !angemeldet.has(n)),
      [],
      'Nicht angemeldet — diese Knöpfe täten beim Klick nichts',
    );
  } finally {
    w.close();
  }
});

test('a click passes arguments, field value and this through', async () => {
  const { w, d } = await openUi();
  try {
    const gesehen = [];
    w.__registry.registerActions({
      probeAction(...args) {
        gesehen.push({ dies: this, args });
      },
    });
    const host = d.createElement('div');
    host.innerHTML =
      '<button id="p1" data-click="probeAction" data-arg="1" data-arg2="b" data-arg3="c">x</button>' +
      '<input id="p2" data-click="probeAction" data-arg="k" data-val="1" value="42">' +
      '<button id="p3" data-click="gibtEsNicht">x</button>';
    d.body.append(host);
    d.getElementById('p1').click();
    d.getElementById('p2').click();
    const warnings = [];
    w.console.warn = (...a) => warnings.push(a.join(' '));
    d.getElementById('p3').click();
    assert.equal(gesehen.length, 2);
    assert.equal(gesehen[0].dies, d.getElementById('p1'), 'this ist das auslösende Element');
    // data-arg always arrives as a string; the event comes last.
    assert.deepEqual(gesehen[0].args.slice(0, 3), ['1', 'b', 'c']);
    assert.equal(gesehen[0].args[3]?.type, 'click');
    assert.deepEqual(gesehen[1].args.slice(0, 2), ['k', '42'], 'data-val="1" reicht den Feldwert');
    assert.ok(
      warnings.some(t => t.includes('unknown handler') && t.includes('gibtEsNicht')),
      'Ein Tippfehler im Handlernamen muss auffallen',
    );
  } finally {
    w.close();
  }
});

/** An image that does not load: error does not bubble, the dispatcher listens in the capture phase. */
const failure = (w, img) => img.dispatchEvent(new w.Event('error'));

test('an image error is retried once before the fallback applies', async () => {
  const { w, d } = await openUi();
  try {
    const host = d.createElement('div');
    host.innerHTML = '<img id="b1" alt="" src="/images/sets/1-1.jpg" data-orig="/images/sets/1-1-gross.jpg">';
    d.body.append(host);
    const img = d.getElementById('b1');
    const gesetzt = [];
    const echt = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, 'src');
    Object.defineProperty(img, 'src', {
      get() {
        return echt.get.call(this);
      },
      set(v) {
        gesetzt.push(v);
        echt.set.call(this, v);
      },
    });
    failure(w, img);
    assert.equal(img.dataset.retried, '1', 'Kein zweiter Versuch vorgemerkt');
    assert.ok(img.getAttribute('src'), 'Das Bild ist nach dem ersten Fehler schon weg');
    // After one second the same address again, via a freshly set attribute.
    assert.ok(await warte(() => gesetzt.length > 0, 3000), 'Der zweite Versuch kommt nicht');
    assert.equal(gesetzt[0], 'http://localhost/images/sets/1-1.jpg');
    // Only the second error resorts to the fallback: the full resolution from data-orig.
    failure(w, img);
    assert.equal(img.getAttribute('src'), '/images/sets/1-1-gross.jpg');
  } finally {
    w.close();
  }
});

test('the zoom keeps its address if the image does not load', async () => {
  const { w, d } = await openUi();
  try {
    const img = d.getElementById('lightbox-img');
    assert.equal(img.dataset.onerror, 'keep');
    img.dataset.retried = '1';
    img.setAttribute('src', '/images/sets/2-1.jpg');
    const warnings = [];
    w.console.warn = (...a) => warnings.push(a.join(' '));
    failure(w, img);
    failure(w, img);
    assert.equal(img.getAttribute('src'), '/images/sets/2-1.jpg', 'Der Zoom zeigt sonst ein leeres Overlay');
    assert.equal(img.dataset.fallbackDone, undefined);
    assert.ok(
      warnings.some(t => t.includes('[img]') && t.includes('/images/sets/2-1.jpg')),
      'Die Konsole nennt die Adresse',
    );
  } finally {
    w.close();
  }
});

test('the log window loads its script as a file', async () => {
  const { w, d } = await openUi();
  try {
    let geschrieben = '';
    w.open = () => ({
      document: {
        open() {},
        write(s) {
          geschrieben += s;
        },
        close() {},
      },
    });
    d.querySelector('[data-click="openLogViewer"]').click();
    await takt(0);
    assert.ok(geschrieben.length > 500, 'Das Fenster bekommt kein Markup');
    const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));
    const fenster = new JSDOM(geschrieben).window.document;
    const skripte = [...fenster.querySelectorAll('script')];
    assert.deepEqual(
      skripte.filter(s => !s.src).map(s => s.textContent.slice(0, 40)),
      [],
      'Inline-<script> blockiert die CSP, die das Fenster vom Öffner erbt',
    );
    assert.ok(
      skripte.some(s => /\/js\/logviewer\.js/.test(s.src)),
      'logviewer.js fehlt',
    );
    // The data is in the attribute, escaped: the JSON with its quotes arrives intact.
    assert.equal(fenster.body.dataset.base, 'http://localhost');
    assert.equal(typeof JSON.parse(fenster.body.dataset.i18n)['log.entries'], 'string');
    assert.equal(fenster.body.hasAttribute('data-auth'), false, 'Die Sitzung meldet das Fenster an, kein Token');
  } finally {
    w.close();
  }
});
