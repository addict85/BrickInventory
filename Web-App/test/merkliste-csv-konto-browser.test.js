/**
 * Der CSV-Import der Merkliste schreibt in das Konto, das im Feld „Für Konto“
 * gewählt ist — wie das Erfassen eines einzelnen Merkpostens daneben. Die
 * Typprüfung fand den Fehler: selectedOwner() wurde ohne Feldkennung gerufen
 * und lieferte immer „kein Konto“.
 *
 * Gegenprobe (05.11.2026 gemessen, Bündel neu gebaut): in importMerklisteCsv
 * wieder `selectedOwner()` ohne Kennung → rot: „Zielkonto im Upload“
 * (owner_user_id fehlte im Formular).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

test('Merkliste: CSV-Import in das gewählte Konto', { timeout: 120_000 }, async t => {
  const app = await starteApp(t, { name: `mkcsv_${process.pid}`, bestand: musterHaushalt });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const kid = (await db.get('SELECT id FROM users WHERE username = $1', [`mkcsv_${process.pid}_kind`])).id;
  await b.auswerten(`location.hash = '#/merkliste'; true`);
  // Das Konto-Feld erscheint, sobald die Haushaltsmitglieder geladen sind.
  await bis(
    `[...document.querySelectorAll('#mk-owner option')].some(o => o.value === '${kid}')
    && getComputedStyle(document.getElementById('mk-owner-box')).display !== 'none'`,
    'Konto-Feld',
  );
  // Den Upload abfangen statt ihn an den Server zu schicken: Geprüft wird, was die Oberfläche sendet.
  await b.auswerten(`(() => {
    const echt = window.fetch.bind(window);
    window.__upload = null;
    window.fetch = (url, o) => {
      if (!String(url).includes('/v1/wanted/import/csv')) return echt(url, o);
      window.__upload = Object.fromEntries([...o.body.entries()].filter(([k]) => k !== 'file'));
      return Promise.resolve(new Response(JSON.stringify({ success: true, total: 0, added: 0, skipped: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    const sel = document.getElementById('mk-owner'); sel.value = '${kid}';
    const feld = document.getElementById('mk-csv-file');
    const dt = new DataTransfer(); dt.items.add(new File(['Set;Zustand\\n10294-1;N\\n'], 'liste.csv', { type: 'text/csv' }));
    feld.files = dt.files;
    feld.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
  await bis(`window.__upload !== null`, 'Upload gesendet');
  assert.deepEqual(await b.auswerten(`window.__upload`), { owner_user_id: String(kid) }, 'Zielkonto im Upload');
});
