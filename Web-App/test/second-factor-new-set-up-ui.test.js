/**
 * Second factor in the profile, in jsdom. An admin must have one: for him „Abschalten“ means
 * „Neu einrichten“, a dialog asks for password and code together, and the setup begins right away
 * in the required field — without a second password question, with „Schlüssel kopieren“ and an otpauth:// link for the
 * phone. An ordinary account switches off as the text says, without a setup afterwards.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  `withCode: true` deleted in disableSecondFactor() → red: both tests (code field hidden)
 *   B  in disableSecondFactor() `begonnen = null` instead of the setup → red: “admin” (no key in the
 *      required field)
 *   C  the otpauth link never made visible → red: “admin” (link hidden)
 *   D  button always „Abschalten“ → red: “admin” ('Abschalten' instead of 'Neu einrichten')
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, view, waitFor, SIGNED_IN } = require('./helpers/ui');

const OTPAUTH = 'otpauth://totp/BrickInventory:anna?secret=JBSWY3DPEHPK3PXP&issuer=BrickInventory';

function openIt(admin, copied) {
  return openUi(
    {
      '/v2/auth/me': {
        ...SIGNED_IN['/v2/auth/me'],
        user: { ...SIGNED_IN['/v2/auth/me'].user, is_admin: admin },
      },
      '/v2/auth/profile': {
        success: true,
        user: { username: 'anna', email: 'anna@example.org', email_verified: true },
      },
      '/v2/auth/second-factor': { success: true, active: true, codes_left: 5 },
      '/v2/auth/second-factor/disable': { success: true },
      '/v2/auth/second-factor/setup': { success: true, secret: 'JBSWY3DPEHPK3PXP', otpauth: OTPAUTH },
    },
    {
      before: w => Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => copied.push(t) } }),
    },
  );
}

const dialog = d => ({
  open: d.getElementById('confirm-modal').style.display === 'flex',
  title: d.getElementById('cd-title').textContent,
  text: d.getElementById('cd-msg').textContent,
  pw: !d.getElementById('cd-pw-wrap').hidden,
  code: !d.getElementById('cd-code-wrap').hidden,
});

test('administrator: set up again in one dialog, then key and link', async () => {
  const copied = [];
  const { w, d, calls } = await openIt(true, copied);
  try {
    await view(w, 'profile');
    await waitFor(() => d.querySelector('#sf-surface [data-click="disableSecondFactor"]'));
    const button = d.querySelector('#sf-surface [data-click="disableSecondFactor"]');
    assert.equal(button.textContent.trim(), 'Neu einrichten');
    button.click();
    await waitFor(() => dialog(d).open);
    const f = dialog(d);
    assert.deepEqual([f.title, f.pw, f.code], ['Neu einrichten', true, true], JSON.stringify(f));
    assert.match(f.text, /Administrator.*neuen ein/);
    d.getElementById('cd-pw').value = 'geheim-Passwort-1';
    d.getElementById('cd-code').value = '123456';
    d.getElementById('cd-confirm').click();
    await waitFor(() => calls.some(a => a.url.endsWith('/second-factor/setup')));
    const ab = calls.find(a => a.url.endsWith('/second-factor/disable'));
    assert.deepEqual(JSON.parse(ab.body), { password: 'geheim-Passwort-1', code: '123456' });
    const on = calls.find(a => a.url.endsWith('/second-factor/setup'));
    assert.deepEqual(JSON.parse(on.body), { password: 'geheim-Passwort-1' });
    assert.ok(await waitFor(() => d.querySelector('#sf-required-surface #sf-key')), 'no key in the mandatory field');
    assert.equal(d.getElementById('panel-second-factor-required').style.display, 'block', 'mandatory field not open');
    assert.equal(d.getElementById('sf-start'), null, '„Einrichten“ once more');
    assert.equal(dialog(d).open, false, 'second password prompt');
    const link = d.getElementById('sf-otpauth');
    assert.equal(link.hidden, false, 'Link verborgen');
    assert.equal(link.getAttribute('href'), OTPAUTH);
    d.querySelector('[data-click="copySecondFactorKey"]').click();
    assert.ok(await waitFor(() => copied.length === 1));
    assert.equal(copied[0], 'JBSWY3DPEHPK3PXP');
  } finally {
    w.close();
  }
});

test('account without admin rights: switching off as announced, without setup', async () => {
  const { w, d, calls } = await openIt(false, []);
  try {
    await view(w, 'profile');
    await waitFor(() => d.querySelector('#sf-surface [data-click="disableSecondFactor"]'));
    d.querySelector('#sf-surface [data-click="disableSecondFactor"]').click();
    await waitFor(() => dialog(d).open);
    const f = dialog(d);
    assert.deepEqual([f.title, f.pw, f.code], ['Abschalten', true, true], JSON.stringify(f));
    assert.match(f.text, /Passwort allein/);
    d.getElementById('cd-pw').value = 'geheim-Passwort-1';
    d.getElementById('cd-confirm').click();
    await waitFor(() => calls.some(a => a.url.endsWith('/second-factor/disable')));
    await waitFor(() => !dialog(d).open);
    assert.equal(
      calls.some(a => a.url.endsWith('/second-factor/setup')),
      false,
      'setup without obligation',
    );
  } finally {
    w.close();
  }
});
