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
 *   D  (26.11.2026) toggleAdmin sends `admin_password` again → red: “revoking admin
 *      rights” (a login is enough, docs/SICHERHEIT.md)
 *   H  (01.11.) toggleActive sends is_active without inversion → red: “deactivating
 *      and activating …”
 *   J  (04.11.) nutzerAktionen() without the exception for the own account → red:
 *      “actions of the user table” (buttons against the own account)
 *   I  (01.11.) loadSmtpSettings() does not show the hint smtp-tls-legacy
 *      → red: “SMTP: hint at the old exception …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

// anna is the logged-in account: there are no buttons against oneself.
const USER = {
  '/v2/auth/users': {
    success: true,
    users: [
      { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' },
      {
        id: 2,
        username: 'ben',
        is_admin: false,
        is_active: false,
        created_at: '2026-10-02T00:00:00Z',
        second_factor: true,
      },
      { id: 3, username: 'carla', is_admin: true, is_active: true, created_at: '2026-10-03T00:00:00Z' },
    ],
  },
};

test('save buttons look the same', async () => {
  const { w, d } = await openUi(USER);
  try {
    await switchTab(w, 'settings');
    const buttonList = ['btn-sav-bl', 'btn-sav-rb', 'btn-sav-bs', 'btn-sav-smtp', 'btn-sav-prof']
      .map(id => d.getElementById(id))
      .concat([d.querySelector('[data-click="saveVoucher"]')]);
    assert.equal(buttonList.filter(Boolean).length, 6, 'Not all six buttons found');
    for (const k of buttonList) {
      const name = k.id || k.dataset.click;
      assert.equal(k.textContent.trim(), 'Speichern', `${name}: „${k.textContent.trim()}“`);
      assert.equal(k.querySelector('use')?.getAttribute('href'), '#i-save', `${name}: different icon`);
      assert.ok(k.classList.contains('bp') && k.classList.contains('btn-save'), `${name}: different shape`);
    }
  } finally {
    w.close();
  }
});

test('actions of the user table are named', async () => {
  const { w, d } = await openUi(USER);
  try {
    await switchTab(w, 'settings');
    await waitFor(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    assert.equal(
      d.querySelectorAll('#users-tbl tbody tr')[0].querySelectorAll('button').length,
      0,
      'no buttons against the own account',
    );
    const buttonList = [...d.querySelectorAll('#users-tbl .user-actions button')];
    assert.equal(buttonList.length, 7, '4 + 3 buttons expected (ben has a second factor; the role is on the chip)');
    for (const k of buttonList) {
      const wort = k.querySelector('span')?.textContent.trim();
      assert.ok(wort, `button ${k.dataset.click} without a visible word`);
      assert.ok(k.getAttribute('title'), `button ${k.dataset.click} without a tooltip`);
      const row = k.closest('tr').querySelector('strong').textContent;
      assert.equal(k.getAttribute('aria-label'), `${wort}: ${row}`);
    }
  } finally {
    w.close();
  }
});

test('revoking admin rights sends is_admin:false', async () => {
  const { w, d, calls } = await openUi(USER);
  try {
    await switchTab(w, 'settings');
    await waitFor(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="3"]').click();
    assert.ok(await waitFor(() => d.getElementById('confirm-modal').style.display === 'flex'), 'no dialog');
    assert.equal(d.querySelector('#confirm-modal input[type="password"]'), null, 'a password prompt');
    d.getElementById('cd-confirm').click();
    await waitFor(() => calls.some(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/3/admin')));
    const put = calls.find(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/3/admin'));
    assert.ok(put, 'No call for the role change');
    assert.deepEqual(JSON.parse(put.body), { is_admin: false });
  } finally {
    w.close();
  }
});

test('deactivating and activating send is_active', async () => {
  const { w, d, calls } = await openUi(USER);
  try {
    await switchTab(w, 'settings');
    await waitFor(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    const ben = d.querySelectorAll('#users-tbl tbody tr')[1];
    assert.match(ben.textContent, /Deaktiviert/);
    for (const [id, want] of [
      [3, false],
      [2, true],
    ]) {
      d.querySelector(`#users-tbl [data-click="toggleActive"][data-arg="${id}"]`).click();
      assert.ok(await waitFor(() => d.getElementById('confirm-modal').style.display === 'flex'), 'no dialog');
      d.getElementById('cd-confirm').click();
      await waitFor(() => calls.some(a => a.method === 'PUT' && a.url.includes(`/v2/auth/users/${id}/active`)));
      await waitFor(() => d.getElementById('confirm-modal').style.display !== 'flex');
      const put = calls.find(a => a.method === 'PUT' && a.url.includes(`/v2/auth/users/${id}/active`));
      assert.ok(put, `No call for account ${id}`);
      assert.deepEqual(JSON.parse(put.body), { is_active: want });
    }
  } finally {
    w.close();
  }
});

test('SMTP: hint at the old exception, fingerprint and PEM go along', async () => {
  const raw = {
    success: true,
    settings: {
      language: 'de',
      smtp_host: 'mail.example',
      smtp_user: 'u',
      smtp_insecure_tls: '1',
      smtp_tls_fingerprint: 'AB:CD',
    },
  };
  const { w, d, calls } = await openUi({
    ...USER,
    '/v2/settings/raw': raw,
    '/v2/settings': { success: true },
  });
  try {
    await switchTab(w, 'settings');
    await waitFor(() => d.getElementById('smtp-host').value === 'mail.example');
    assert.notEqual(d.getElementById('smtp-tls-legacy').style.display, 'none', 'The hint is missing');
    assert.equal(d.getElementById('smtp-tls-fp').value, 'AB:CD');
    d.getElementById('smtp-tls-ca').value = '-----BEGIN CERTIFICATE-----';
    d.getElementById('btn-sav-smtp').click();
    const isPost = a => a.method === 'POST' && a.url.endsWith('/v2/settings');
    await waitFor(() => calls.some(isPost));
    const post = calls.find(isPost);
    assert.ok(post, 'not saved');
    const body = JSON.parse(post.body);
    assert.deepEqual(
      [body.smtp_tls_fingerprint, body.smtp_tls_ca, body.smtp_insecure_tls],
      ['AB:CD', '-----BEGIN CERTIFICATE-----', undefined],
    );
    // The hint only disappears after the response to saving; under load
    // that takes longer than a fixed beat.
    await waitFor(() => d.getElementById('smtp-tls-legacy').style.display === 'none');
    assert.equal(d.getElementById('smtp-tls-legacy').style.display, 'none');
  } finally {
    w.close();
  }
});

test('key hidden, with a button to show it', async () => {
  const { w, d } = await openUi(USER);
  try {
    await switchTab(w, 'settings');
    await waitFor(() => d.getElementById('rb-key').value === 'probe');
    for (const id of ['rb-key', 'bs-key', 'bl-cs', 'bl-ts', 'smtp-pass'])
      assert.equal(d.getElementById(id).type, 'password', `${id} is in plain text`);
    const button = d.querySelector('[data-click="toggleSecret"][data-arg="rb-key"]');
    assert.equal(button.getAttribute('aria-label'), 'Anzeigen');
    button.click();
    assert.equal(d.getElementById('rb-key').type, 'text');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    button.click();
    assert.equal(d.getElementById('rb-key').type, 'password');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
  } finally {
    w.close();
  }
});

test('jump bar to the sections', async () => {
  const { w, d } = await openUi(USER);
  try {
    await switchTab(w, 'settings');
    const targets = [...d.querySelectorAll('#tab-settings .settings-nav a')].map(a => a.getAttribute('href'));
    assert.ok(targets.length >= 6, `nur ${targets.length} Abschnitte`);
    const missing = targets.filter(z => !d.querySelector(`#global-settings-grid > .ssec${z}`));
    assert.deepEqual(missing, [], 'jump targets without a section in the grid');
    // Subpages: exactly one active, the click switches it and does not jump.
    const active = () => [...d.querySelectorAll('#global-settings-grid > .ssec.settings-active')].map(s => s.id);
    assert.equal(active().length, 1);
    const link = d.querySelector('.settings-nav a[data-arg="usermgmt"]');
    const klick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(klick);
    assert.deepEqual(active(), ['usermgmt']);
    assert.equal(link.getAttribute('aria-current'), 'page');
    assert.equal(klick.defaultPrevented, true, 'the link should not jump to the anchor');
    assert.equal(d.querySelectorAll('.settings-nav a[aria-current]').length, 1);
    // The card with the theme is no longer called „Einstellungen“ inside „Einstellungen“.
    assert.equal(d.querySelector('#settings-design .stit').textContent.trim(), 'Erscheinungsbild');
  } finally {
    w.close();
  }
});
