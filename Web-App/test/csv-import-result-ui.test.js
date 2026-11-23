/**
 * The set CSV import in the UI (UI review 17: M2–M4, accessibility
 * H3), real bundle in jsdom, server responses as from
 * csv-import-check-db.test.js:
 *   - If sets already exist, the UI asks before starting; “cancel”
 *     starts nothing.
 *   - As long as the job waits, the dialog says “Waiting …” instead of 0 %.
 *   - The result names the line, colors errors red and unknown items yellow and
 *     counts the lines read; an entry without set number and line is missing.
 *   - The progress is a dialog: focus inside, status line as live region,
 *     bar as progressbar, minimize with a name.
 *   - After reloading an entry in the import menu leads to the result.
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  in startSetCsvImport the confirmation removed → red: “existing sets:
 *      ask first” (second request without pruefen)
 *   B  in csvApplyOverlayStatus the waiting text removed → red: “result list
 *      with lines” (no “Wartet”)
 *   C  logRow without the line number (wo = set_number) → red:
 *      “result list with lines”
 *   D  role="status" removed from #prog-footer → red: “result list with lines”
 *   E  rememberLastImport() not called in gibCheckOnLoad → red: “after
 *      reloading” (entry stays hidden)
 *   F  csvPollLoop again with api() instead of apiData() → red: “result list
 *      with lines” (api() overwrites `status` with 200, the completion never comes)
 *   G  csv.import_message removed from de.js → red: “result list with lines”
 *      (the message shows the raw key; 08.11.2026)
 *   H  (16.11.2026) showImportCompletion() without hiding “minimize” → red: “result list with
 *      lines” (after completion still “minimize”)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick } = require('./helpers/ui');

const RESULTS = [
  { row: 2, set_number: '10200-1', success: true, action: 'added', quantity: 1 },
  { row: 4, set_number: 'abc', success: false, error: 'Das ist keine Setnummer' },
  { row: 5, set_number: '10312-1', success: false, code: 'csv_quantity_invalid', error: 'Menge „x“ ungültig' },
  { row: 6, set_number: '99999-1', success: true, action: 'added', quantity: 1, catalog_pending: true },
  { row: 7, set_number: '', success: false, code: 'csv_no_set_number', error: 'keine Setnummer' },
  { success: true, action: 'updated' },
];
const DONE = {
  success: true,
  status: 'done',
  total: 8,
  done: 8,
  current: null,
  ok: 1,
  warn: 1,
  err: 3,
  results: RESULTS,
  finished_at: new Date().toISOString(),
};

/** Choose a file as the browser would. */
function chooseFile(w, d) {
  const field = d.getElementById('csv-file');
  Object.defineProperty(field, 'files', {
    configurable: true,
    value: [new w.File(['Set Number,Quantity\n'], 'import.csv')],
  });
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('existing sets: ask first, cancel starts nothing', async () => {
  const posts = [];
  const { w, d, settle } = await openUi({
    '/v2/sets/import/csv': u => {
      posts.push(new URL(u, 'http://x').searchParams.get('check'));
      return { success: true, total: 8, started: false, existing: 2, existing_numbers: ['10305-1', '10200-1'] };
    },
  });
  try {
    chooseFile(w, d);
    assert.ok(
      await waitFor(() => d.getElementById('confirm-modal').style.display === 'flex'),
      'Confirmation prompt appears',
    );
    assert.match(d.getElementById('cd-msg').textContent, /2 Sets .* schon in der Sammlung \(10305-1, 10200-1\)/);
    d.getElementById('cd-cancel').click();
    await settle();
    assert.deepEqual(posts, ['1'], 'only the check ran');
    assert.ok(!d.getElementById('progress-overlay').classList.contains('open'));
  } finally {
    w.close();
  }
});

test('result list with rows, colors and read rows', async () => {
  let fetches = 0,
    started = false;
  const { w, d } = await openUi({
    '/v2/sets/import/csv': u => {
      if (u.includes('pruefen=1')) return { success: true, total: 8, started: false, existing: 0 };
      started = true;
      return { success: true, total: 8, started: true };
    },
    // Before the start nothing runs; afterwards first a waiting job, then the result.
    '/v2/sets/import/csv/status': () =>
      !started
        ? { success: false, code: 'no_import_running' }
        : ++fetches < 2
          ? { success: true, status: 'running', total: 8, done: 0, current: null, ok: 0, warn: 0, err: 0, results: [] }
          : DONE,
  });
  try {
    chooseFile(w, d);
    const ovl = d.getElementById('progress-overlay');
    assert.ok(await waitFor(() => ovl.classList.contains('open')), 'Progress open');
    assert.equal(ovl.getAttribute('role'), 'dialog');
    assert.equal(ovl.getAttribute('aria-modal'), 'true');
    await tick(20);
    assert.ok(ovl.contains(d.activeElement), `Focus is on ${d.activeElement?.outerHTML?.slice(0, 60)}`);
    assert.equal(d.getElementById('prog-footer').getAttribute('role'), 'status');
    assert.equal(d.getElementById('prog-bar-wrap').getAttribute('role'), 'progressbar');
    assert.equal(ovl.querySelector('[data-click="hideProgress"]').getAttribute('aria-label'), 'Minimieren');
    assert.ok(await waitFor(() => /Wartet/.test(d.getElementById('prog-set-name').textContent), 2500), 'Wartetext');

    assert.ok(await waitFor(() => d.querySelectorAll('#csv-log .csv-log-line').length >= 5, 5000), 'Result there');
    const lines = [...d.querySelectorAll('#csv-log .csv-log-line')].map(
      z => `${z.className.replace('csv-log-line ', '')}|${z.textContent}`,
    );
    assert.deepEqual(lines, [
      'ok|Zeile 2 · 10200-1 – hinzugefügt',
      'er|Zeile 4 · abc: Das ist keine Setnummer',
      'er|Zeile 5 · 10312-1: Menge „x“ ungültig',
      'warn|Zeile 6 · 99999-1 – hinzugefügt — nicht im Katalog',
      'er|Zeile 7: keine Setnummer',
    ]);
    assert.match(d.getElementById('prog-footer').textContent, /8 Zeilen gelesen · 1 ok, 1 Warnung, 3 Fehler/);
    assert.equal(d.querySelector('#toasts .toast .toast-text')?.textContent, 'Import: 1 ok, 1 Warnung, 3 Fehler');
    assert.equal(d.getElementById('prog-bar-wrap').getAttribute('aria-valuenow'), '100');
    assert.equal(ovl.querySelector('.prog-minimize').hidden, true, 'still „Minimieren“ after completion');
    assert.notEqual(d.getElementById('btn-close-import').style.display, 'none', 'no „Schliessen“');
  } finally {
    w.close();
  }
});

test('after reloading: the last import in the menu', async () => {
  const { w, d } = await openUi({ '/v2/sets/import/csv/status': DONE });
  try {
    const button = d.getElementById('last-import');
    assert.ok(await waitFor(() => !button.hidden), 'Entry visible');
    assert.match(button.textContent, /Letzter Import: 1 ok, 1 Warnung, 3 Fehler – ansehen/);
    button.click();
    assert.ok(await waitFor(() => d.getElementById('progress-overlay').classList.contains('open')));
    assert.ok(d.getElementById('csv-log').textContent.includes('abc'), 'Result list contains abc');
  } finally {
    w.close();
  }
});

test('an old import stays out of the menu', async () => {
  const alt = { ...DONE, finished_at: new Date(Date.now() - 25 * 3600_000).toISOString() };
  const { w, d, settle } = await openUi({ '/v2/sets/import/csv/status': alt });
  try {
    await settle();
    assert.equal(d.getElementById('last-import').hidden, true);
  } finally {
    w.close();
  }
});
