/**
 * Der Set-CSV-Import in der Oberfläche (UI-Prüfung 17: M2–M4, Barrierefreiheit
 * H3), echtes Bündel in jsdom, Serverantworten wie aus
 * csv-import-pruefung-db.test.js:
 *   - Sind Sets schon da, fragt die Oberfläche vor dem Start; „Abbrechen“
 *     startet nichts.
 *   - Solange der Auftrag wartet, sagt der Dialog „Wartet …“ statt 0 %.
 *   - Das Ergebnis nennt die Zeile, färbt Fehler rot und Unbekanntes gelb und
 *     zählt die gelesenen Zeilen; ein Eintrag ohne Setnummer und Zeile fehlt.
 *   - Der Fortschritt ist ein Dialog: Fokus darin, Statuszeile als Live-Region,
 *     Balken als progressbar, Minimieren mit Namen.
 *   - Nach dem Neuladen führt ein Eintrag im Import-Menü zum Ergebnis.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in startSetCsvImport die Rückfrage entfernt → rot: „vorhandene Sets:
 *      erst fragen“ (zweite Anfrage ohne pruefen)
 *   B  in csvApplyOverlayStatus den Wartetext entfernt → rot: „Ergebnisliste
 *      mit Zeilen“ (kein „Wartet“)
 *   C  protokollZeile ohne die Zeilennummer (wo = set_number) → rot:
 *      „Ergebnisliste mit Zeilen“
 *   D  role="status" an #prog-footer entfernt → rot: „Ergebnisliste mit Zeilen“
 *   E  merkeLetztenImport() in gibCheckOnLoad nicht gerufen → rot: „nach dem
 *      Neuladen“ (Eintrag bleibt hidden)
 *   F  csvPollLoop wieder mit api() statt apiDaten() → rot: „Ergebnisliste
 *      mit Zeilen“ (api() überschreibt `status` mit 200, der Abschluss kommt nie)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

const ERGEBNISSE = [
  { zeile: 2, set_number: '10200-1', success: true, action: 'added', menge: 1 },
  { zeile: 4, set_number: 'abc', success: false, error: 'Das ist keine Setnummer' },
  { zeile: 5, set_number: '10312-1', success: false, code: 'csv_menge_ungueltig', error: 'Menge „x“ ungültig' },
  { zeile: 6, set_number: '99999-1', success: true, action: 'added', menge: 1, katalog_offen: true },
  { zeile: 7, set_number: '', success: false, code: 'csv_keine_setnummer', error: 'keine Set-Nummer' },
  { success: true, action: 'updated' },
];
const FERTIG = {
  success: true,
  status: 'done',
  total: 8,
  done: 8,
  current: null,
  ok: 1,
  warn: 1,
  err: 3,
  results: ERGEBNISSE,
  beendet_am: new Date().toISOString(),
};

/** Eine Datei wählen, wie der Browser es täte. */
function waehleDatei(w, d) {
  const feld = d.getElementById('csv-file');
  Object.defineProperty(feld, 'files', {
    configurable: true,
    value: [new w.File(['Set Number,Quantity\n'], 'import.csv')],
  });
  feld.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('vorhandene Sets: erst fragen, Abbrechen startet nichts', async () => {
  const posts = [];
  const { w, d, ruhig } = await oeffneOberflaeche({
    '/v1/sets/import/csv': u => {
      posts.push(new URL(u, 'http://x').searchParams.get('pruefen'));
      return { success: true, total: 8, gestartet: false, vorhanden: 2, vorhanden_nummern: ['10305-1', '10200-1'] };
    },
  });
  try {
    waehleDatei(w, d);
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Rückfrage erscheint');
    assert.match(d.getElementById('cd-msg').textContent, /2 Sets .* schon in der Sammlung \(10305-1, 10200-1\)/);
    d.getElementById('cd-cancel').click();
    await ruhig();
    assert.deepEqual(posts, ['1'], 'nur die Prüfung lief');
    assert.ok(!d.getElementById('progress-overlay').classList.contains('open'));
  } finally {
    w.close();
  }
});

test('Ergebnisliste mit Zeilen, Farben und gelesenen Zeilen', async () => {
  let abrufe = 0,
    gestartet = false;
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets/import/csv': u =>
      u.includes('pruefen=1')
        ? { success: true, total: 8, gestartet: false, vorhanden: 0 }
        : ((gestartet = true), { success: true, total: 8, gestartet: true }),
    // Vor dem Start läuft nichts; danach erst ein wartender Auftrag, dann das Ergebnis.
    '/v1/sets/import/csv/status': () =>
      !gestartet
        ? { success: false, code: 'kein_import_laeuft' }
        : ++abrufe < 2
          ? { success: true, status: 'running', total: 8, done: 0, current: null, ok: 0, warn: 0, err: 0, results: [] }
          : FERTIG,
  });
  try {
    waehleDatei(w, d);
    const ovl = d.getElementById('progress-overlay');
    assert.ok(await warte(() => ovl.classList.contains('open')), 'Fortschritt offen');
    assert.equal(ovl.getAttribute('role'), 'dialog');
    assert.equal(ovl.getAttribute('aria-modal'), 'true');
    await takt(20);
    assert.ok(ovl.contains(d.activeElement), `Fokus liegt auf ${d.activeElement?.outerHTML?.slice(0, 60)}`);
    assert.equal(d.getElementById('prog-footer').getAttribute('role'), 'status');
    assert.equal(d.getElementById('prog-bar-wrap').getAttribute('role'), 'progressbar');
    assert.equal(ovl.querySelector('[data-click="hideProgress"]').getAttribute('aria-label'), 'Minimieren');
    assert.ok(await warte(() => /Wartet/.test(d.getElementById('prog-set-name').textContent), 2500), 'Wartetext');

    assert.ok(await warte(() => d.querySelectorAll('#csv-log .csv-log-line').length >= 5, 5000), 'Ergebnis da');
    const zeilen = [...d.querySelectorAll('#csv-log .csv-log-line')].map(
      z => `${z.className.replace('csv-log-line ', '')}|${z.textContent}`,
    );
    assert.deepEqual(zeilen, [
      'ok|Zeile 2 · 10200-1 – hinzugefügt',
      'er|Zeile 4 · abc: Das ist keine Setnummer',
      'er|Zeile 5 · 10312-1: Menge „x“ ungültig',
      'warn|Zeile 6 · 99999-1 – hinzugefügt — nicht im Katalog',
      'er|Zeile 7: keine Set-Nummer',
    ]);
    assert.match(d.getElementById('prog-footer').textContent, /8 Zeilen gelesen · 1 ok, 1 Warnung, 3 Fehler/);
    assert.equal(d.getElementById('prog-bar-wrap').getAttribute('aria-valuenow'), '100');
  } finally {
    w.close();
  }
});

test('nach dem Neuladen: der letzte Import im Menü', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/sets/import/csv/status': FERTIG });
  try {
    const knopf = d.getElementById('letzter-import');
    assert.ok(await warte(() => !knopf.hidden), 'Eintrag sichtbar');
    assert.match(knopf.textContent, /Letzter Import: 1 ok, 1 Warnung, 3 Fehler – ansehen/);
    knopf.click();
    assert.ok(await warte(() => d.getElementById('progress-overlay').classList.contains('open')));
    assert.ok(d.getElementById('csv-log').textContent.includes('abc'), 'Ergebnisliste enthält abc');
  } finally {
    w.close();
  }
});

test('ein alter Import bleibt aus dem Menü', async () => {
  const alt = { ...FERTIG, beendet_am: new Date(Date.now() - 25 * 3600_000).toISOString() };
  const { w, d, ruhig } = await oeffneOberflaeche({ '/v1/sets/import/csv/status': alt });
  try {
    await ruhig();
    assert.equal(d.getElementById('letzter-import').hidden, true);
  } finally {
    w.close();
  }
});
