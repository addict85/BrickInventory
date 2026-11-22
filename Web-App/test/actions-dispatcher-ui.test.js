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
const { buildTestBundle } = require('./helpers/bundle');

process.env.TEST_BUENDEL = buildTestBundle(
  'aktionen-dispatcher',
  "import { actionNames, registerActions } from './registry.js';\n" +
    'window.__registry = { actionNames, registerActions };\n',
);
const { openUi, warte, takt } = require('./helpers/ui');

const PUB = path.join(__dirname, '..', 'public');

/** Handler names in the markup and in the templates (structure); whether they are registered is told by the runtime. */
function namesInMarkup() {
  const sources = [
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
  for (const s of sources)
    for (const m of s.matchAll(/data-(?:click|change|input|blur|keydown)="([A-Za-z_$][\w$]*)"/g)) namen.add(m[1]);
  // The log viewer runs in its own window with its own table (logviewer-ui.test.js).
  for (const n of ['loadLogs', 'renderLogs', 'toggleAuto', 'toggleLevel']) namen.delete(n);
  return [...namen].sort();
}

test('every handler from markup and templates is registered', async () => {
  const { w } = await openUi();
  try {
    const namen = namesInMarkup();
    assert.ok(namen.length > 100, `only ${namen.length} names found — does the search still match?`);
    const angemeldet = new Set(w.__registry.actionNames());
    assert.deepEqual(
      namen.filter(n => !angemeldet.has(n)),
      [],
      'Not signed in — these buttons would do nothing on click',
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
    assert.equal(gesehen[0].dies, d.getElementById('p1'), 'this is the triggering element');
    // data-arg always arrives as a string; the event comes last.
    assert.deepEqual(gesehen[0].args.slice(0, 3), ['1', 'b', 'c']);
    assert.equal(gesehen[0].args[3]?.type, 'click');
    assert.deepEqual(gesehen[1].args.slice(0, 2), ['k', '42'], 'data-val="1" passes the field value');
    assert.ok(
      warnings.some(t => t.includes('unknown handler') && t.includes('gibtEsNicht')),
      'A typo in the handler name must be noticed',
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
    assert.equal(img.dataset.retried, '1', 'No second attempt scheduled');
    assert.ok(img.getAttribute('src'), 'The image is already gone after the first error');
    // After one second the same address again, via a freshly set attribute.
    assert.ok(await warte(() => gesetzt.length > 0, 3000), 'The second attempt does not come');
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
    assert.equal(img.getAttribute('src'), '/images/sets/2-1.jpg', 'Otherwise the zoom shows an empty overlay');
    assert.equal(img.dataset.fallbackDone, undefined);
    assert.ok(
      warnings.some(t => t.includes('[img]') && t.includes('/images/sets/2-1.jpg')),
      'The console names the address',
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
    assert.ok(geschrieben.length > 500, 'The window gets no markup');
    const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));
    const fenster = new JSDOM(geschrieben).window.document;
    const scriptList = [...fenster.querySelectorAll('script')];
    assert.deepEqual(
      scriptList.filter(s => !s.src).map(s => s.textContent.slice(0, 40)),
      [],
      'Inline <script> is blocked by the CSP the window inherits from its opener',
    );
    assert.ok(
      scriptList.some(s => /\/js\/logviewer\.js/.test(s.src)),
      'logviewer.js is missing',
    );
    // The data is in the attribute, escaped: the JSON with its quotes arrives intact.
    assert.equal(fenster.body.dataset.base, 'http://localhost');
    assert.equal(typeof JSON.parse(fenster.body.dataset.i18n)['log.entries'], 'string');
    assert.equal(fenster.body.hasAttribute('data-auth'), false, 'The session signs the window in, not a token');
  } finally {
    w.close();
  }
});
