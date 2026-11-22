/**
 * Settings: uniform save buttons and named actions of the
 * user table — on the real bundle in jsdom after translating.
 *
 * Counter-checks (measured on 28.10.):
 *   A  btn-sav-bl again with data-ico="schluessel" → red: “save buttons”
 *   B  nutzerKnopf() without a <span> with the word → red: “actions of the user table”
 *   C  data-arg2 again ${u.is_admin} → red: “revoking admin rights”
 *   E  (29.10.) rb-key again type="text" → red: “key hidden, with a button
 *      to show it”; toggleSecret() without aria-pressed → red: the same
 *   F  (29.10.) id="settings-bl" removed → red: “jump bar to the sections”
 *   G  (29.10.) in settingsSection() preventDefault left out or the
 *      class settings-active not set → red: the same check
 *   D  admin_password not sent along in toggleAdmin → red: “revoking admin
 *      rights” (measured on 28.10. after merging)
 *   H  (01.11.) toggleActive sends is_active without inversion → red: “deactivating
 *      and activating …”
 *   J  (04.11.) nutzerAktionen() without the exception for the own account → red:
 *      “actions of the user table” (buttons against the own account)
 *   I  (01.11.) loadSmtpSettings() does not show the hint smtp-tls-legacy
 *      → red: “SMTP: hint at the old exception …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

// anna is the logged-in account: there are no buttons against oneself.
const NUTZER = {
  '/v1/auth/users': {
    success: true,
    users: [
      { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' },
      {
        id: 2,
        username: 'ben',
        is_admin: false,
        is_active: false,
        created_at: '2026-10-02T00:00:00Z',
        zweiter_faktor: true,
      },
      { id: 3, username: 'carla', is_admin: true, is_active: true, created_at: '2026-10-03T00:00:00Z' },
    ],
  },
};

test('save buttons look the same', async () => {
  const { w, d } = await openUi(NUTZER);
  try {
    await reiter(w, 'settings');
    const knoepfe = ['btn-sav-bl', 'btn-sav-rb', 'btn-sav-bs', 'btn-sav-smtp', 'btn-sav-prof']
      .map(id => d.getElementById(id))
      .concat([d.querySelector('[data-click="saveVoucher"]')]);
    assert.equal(knoepfe.filter(Boolean).length, 6, 'Nicht alle sechs Knöpfe gefunden');
    for (const k of knoepfe) {
      const name = k.id || k.dataset.click;
      assert.equal(k.textContent.trim(), 'Speichern', `${name}: „${k.textContent.trim()}“`);
      assert.equal(k.querySelector('use')?.getAttribute('href'), '#i-save', `${name}: anderes Symbol`);
      assert.ok(k.classList.contains('bp') && k.classList.contains('btn-save'), `${name}: andere Form`);
    }
  } finally {
    w.close();
  }
});

test('actions of the user table are named', async () => {
  const { w, d } = await openUi(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    assert.equal(
      d.querySelectorAll('#users-tbl tbody tr')[0].querySelectorAll('button').length,
      0,
      'keine Knöpfe gegen das eigene Konto',
    );
    const knoepfe = [...d.querySelectorAll('#users-tbl .user-actions button')];
    assert.equal(knoepfe.length, 7, '4 + 3 Knöpfe erwartet (ben hat einen zweiten Faktor; die Rolle steht am Chip)');
    for (const k of knoepfe) {
      const wort = k.querySelector('span')?.textContent.trim();
      assert.ok(wort, `Knopf ${k.dataset.click} ohne sichtbares Wort`);
      assert.ok(k.getAttribute('title'), `Knopf ${k.dataset.click} ohne Tooltip`);
      const zeile = k.closest('tr').querySelector('strong').textContent;
      assert.equal(k.getAttribute('aria-label'), `${wort}: ${zeile}`);
    }
  } finally {
    w.close();
  }
});

test('revoking admin rights sends is_admin:false', async () => {
  const { w, d, aufrufe } = await openUi(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="3"]').click();
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
    // Changing foreign accounts requires the own password (admin log).
    assert.equal(d.getElementById('cd-pw-wrap').hidden, false, 'Die Passwortabfrage fehlt');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/3/admin')));
    const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/3/admin'));
    assert.ok(put, 'Kein Aufruf zum Rollenwechsel');
    assert.deepEqual(JSON.parse(put.body), { is_admin: false, admin_password: 'mein-passwort' });
  } finally {
    w.close();
  }
});

test('deactivating and activating send is_active with the password', async () => {
  const { w, d, aufrufe } = await openUi(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    const ben = d.querySelectorAll('#users-tbl tbody tr')[1];
    assert.match(ben.textContent, /Deaktiviert/);
    for (const [id, soll] of [
      [3, false],
      [2, true],
    ]) {
      d.querySelector(`#users-tbl [data-click="toggleActive"][data-arg="${id}"]`).click();
      assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
      d.getElementById('cd-pw').value = 'mein-passwort';
      d.getElementById('cd-confirm').click();
      await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes(`/v1/auth/users/${id}/aktiv`)));
      await warte(() => d.getElementById('confirm-modal').style.display !== 'flex');
      const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes(`/v1/auth/users/${id}/aktiv`));
      assert.ok(put, `Kein Aufruf für Konto ${id}`);
      assert.deepEqual(JSON.parse(put.body), { is_active: soll, admin_password: 'mein-passwort' });
    }
  } finally {
    w.close();
  }
});

test('SMTP: hint at the old exception, fingerprint and PEM go along', async () => {
  const roh = {
    success: true,
    settings: {
      language: 'de',
      smtp_host: 'mail.example',
      smtp_user: 'u',
      smtp_insecure_tls: '1',
      smtp_tls_fingerprint: 'AB:CD',
    },
  };
  const { w, d, aufrufe } = await openUi({
    ...NUTZER,
    '/v1/settings/raw': roh,
    '/v1/settings': { success: true },
  });
  try {
    await reiter(w, 'settings');
    await warte(() => d.getElementById('smtp-host').value === 'mail.example');
    assert.notEqual(d.getElementById('smtp-tls-legacy').style.display, 'none', 'Der Hinweis fehlt');
    assert.equal(d.getElementById('smtp-tls-fp').value, 'AB:CD');
    d.getElementById('smtp-tls-ca').value = '-----BEGIN CERTIFICATE-----';
    d.getElementById('btn-sav-smtp').click();
    // The dialog clears the password field when opening: only enter it once it is open.
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Passwortdialog');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    const isPost = a => a.method === 'POST' && a.url.endsWith('/v1/settings');
    await warte(() => aufrufe.some(isPost));
    const post = aufrufe.find(isPost);
    assert.ok(post, 'Nicht gespeichert');
    const body = JSON.parse(post.body);
    assert.deepEqual(
      [body.smtp_tls_fingerprint, body.smtp_tls_ca, body.smtp_insecure_tls],
      ['AB:CD', '-----BEGIN CERTIFICATE-----', undefined],
    );
    // The hint only disappears after the response to saving; under load
    // that takes longer than a fixed beat.
    await warte(() => d.getElementById('smtp-tls-legacy').style.display === 'none');
    assert.equal(d.getElementById('smtp-tls-legacy').style.display, 'none');
  } finally {
    w.close();
  }
});

test('key hidden, with a button to show it', async () => {
  const { w, d } = await openUi(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.getElementById('rb-key').value === 'probe');
    for (const id of ['rb-key', 'bs-key', 'bl-cs', 'bl-ts', 'smtp-pass'])
      assert.equal(d.getElementById(id).type, 'password', `${id} steht im Klartext`);
    const knopf = d.querySelector('[data-click="toggleSecret"][data-arg="rb-key"]');
    assert.equal(knopf.getAttribute('aria-label'), 'Anzeigen');
    knopf.click();
    assert.equal(d.getElementById('rb-key').type, 'text');
    assert.equal(knopf.getAttribute('aria-pressed'), 'true');
    knopf.click();
    assert.equal(d.getElementById('rb-key').type, 'password');
    assert.equal(knopf.getAttribute('aria-pressed'), 'false');
  } finally {
    w.close();
  }
});

test('jump bar to the sections', async () => {
  const { w, d } = await openUi(NUTZER);
  try {
    await reiter(w, 'settings');
    const ziele = [...d.querySelectorAll('#tab-settings .settings-nav a')].map(a => a.getAttribute('href'));
    assert.ok(ziele.length >= 6, `nur ${ziele.length} Abschnitte`);
    const fehlt = ziele.filter(z => !d.querySelector(`#global-settings-grid > .ssec${z}`));
    assert.deepEqual(fehlt, [], 'Sprungziele ohne Abschnitt im Raster');
    // Subpages: exactly one active, the click switches it and does not jump.
    const aktiv = () => [...d.querySelectorAll('#global-settings-grid > .ssec.settings-active')].map(s => s.id);
    assert.equal(aktiv().length, 1);
    const link = d.querySelector('.settings-nav a[data-arg="usermgmt"]');
    const klick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(klick);
    assert.deepEqual(aktiv(), ['usermgmt']);
    assert.equal(link.getAttribute('aria-current'), 'page');
    assert.equal(klick.defaultPrevented, true, 'der Link soll nicht zum Anker springen');
    assert.equal(d.querySelectorAll('.settings-nav a[aria-current]').length, 1);
    // The card with the theme is no longer called „Einstellungen“ inside „Einstellungen“.
    assert.equal(d.querySelector('#settings-design .stit').textContent.trim(), 'Erscheinungsbild');
  } finally {
    w.close();
  }
});
