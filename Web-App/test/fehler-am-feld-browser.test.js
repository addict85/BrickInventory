/**
 * Ein Fehlermuster: Eingabefehler stehen am Feld (aria-invalid, Meldung mit
 * role=alert darunter), nicht als Toast; ein Fehler-Toast gehört zu seiner
 * Ansicht und verschwindet beim Wechsel.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  gutscheinSpeichern (POST) wieder `toast(d?.error …)` statt
 *      antwortFehler → rot: „Gutschein: leere Nummer am Feld“
 *   B  btn-sav-pw wieder `toast(… mismatch …)` → rot: „Passwort: ungleich am Feld“
 *   C  legeLagerortAn wieder `if (!name) return;` → rot: „Lagerort: leerer Name am Feld“
 *   D  verwirfToasts() in meldeAnsicht entfernt → rot: „Fehler-Toast endet mit der Ansicht“
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

/** Zustand eines Feldes: markiert, Meldung darunter, und ob ein Fehler-Toast steht. */
const FELD =
  id => `(() => { const f = document.getElementById(${JSON.stringify(id)}), m = document.getElementById(${JSON.stringify(id + '-fehler')});
  return { markiert: f?.getAttribute('aria-invalid') === 'true', meldung: m && !m.hidden ? m.textContent : '',
           beschrieben: (f?.getAttribute('aria-describedby') || '').includes(${JSON.stringify(id + '-fehler')}),
           toasts: [...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent) }; })()`;

test('Fehler am Feld, Toasts an der Ansicht', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, {
    name: `feld_${process.pid}`,
    bestand: async (db, uid) => {
      await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Keller'), ($1, 'Vitrine')`, [uid]);
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const toastsWeg = () => b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);

  await t.test('Gutschein: leere Nummer am Feld', async () => {
    await b.auswerten(`location.hash = '#/gutscheine'; true`);
    await bis(
      `!!document.querySelector('[data-click="gutscheinSpeichern"]')?.getClientRects().length`,
      'Gutscheinformular',
    );
    await toastsWeg();
    await b.auswerten(`document.querySelector('[data-click="gutscheinSpeichern"]').click(); true`);
    await bis(
      `document.getElementById('v-number')?.getAttribute('aria-invalid') === 'true' || document.querySelector('#toasts .toast.error')`,
      'Rückmeldung',
    );
    const z = await b.auswerten(FELD('v-number'));
    assert.deepEqual(
      { markiert: z.markiert, beschrieben: z.beschrieben, toasts: z.toasts },
      { markiert: true, beschrieben: true, toasts: [] },
    );
    assert.match(z.meldung, /Gutscheinnummer/);
  });

  await t.test('Passwort: ungleich am Feld', async () => {
    await b.auswerten(`location.hash = '#/konto'; true`);
    await bis(`!!document.getElementById('btn-sav-pw')?.getClientRects().length`, 'Kontoseite');
    await toastsWeg();
    await b.auswerten(`(() => { const G = id => document.getElementById(id); G('pw-n').value = 'neu-Passwort-1';
      G('pw-r').value = 'anders-Passwort-1'; G('btn-sav-pw').click(); return true; })()`);
    await ruhig();
    const z = await b.auswerten(FELD('pw-r'));
    assert.deepEqual({ markiert: z.markiert, toasts: z.toasts }, { markiert: true, toasts: [] });
    assert.match(z.meldung, /stimmen nicht überein/);
  });

  await t.test('Lagerort: leerer Name am Feld', async () => {
    await b.auswerten(`location.hash = '#/lagerorte'; true`);
    await bis(
      `!!document.querySelector('[data-click="legeLagerortAn"]')?.getClientRects().length && document.querySelectorAll('.lager-eingabe').length === 2`,
      'Lagerorte',
    );
    await toastsWeg();
    await b.auswerten(`document.querySelector('[data-click="legeLagerortAn"]').click(); true`);
    await ruhig();
    const z = await b.auswerten(FELD('storage-new'));
    assert.equal(z.markiert, true);
    assert.match(z.meldung, /Namen/);
  });

  await t.test('Fehler-Toast endet mit der Ansicht', async () => {
    // Umbenennen auf einen vorhandenen Namen: der Server sagt ab, als Toast.
    await b.auswerten(`(() => { const f = [...document.querySelectorAll('.lager-eingabe')].find(x => x.value === 'Vitrine');
      f.value = 'Keller'; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await bis(`document.querySelectorAll('#toasts .toast.error').length > 0`, 'Fehler-Toast');
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await ruhig();
    assert.deepEqual(
      await b.auswerten(`[...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent)`),
      [],
    );
  });
});
