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
const { BUENDEL, placeBundleSafe } = require('./helpers/bundle');
placeBundleSafe();
const BUNDLE = fs.readFileSync(BUENDEL, 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'js', 'detail-fields.js'), 'utf8');

/**
 * The three controls of the alert — cut FROM THE REAL SOURCE TEXT.
 *
 * Exactly this stood here first, and the counter-check for it stayed GREEN: I
 * turned the wiring in the source text back from `data-input="alarmGetippt"` to the old
 * `data-change="speichereAlarm"` — exactly the bug this file
 * is meant to report — and the check noticed nothing. It had built its
 * own markup and thus checked a wiring that no longer existed in the
 * tree at all.
 */
function alarmMarkup(sn) {
  // From the CONDITION FIELD, not from the direction: since the alert also applies to
  // “used", the condition field comes first, and alarmState() reads
  // it. Without the field the test bench would silently fall back to “new" and check
  // a UI that does not exist like that.
  const i = ADMIN.indexOf('<select id="${p}-alert-cond"');
  const j = ADMIN.indexOf('id="${p}-alert-state"');
  assert.ok(i > 0 && j > i, 'Das Alarm-Markup steht nicht mehr, wo erwartet');
  const roh = ADMIN.slice(i, ADMIN.indexOf('</span>', j) + 7);
  return (
    roh
      // The prefix of the set dialog. It is ${p} in alarmBlock(); here
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
  const rufe = [];
  w.fetch = async (u, o = {}) => {
    // The startup query is not part of the measurement.
    if (!String(u).includes('startup-status')) rufe.push(`${o.method || 'GET'} ${u}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, alerts: [], orte: [], alert: { condition: 'N', triggered: false } }),
    };
  };
  w.eval(BUNDLE);

  const d = w.document.createElement('div');
  d.innerHTML = alarmMarkup('10179-1');
  w.document.body.appendChild(d);
  // schliesse(): WITHOUT it the check hangs. startApp() in the bundle
  // polls /api/v1/startup-status every second, and this timer
  // keeps the Node process alive long after the test is done.
  return { w, rufe, meldungen, feld: w.document.getElementById('m-alert-val'), schliesse: () => w.close() };
}

const { warte } = require('./helpers/time');

/** “249.90" character by character, with [takt] ms between the keystrokes. */
async function tap(f, takt, text = '249.90') {
  for (let i = 1; i <= text.length; i++) {
    f.feld.value = text.slice(0, i);
    f.feld.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    await warte(takt);
  }
  await warte(REST * 2);
}

test('typing saves — and the quiet period turns it into ONE request', async () => {
  const schnell = fenster();
  await tap(schnell, 40);
  assert.deepEqual(schnell.meldungen, [], 'Es gab Meldungen in der Konsole');

  // 1. It is saved at all — that was Marco's finding.
  assert.ok(schnell.rufe.length >= 1, 'Tippen hat gar nichts ausgelöst — genau der gemeldete Fehler');

  // 2. And only once, not per character.
  const langsam = fenster();
  await tap(langsam, REST + 200);
  assert.ok(
    langsam.rufe.length > schnell.rufe.length,
    `Die Ruhezeit ändert nichts: schnell ${schnell.rufe.length}, langsam ` +
      `${langsam.rufe.length}. Ohne diesen Abstand misst der Prüfstand nur sich selbst.`,
  );
  assert.equal(
    schnell.rufe.length,
    1,
    `Schnelles Tippen ergab ${schnell.rufe.length} Anfragen: ${schnell.rufe.join(' | ')}`,
  );

  // 3. The last number wins — not the intermediate states “2" or “24".
  //    Exactly those would have remained without idle time, and a threshold at 2
  //    reports immediately.
  assert.match(
    schnell.rufe[0],
    /^PUT .*\/sets\/10179-1\/alert$/,
    `Gespeichert wurde nicht per PUT: ${schnell.rufe[0]}`,
  );
  schnell.schliesse();
  langsam.schliesse();
});

test('the response does NOT write back into the field', async () => {
  // The reason is at showAlarmMarker(): whoever types “249.90" may already have set
  // the last zero after the idle time behind “249.9". A
  // reload would turn it back into “249.9" and eat the character.
  const f = fenster();
  await tap(f, 40);
  assert.equal(f.feld.value, '249.90', 'Das Feld wurde überschrieben');
  assert.deepEqual(
    f.rufe.filter(r => r.startsWith('GET')),
    [],
    'Nach dem Speichern wurde der Alarm neu geladen — das fasst das Feld an',
  );
  f.schliesse();
});

test('a cleared field deletes', async () => {
  // The natural gesture to get rid of an alert. A separate button next to it
  // would be a second path for the same intent.
  const f = fenster();
  f.feld.value = '';
  f.feld.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await warte(REST * 2);
  assert.equal(f.rufe.length, 1, `Anfragen: ${f.rufe.join(' | ')}`);
  assert.match(f.rufe[0], /^DELETE .*\/alert\?condition=N$/, `Ein leeres Feld löschte nicht: ${f.rufe[0]}`);
  f.schliesse();
});
