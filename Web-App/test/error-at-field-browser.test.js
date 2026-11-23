/**
 * One error pattern: input errors stand at the field (aria-invalid, message with
 * role=alert below), not as a toast; an error toast belongs to its
 * view and disappears on switching.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  saveVoucher (POST) again `toast(d?.error …)` instead of
 *      responseError → red: “voucher: empty number at the field”
 *   B  btn-sav-pw again `toast(… mismatch …)` → red: “password: mismatch at the field”
 *   C  createLocation again `if (!name) return;` → red: “storage location: empty name at the field”
 *   D  discardToasts() removed in reportView → red: “error toast ends with the view”
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

/** State of a field: marked, message below, and whether an error toast is shown. */
const FIELD =
  id => `(() => { const f = document.getElementById(${JSON.stringify(id)}), m = document.getElementById(${JSON.stringify(id + '-error')});
  return { marked: f?.getAttribute('aria-invalid') === 'true', message: m && !m.hidden ? m.textContent : '',
           described: (f?.getAttribute('aria-describedby') || '').includes(${JSON.stringify(id + '-error')}),
           toasts: [...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent) }; })()`;

test('errors at the field, toasts at the view', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `feld_${process.pid}`,
    holding: async (db, uid) => {
      await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Keller'), ($1, 'Vitrine')`, [uid]);
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const toastsRoute = () => b.evaluate(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);

  await t.test('voucher: empty number at the field', async () => {
    await b.evaluate(`location.hash = '#/gutscheine'; true`);
    await until(`!!document.querySelector('[data-click="saveVoucher"]')?.getClientRects().length`, 'Gutscheinformular');
    await toastsRoute();
    await b.evaluate(`document.querySelector('[data-click="saveVoucher"]').click(); true`);
    await until(
      `document.getElementById('v-number')?.getAttribute('aria-invalid') === 'true' || document.querySelector('#toasts .toast.error')`,
      'Feedback',
    );
    const z = await b.evaluate(FIELD('v-number'));
    assert.deepEqual(
      { marked: z.marked, described: z.described, toasts: z.toasts },
      { marked: true, described: true, toasts: [] },
    );
    assert.match(z.message, /Bitte ausfüllen/);
  });

  await t.test('password: unequal at the field', async () => {
    await b.evaluate(`location.hash = '#/konto'; true`);
    await until(`!!document.getElementById('btn-sav-pw')?.getClientRects().length`, 'Kontoseite');
    await toastsRoute();
    await b.evaluate(`(() => { const G = id => document.getElementById(id); G('pw-n').value = 'neu-Passwort-1';
      G('pw-r').value = 'anders-Passwort-1'; G('btn-sav-pw').click(); return true; })()`);
    await settle();
    const z = await b.evaluate(FIELD('pw-r'));
    assert.deepEqual({ marked: z.marked, toasts: z.toasts }, { marked: true, toasts: [] });
    assert.match(z.message, /stimmen nicht überein/);
  });

  await t.test('storage location: empty name at the field', async () => {
    await b.evaluate(`location.hash = '#/lagerorte'; true`);
    await until(
      `!!document.querySelector('[data-click="createLocation"]')?.getClientRects().length && document.querySelectorAll('.location-input').length === 2`,
      'Storage locations',
    );
    await toastsRoute();
    await b.evaluate(`document.querySelector('[data-click="createLocation"]').click(); true`);
    await settle();
    const z = await b.evaluate(FIELD('storage-new'));
    assert.equal(z.marked, true);
    assert.match(z.message, /Namen/);
  });

  await t.test('error toast ends with the view', async () => {
    // Renaming to an existing name: the server refuses, as a toast.
    await b.evaluate(`(() => { const f = [...document.querySelectorAll('.location-input')].find(x => x.value === 'Vitrine');
      f.value = 'Keller'; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await until(`document.querySelectorAll('#toasts .toast.error').length > 0`, 'Fehler-Toast');
    await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await settle();
    assert.deepEqual(
      await b.evaluate(`[...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent)`),
      [],
    );
  });
});
