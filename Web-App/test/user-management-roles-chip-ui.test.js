/**
 * Account management: the role stands as a chip. On the administrator chip an
 * X revokes the rights after a confirmation, the default chip has no X, „+ Administrator“
 * appoints; against the own account (and thus the last administrator) there is
 * no button. On the real bundle in jsdom.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  in rolle() the X also for the own account (`self` ignored) → red:
 *      “own account: chip without X” and “a single administrator: no X”
 *   B  data-arg2 on the X again fixed '0' → red: “X on the administrator chip revokes
 *      after confirmation” (is_admin true instead of false)
 *   C  aria-label on the X again without the account name (users.role.admin) → red:
 *      “X on the administrator chip …” (name of the button)
 *   D  the appoint button left out in rolle() → red: “default chip without X,
 *      + administrator appoints” and “a single administrator: no X”
 *   E  the list no longer output in angekuendigt() → red: “X on the
 *      administrator chip …” (Angekündigt missing after the response)
 *   F  (26.11.2026) toggleAdmin sends `admin_password` again → red: “X on the
 *      administrator chip …” (the body; a login is enough, docs/SICHERHEIT.md)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const ANNA = { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' };
const BEN = { id: 2, username: 'ben', is_admin: false, is_active: true, created_at: '2026-10-02T00:00:00Z' };
const CARLA = { id: 3, username: 'carla', is_admin: true, is_active: true, created_at: '2026-10-03T00:00:00Z' };
const AB = '2026-11-17T10:00:00Z';

const row = (d, name) =>
  [...d.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === name);

async function confirm(d) {
  assert.ok(await waitFor(() => d.getElementById('confirm-modal').style.display === 'flex'), 'no dialog');
  assert.equal(d.querySelector('#confirm-modal input[type="password"]'), null, 'a password prompt');
  const title = d.getElementById('cd-title').textContent;
  d.getElementById('cd-confirm').click();
  return title;
}

test('X on the administrator chip revokes after confirmation', async () => {
  let announced = false;
  const { w, d, calls } = await openUi({
    '/v2/auth/users': () => ({
      success: true,
      users: [ANNA, BEN, { ...CARLA, announced: announced ? [{ type: 'revoke_role', effective_at: AB }] : [] }],
    }),
    '/v2/auth/users/3/admin': () => {
      announced = true;
      return { success: true, effective_at: AB };
    },
  });
  try {
    await switchTab(w, 'settings');
    await waitFor(() => row(d, 'carla'));
    const chip = row(d, 'carla').querySelector('.role-chip');
    assert.equal(chip?.textContent.trim(), 'Administrator', 'chip with the word');
    const x = chip.querySelector('button.chip-remove');
    assert.ok(x, 'X in the chip');
    assert.equal(x.getAttribute('aria-label'), 'Administratorrechte von carla entziehen');
    assert.equal(x.getAttribute('type'), 'button');
    assert.equal(
      row(d, 'carla').querySelector('[data-click="toggleAdmin"][data-arg2="0"]'),
      null,
      'no promoting on the administrator',
    );

    x.click();
    assert.equal(await confirm(d), '„carla“ die Administratorrolle entziehen?');
    assert.ok(await waitFor(() => calls.some(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/3/admin'))));
    const put = calls.find(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/3/admin'));
    assert.deepEqual(JSON.parse(put.body), { is_admin: false });
    // Against an administrator it only takes effect after 24 h; the list shows it.
    assert.ok(
      await waitFor(() => /Angekündigt: Administratorrechte entziehen ab/.test(row(d, 'carla')?.textContent || '')),
      '„Angekündigt“ is missing after the response',
    );
    assert.match(d.getElementById('toasts').textContent, /Die Änderung gilt ab/);
  } finally {
    w.close();
  }
});

test('default chip without X, + administrator appoints', async () => {
  const { w, d, calls } = await openUi({
    '/v2/auth/users': { success: true, users: [ANNA, BEN, CARLA] },
    '/v2/auth/users/2/admin': { success: true },
  });
  try {
    await switchTab(w, 'settings');
    await waitFor(() => row(d, 'ben'));
    const z = row(d, 'ben');
    assert.equal(z.querySelector('.rb.ru')?.textContent.trim(), 'Standard');
    assert.equal(z.querySelector('.chip-remove'), null, 'standard chip without X');
    const k = z.querySelector('button[data-click="toggleAdmin"][data-arg2="0"]');
    assert.ok(k, 'button for promoting');
    assert.equal(k.textContent.trim(), 'Administrator');
    assert.equal(k.querySelector('use')?.getAttribute('href'), '#i-plus');
    assert.equal(k.getAttribute('aria-label'), 'ben zum Administrator ernennen');

    k.click();
    assert.equal(await confirm(d), '„ben“ zum Administrator machen?');
    assert.ok(await waitFor(() => calls.some(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/2/admin'))));
    const put = calls.find(a => a.method === 'PUT' && a.url.includes('/v2/auth/users/2/admin'));
    assert.deepEqual(JSON.parse(put.body), { is_admin: true });
    assert.ok(await waitFor(() => /Rolle geändert/.test(d.getElementById('toasts').textContent)));
  } finally {
    w.close();
  }
});

test('own account: chip without X', async () => {
  const { w, d } = await openUi({ '/v2/auth/users': { success: true, users: [ANNA, BEN, CARLA] } });
  try {
    await switchTab(w, 'settings');
    await waitFor(() => row(d, 'anna'));
    const z = row(d, 'anna');
    assert.equal(z.querySelector('.role-chip')?.textContent.trim(), 'Administrator');
    assert.equal(z.querySelectorAll('button').length, 0, 'no button against the own account');
    assert.ok(row(d, 'carla').querySelector('.chip-remove'), 'test data: a foreign administrator has the X');
  } finally {
    w.close();
  }
});

test('a single administrator: no X', async () => {
  const { w, d } = await openUi({ '/v2/auth/users': { success: true, users: [ANNA, BEN] } });
  try {
    await switchTab(w, 'settings');
    await waitFor(() => row(d, 'ben'));
    assert.equal(d.querySelectorAll('#users-tbl .role-chip').length, 1, 'test data: an administrator chip');
    assert.equal(d.querySelectorAll('#users-tbl .chip-remove').length, 0, 'no X revokes the last administrator');
    assert.ok(row(d, 'ben').querySelector('[data-click="toggleAdmin"][data-arg2="0"]'), 'promoting stays possible');
  } finally {
    w.close();
  }
});
