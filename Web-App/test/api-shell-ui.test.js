/**
 * Uploads, downloads and streams also go through the API shell (api/apiRaw in
 * js/api.js) — on the real bundle in jsdom. Then the same rules apply to them
 * as to every other call: the UI language goes along,
 * a 401 visibly ends the session, a network error shows the banner.
 *
 * Counter-checks (measured on 05.11.2026):
 *   A  importAlertsCsv back with `fetch('/api/v2/alerts/import/csv', …)` →
 *      red: “upload carries the language” (no Accept-Language) and
 *      “401 on upload” (the login mask stayed hidden)
 *   B  in apiRaw the line `if (res.status === 401) melde('sessionEnded', path)`
 *      removed → red: “401 on upload”
 *   C  in uploadCsv (bausteine.js) `d.skipped_hint` taken out of the message
 *      → red: “skipped lines”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

/** Selects a CSV file in the alert import, as the file dialog would. */
function chooseAlarmCsv(w) {
  const field = w.document.getElementById('alerts-csv-file');
  const datei = new w.File(['set_number,threshold\n10294-1,100\n'], 'alarme.csv', { type: 'text/csv' });
  Object.defineProperty(field, 'files', { value: [datei], configurable: true });
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('upload carries the language and goes as FormData without a JSON header', async () => {
  const { w, aufrufe } = await openUi(
    {
      '/v2/alerts/import/csv': { success: true, added: 1, updated: 0, errors: 0 },
    },
    { language: 'en' },
  );
  try {
    chooseAlarmCsv(w);
    assert.ok(await warte(() => aufrufe.some(a => a.url.endsWith('/alerts/import/csv'))), 'Upload was not sent');
    const upload = aufrufe.find(a => a.url.endsWith('/alerts/import/csv'));
    assert.equal(upload.method, 'POST');
    assert.ok(upload.body instanceof w.FormData, 'Body is not FormData');
    assert.equal(upload.headers['Accept-Language'], 'en', 'Accept-Language is missing on the upload');
    assert.equal(upload.headers['Content-Type'], undefined, 'A set Content-Type breaks the multipart boundary');
  } finally {
    w.close();
  }
});

test('401 on upload ends the session as with every other call', async () => {
  const { w, d } = await openUi({
    '/v2/alerts/import/csv': { $status: 401, success: false, error: 'Nicht angemeldet', code: 'not_signed_in' },
  });
  try {
    assert.equal(d.getElementById('login-screen').style.display, 'none', 'Precondition: signed in');
    chooseAlarmCsv(w);
    assert.ok(
      await warte(() => d.getElementById('login-screen').style.display === 'flex'),
      'After 401 the sign-in form is not shown',
    );
    assert.equal(d.getElementById('app').style.display, 'none');
  } finally {
    w.close();
  }
});

test('the CSV import reports skipped rows and additional hints in one message', async () => {
  const { w, d } = await openUi({
    '/v2/alerts/import/csv': {
      success: true,
      added: 1,
      updated: 0,
      errors: 0,
      skipped: 2,
      skipped_hint: 'zwei Zeilen übersprungen',
      currency_note: 'Währung CHF',
    },
  });
  try {
    chooseAlarmCsv(w);
    assert.ok(
      await warte(() => /zwei Zeilen übersprungen/.test(d.getElementById('toasts')?.textContent || '')),
      'The hint about skipped rows is missing in the message',
    );
    const text = d.getElementById('toasts').textContent;
    assert.match(text, /Währung CHF/, 'The extra hint of the alert import is missing');
    assert.equal(w.document.getElementById('alerts-csv-file').value, '', 'The file field is not cleared');
  } finally {
    w.close();
  }
});
