/**
 * The price alert is saved while TYPING — but only once.
 *
 * ── The counter-check runs ALONG ─────────────────────────────────────────────
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { BUNDLE_FILE, placeBundleSafe } = require('./helpers/bundle');
placeBundleSafe();
const BUNDLE = fs.readFileSync(BUNDLE_FILE, 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'js', 'detail-fields.js'), 'utf8');

/**
 * The three controls of the alert — cut FROM THE REAL SOURCE TEXT.
 *
 * Exactly this stood here first, and the counter-check for it stayed GREEN: I
 * turned the wiring in the source text back from `data-input="alertTyped"` to the old
 * `data-change="saveAlert"` — exactly the bug this file
 * is meant to report — and the check noticed nothing. It had built its
 * own markup and thus checked a wiring that no longer existed in the
 * tree at all.
 */
function alarmMarkup(sn) {
  // From the CONDITION FIELD, not from the direction: since the alert also applies to
  // “used", the condition field comes first, and alertState() reads
  // it. Without the field the test bench would silently fall back to “new" and check
  // a UI that does not exist like that.
  const i = ADMIN.indexOf('<select id="${p}-alert-cond"');
  const j = ADMIN.indexOf('id="${p}-alert-state"');
  assert.ok(i > 0 && j > i, 'The alert markup is no longer where expected');
  const roh = ADMIN.slice(i, ADMIN.indexOf('</span>', j) + 7);
  return (
    roh
      // The prefix of the set dialog. It is ${p} in alertBlock(); here
      // it becomes what stands there at runtime.
      .replace(/\$\{p\}/g, 'm')
      .replace(/\$\{(?:escJs\()?sn\)?\}/g, sn)
      // The labels come from the translation; only the wiring counts here,
      // not the text.
      .replace(/\$\{[^}]*\}/g, 'x')
  );
}

/** The idle time from detailfelder.js — here only to tick ABOVE and BELOW it. */
const REST = 800;

/** A window with a loaded bundle and the alert markup of the detail window. */
function fenster() {
  const vc = new jsdom.VirtualConsole();
  const meldungen = [];
  vc.on('warn', (...a) => meldungen.push(['warn', ...a].join(' ')));
  vc.on('error', (...a) => meldungen.push(['error', ...a].join(' ')));
  const dom = new jsdom.JSDOM(HTML, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const w = dom.window;
  const callIt = [];
  w.fetch = async (u, o = {}) => {
    // The startup query is not part of the measurement.
    if (!String(u).includes('startup-status')) callIt.push(`${o.method || 'GET'} ${u}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, alerts: [], locations: [], alert: { condition: 'N', triggered: false } }),
    };
  };
  w.eval(BUNDLE);

  const d = w.document.createElement('div');
  d.innerHTML = alarmMarkup('10179-1');
  w.document.body.appendChild(d);
  // schliesse(): WITHOUT it the check hangs. startApp() in the bundle
  // polls /api/v2/startup-status every second, and this timer
  // keeps the Node process alive long after the test is done.
  return { w, callIt, meldungen, field: w.document.getElementById('m-alert-val'), schliesse: () => w.close() };
}

const { warte } = require('./helpers/time');

/** “249.90" character by character, with [takt] ms between the keystrokes. */
async function tap(f, takt, text = '249.90') {
  for (let i = 1; i <= text.length; i++) {
    f.field.value = text.slice(0, i);
    f.field.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    await warte(takt);
  }
  await warte(REST * 2);
}

test('typing saves — and the quiet period turns it into ONE request', async () => {
  const schnell = fenster();
  await tap(schnell, 40);
  assert.deepEqual(schnell.meldungen, [], 'There were messages in the console');

  // 1. It is saved at all — that was Marco's finding.
  assert.ok(schnell.callIt.length >= 1, 'Typing triggered nothing at all — exactly the reported bug');

  // 2. And only once, not per character.
  const langsam = fenster();
  await tap(langsam, REST + 200);
  assert.ok(
    langsam.callIt.length > schnell.callIt.length,
    `The debounce time changes nothing: fast ${schnell.callIt.length}, slow ` +
      `${langsam.callIt.length}. Without this gap the test bench only measures itself.`,
  );
  assert.equal(
    schnell.callIt.length,
    1,
    `Fast typing produced ${schnell.callIt.length} requests: ${schnell.callIt.join(' | ')}`,
  );

  // 3. The last number wins — not the intermediate states “2" or “24".
  //    Exactly those would have remained without idle time, and a threshold at 2
  //    reports immediately.
  assert.match(schnell.callIt[0], /^PUT .*\/sets\/10179-1\/alert$/, `Not saved via PUT: ${schnell.callIt[0]}`);
  schnell.schliesse();
  langsam.schliesse();
});

test('the response does NOT write back into the field', async () => {
  // The reason is at showAlertMarker(): whoever types “249.90" may already have set
  // the last zero after the idle time behind “249.9". A
  // reload would turn it back into “249.9" and eat the character.
  const f = fenster();
  await tap(f, 40);
  assert.equal(f.field.value, '249.90', 'The field was overwritten');
  assert.deepEqual(
    f.callIt.filter(r => r.startsWith('GET')),
    [],
    'After saving, the alert was reloaded — that touches the field',
  );
  f.schliesse();
});

test('a cleared field deletes', async () => {
  // The natural gesture to get rid of an alert. A separate button next to it
  // would be a second path for the same intent.
  const f = fenster();
  f.field.value = '';
  f.field.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await warte(REST * 2);
  assert.equal(f.callIt.length, 1, `Requests: ${f.callIt.join(' | ')}`);
  assert.match(f.callIt[0], /^DELETE .*\/alert\?condition=N$/, `An empty field did not delete: ${f.callIt[0]}`);
  f.schliesse();
});
