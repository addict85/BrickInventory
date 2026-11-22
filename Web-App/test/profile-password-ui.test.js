/**
 * The profile only saves with the current password, even if only
 * the username changes. It is asked once when saving, in a dialog
 * instead of in its own field per section; a wrong password asks again.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  in btn-sav-prof directly api('PUT', …) without confirmWithPassword → red:
 *      all three cases (no dialog opens)
 *   B  in confirmWithPassword the repetition on current_password_wrong
 *      removed → red: “a wrong password asks again”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, sicht, warte } = require('./helpers/ui');

const PROFILE = {
  '/v2/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
};
const putCalls = aufrufe => aufrufe.filter(a => a.method === 'PUT' && a.url.endsWith('/v2/auth/profile'));
const openDialog = d => d.getElementById('confirm-modal').style.display === 'flex';

async function store(w, d) {
  await sicht(w, 'profile');
  await warte(() => d.getElementById('prof-user').value === 'anna');
  assert.equal(
    d.querySelectorAll('#tab-profile input[type="password"][autocomplete="current-password"]').length,
    0,
    'no „Aktuelles Passwort“ field on the page any more',
  );
  d.getElementById('prof-user').value = 'anna2';
  d.getElementById('btn-sav-prof').click();
  await warte(() => openDialog(d));
}

test('without a password no request goes out', async () => {
  const { w, d, aufrufe } = await openUi(PROFILE);
  try {
    await store(w, d);
    assert.deepEqual(putCalls(aufrufe), [], 'before the confirmation');
    d.getElementById('cd-cancel').click();
    await warte(() => !openDialog(d));
    assert.deepEqual(putCalls(aufrufe), [], 'after cancelling');
  } finally {
    w.close();
  }
});

test('with a password it goes along, even with a mere name change', async () => {
  const { w, d, aufrufe } = await openUi(PROFILE);
  try {
    await store(w, d);
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => putCalls(aufrufe).length);
    const rumpf = JSON.parse(putCalls(aufrufe)[0].body);
    assert.equal(rumpf.username, 'anna2');
    assert.equal(rumpf.password_current, 'Mein-Passwort-1');
    assert.equal(d.getElementById('cd-pw').value, '', 'the password does not stay in the field');
  } finally {
    w.close();
  }
});

test('a wrong password asks again', async () => {
  let n = 0;
  const { w, d, aufrufe } = await openUi({
    ...PROFILE,
    '/v2/auth/profile': (_url, o) =>
      o?.method === 'PUT' && ++n === 1
        ? { success: false, code: 'current_password_wrong', error: 'Aktuelles Passwort falsch' }
        : PROFILE['/v2/auth/profile'],
  });
  try {
    await store(w, d);
    d.getElementById('cd-pw').value = 'wrong';
    d.getElementById('cd-confirm').click();
    await warte(
      () => putCalls(aufrufe).length === 1 && openDialog(d) && /falsch/.test(d.getElementById('cd-msg').textContent),
    );
    d.getElementById('cd-pw').value = 'richtig';
    d.getElementById('cd-confirm').click();
    await warte(() => putCalls(aufrufe).length === 2);
    assert.equal(JSON.parse(putCalls(aufrufe)[1].body).password_current, 'richtig');
  } finally {
    w.close();
  }
});
