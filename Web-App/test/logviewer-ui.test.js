/**
 * The log window (public/js/logviewer.js) in jsdom: loads with the
 * session cookie (no token in the markup), filters by level and search, and only its own four
 * handlers are reachable from the markup — not arbitrary functions on window.
 *
 * Counter-checks (measured on 05.11.2026):
 *   A  toggleLevel removed from HANDLER in logviewer.js → red: „Stufe info
 *      zuschalten“ (the info row stays hidden)
 *   B  fallback to `window[name]` added in the resolution → red: “a foreign
 *      name stays ineffective” (window.alert was called)
 *   C  fetch again with a Bearer header instead of credentials → red: “loads with the
 *      session cookie …” (credentials undefined instead of same-origin)
 *   D  (16.11.2026) in renderLogs() the level raw again instead of tx('log.stufe.…') → red: “level translated,
 *      stack trace collapsed” („error“ instead of „Fehler“); meldung() without <details> → red: same place
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkResponse } = require('./helpers/ui');
const { warte: takt } = require('./helpers/time');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'public', 'js', 'logviewer.js'), 'utf8');

function oeffne() {
  const { JSDOM } = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const dom = new JSDOM(
    `<!doctype html><html><body data-base="" data-i18n='{"log.entries":"Einträge","log.level.error":"Error","log.more_rows":"{n} weitere Zeilen"}'>
    <select id="period" data-change="loadLogs"><option value="15">15</option></select>
    <button id="btn-info" data-click="toggleLevel" data-arg="info"></button>
    <button id="btn-warn" class="active" data-click="toggleLevel" data-arg="warn"></button>
    <button id="btn-error" class="active" data-click="toggleLevel" data-arg="error"></button>
    <input id="search" data-input="renderLogs">
    <button id="btn-auto" data-click="toggleAuto"></button>
    <button id="fremd" data-click="alert">x</button>
    <span id="status"></span><div id="log-wrap"></div></body></html>`,
    { runScripts: 'outside-only', url: 'http://localhost/' },
  );
  const w = dom.window;
  const aufrufe = [];
  w.fetch = async (url, o = {}) => {
    aufrufe.push({ url: String(url), headers: o.headers || {}, credentials: o.credentials });
    const daten = checkResponse(o.method || 'GET', url, {
      success: true,
      logs: [
        { level: 'info', message: 'Start fertig', logged_at: '2026-11-05T10:00:00Z' },
        { level: 'error', message: 'Abruf <b>kaputt</b>', logged_at: '2026-11-05T10:01:00Z' },
        {
          level: 'error',
          message: 'Abbruch\n    at lade (a.js:1)\n    at start (b.js:2)',
          logged_at: '2026-11-05T10:02:00Z',
        },
      ],
    });
    return { ok: true, json: async () => daten };
  };
  let alarm = 0;
  w.alert = () => {
    alarm++;
  };
  w.eval(SCRIPT);
  return { w, d: w.document, aufrufe, alarm: () => alarm };
}

test('loads with the session cookie and only shows the chosen levels, escaped', async () => {
  const { w, d, aufrufe } = oeffne();
  try {
    await takt(10);
    assert.equal(aufrufe.length, 1);
    assert.match(aufrufe[0].url, /\/api\/v2\/admin\/logs\?minutes=15$/);
    assert.equal(aufrufe[0].credentials, 'same-origin');
    assert.equal(aufrufe[0].headers.Authorization, undefined, 'kein Token mehr');
    const zeilen = d.querySelectorAll('#log-wrap .ll');
    assert.equal(zeilen.length, 2, 'info ist zu Beginn ausgeblendet');
    assert.match(zeilen[0].innerHTML, /&lt;b&gt;kaputt/, 'Meldungstext wird maskiert');
    assert.equal(d.getElementById('status').textContent, '2 / 3 Einträge');
  } finally {
    w.close();
  }
});

test('switch on level info and filter the search', async () => {
  const { w, d } = oeffne();
  try {
    await takt(10);
    d.getElementById('btn-info').click();
    assert.equal(d.querySelectorAll('#log-wrap .ll').length, 3, 'Stufe info zuschalten');
    const suche = d.getElementById('search');
    suche.value = 'start fertig';
    suche.dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelectorAll('#log-wrap .ll').length, 1);
    assert.match(d.querySelector('#log-wrap mark').textContent, /Start/);
  } finally {
    w.close();
  }
});

test('a foreign name stays ineffective', async () => {
  const { w, d, alarm } = oeffne();
  try {
    await takt(10);
    d.getElementById('fremd').click();
    assert.equal(alarm(), 0, 'data-click="alert" darf window.alert nicht erreichen');
    assert.equal(typeof w.loadLogs, 'undefined', 'Die Handler sollen nicht global sein');
  } finally {
    w.close();
  }
});

test('level translated, stack trace collapsed, the search expands it', async () => {
  const { w, d } = oeffne();
  try {
    await takt(10);
    const stapel = [...d.querySelectorAll('#log-wrap .ll')].find(z => z.textContent.includes('Abbruch'));
    assert.equal(stapel.querySelector('.lv').textContent, 'Error');
    const auf = stapel.querySelector('details');
    assert.ok(auf && !auf.open, 'Stacktrace nicht eingeklappt');
    assert.match(auf.querySelector('summary').textContent, /^Abbruch \(2 weitere Zeilen\)$/);
    const suche = d.getElementById('search');
    suche.value = 'b.js';
    suche.dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelector('#log-wrap details')?.open, true, 'Treffer im Stacktrace bleibt verborgen');
  } finally {
    w.close();
  }
});
