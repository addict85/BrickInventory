/**
 * A normal account that calls an administrator page or an unknown path
 * sees the collection — and the address says the same (#/sammlung),
 * plus a hint why. A skip link (#content) stays silent.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in the popstate branch the return value of applyOn() ignored (no
 *      replaceState to adresse()) → red: “administrator page: address and hint”
 *      (address stayed #/einstellungen, no hint)
 *   B  isAppPath() always returns false → red: “unknown path: hint”
 *   C  isAppPath() always returns true → red: “skip link stays silent”
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('admin pages and unknown paths for normal accounts', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `nutzer_${process.pid}`,
    holding: async (db, uid) => {
      await db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]);
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, settle } = app;
  await settle();
  const toasts = () => b.evaluate(`[...document.querySelectorAll('#toasts .toast')].map(x => x.textContent)`);
  const clear = () => b.evaluate(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);

  await t.test('admin page: address and hint', async () => {
    await clear();
    await b.evaluate(`location.hash = '#/einstellungen'; true`);
    await settle();
    const z =
      await b.evaluate(`({ hash: location.hash, sammlung: document.getElementById('tab-gallery')?.classList.contains('active'),
      settings: document.getElementById('tab-settings')?.classList.contains('active') })`);
    assert.deepEqual(z, { hash: '#/sammlung', sammlung: true, settings: false });
    assert.ok(
      (await toasts()).some(x => /nur für Administratoren/.test(x)),
      JSON.stringify(await toasts()),
    );
  });

  await t.test('unknown path: hint', async () => {
    await clear();
    await b.evaluate(`location.hash = '#/gibt-es-nicht'; true`);
    await settle();
    assert.equal(await b.evaluate(`location.hash`), '#/sammlung');
    assert.ok(
      (await toasts()).some(x => /gibt es nicht/.test(x)),
      JSON.stringify(await toasts()),
    );
  });

  await t.test('skip link stays silent', async () => {
    await clear();
    await b.evaluate(`location.hash = '#content'; true`);
    await settle();
    assert.deepEqual(await toasts(), []);
  });
});
