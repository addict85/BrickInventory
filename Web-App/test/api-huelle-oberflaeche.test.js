/**
 * Auch Uploads, Downloads und Ströme laufen über die API-Hülle (api/apiRoh in
 * js/api.js) — am echten Bündel in jsdom. Dann gelten für sie dieselben
 * Regeln wie für jeden anderen Aufruf: die Sprache der Oberfläche geht mit,
 * ein 401 beendet die Sitzung sichtbar, ein Netzfehler zeigt das Band.
 *
 * Gegenproben (am 05.11.2026 gemessen):
 *   A  importAlarmeCsv wieder mit `fetch('/api/v1/alerts/import/csv', …)` →
 *      rot: „Upload trägt die Sprache“ (kein Accept-Language) und
 *      „401 beim Upload“ (die Anmeldemaske blieb verborgen)
 *   B  in apiRoh die Zeile `if (res.status === 401) melde('sitzungBeendet', path)`
 *      entfernt → rot: „401 beim Upload“
 *   C  in csvHochladen (bausteine.js) `d.skipped_hint` aus der Meldung
 *      genommen → rot: „übersprungene Zeilen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

/** Wählt im Alarm-Import eine CSV-Datei, wie es der Dateidialog täte. */
function waehleAlarmCsv(w) {
  const feld = w.document.getElementById('alerts-csv-file');
  const datei = new w.File(['set_number,threshold\n10294-1,100\n'], 'alarme.csv', { type: 'text/csv' });
  Object.defineProperty(feld, 'files', { value: [datei], configurable: true });
  feld.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('Upload trägt die Sprache und geht als FormData ohne JSON-Kopf', async () => {
  const { w, aufrufe } = await oeffneOberflaeche(
    {
      '/v1/alerts/import/csv': { success: true, added: 1, updated: 0, errors: 0 },
    },
    { sprache: 'en' },
  );
  try {
    waehleAlarmCsv(w);
    assert.ok(
      await warte(() => aufrufe.some(a => a.url.endsWith('/alerts/import/csv'))),
      'Upload wurde nicht abgeschickt',
    );
    const upload = aufrufe.find(a => a.url.endsWith('/alerts/import/csv'));
    assert.equal(upload.method, 'POST');
    assert.ok(upload.body instanceof w.FormData, 'Körper ist kein FormData');
    assert.equal(upload.headers['Accept-Language'], 'en', 'Accept-Language fehlt am Upload');
    assert.equal(
      upload.headers['Content-Type'],
      undefined,
      'Ein gesetzter Content-Type zerbricht die multipart-Grenze',
    );
  } finally {
    w.close();
  }
});

test('401 beim Upload beendet die Sitzung wie bei jedem anderen Aufruf', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/alerts/import/csv': { $status: 401, success: false, error: 'Nicht angemeldet', code: 'nicht_angemeldet' },
  });
  try {
    assert.equal(d.getElementById('login-screen').style.display, 'none', 'Vorbedingung: angemeldet');
    waehleAlarmCsv(w);
    assert.ok(
      await warte(() => d.getElementById('login-screen').style.display === 'flex'),
      'Nach 401 steht die Anmeldemaske nicht da',
    );
    assert.equal(d.getElementById('app').style.display, 'none');
  } finally {
    w.close();
  }
});

test('der CSV-Import meldet übersprungene Zeilen und Zusatzhinweise in einer Meldung', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/alerts/import/csv': {
      success: true,
      added: 1,
      updated: 0,
      errors: 0,
      skipped: 2,
      skipped_hint: 'zwei Zeilen übersprungen',
      waehrung_hinweis: 'Währung CHF',
    },
  });
  try {
    waehleAlarmCsv(w);
    assert.ok(
      await warte(() => /zwei Zeilen übersprungen/.test(d.getElementById('toasts')?.textContent || '')),
      'Der Hinweis auf übersprungene Zeilen fehlt in der Meldung',
    );
    const text = d.getElementById('toasts').textContent;
    assert.match(text, /Währung CHF/, 'Der Zusatzhinweis des Alarm-Imports fehlt');
    assert.equal(w.document.getElementById('alerts-csv-file').value, '', 'Das Dateifeld wird nicht geleert');
  } finally {
    w.close();
  }
});
