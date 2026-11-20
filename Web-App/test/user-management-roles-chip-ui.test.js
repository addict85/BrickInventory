/**
 * Kontenverwaltung: Die Rolle steht als Chip. Am Administrator-Chip entzieht ein
 * X nach der Rückfrage die Rechte, der Standard-Chip hat kein X, „+ Administrator“
 * ernennt; gegen das eigene Konto (und damit den letzten Administrator) gibt es
 * keinen Knopf. Am echten Bündel in jsdom.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in rolle() das X auch für das eigene Konto (`selbst` ignoriert) → rot:
 *      „eigenes Konto: Chip ohne X“ und „ein einziger Administrator: kein X“
 *   B  data-arg2 am X wieder fest '0' → rot: „X am Administrator-Chip entzieht
 *      nach der Rückfrage“ (is_admin true statt false)
 *   C  aria-label am X wieder ohne den Kontonamen (users.role.admin) → rot:
 *      „X am Administrator-Chip …“ (Name des Knopfs)
 *   D  in rolle() den Ernennen-Knopf weggelassen → rot: „Standard-Chip ohne X,
 *      + Administrator ernennt“ und „ein einziger Administrator: kein X“
 *   E  in angekuendigt() die Liste nicht mehr ausgegeben → rot: „X am
 *      Administrator-Chip …“ (Angekündigt fehlt nach der Antwort)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const ANNA = { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' };
const BEN = { id: 2, username: 'ben', is_admin: false, is_active: true, created_at: '2026-10-02T00:00:00Z' };
const CARLA = { id: 3, username: 'carla', is_admin: true, is_active: true, created_at: '2026-10-03T00:00:00Z' };
const AB = '2026-11-17T10:00:00Z';

const zeile = (d, name) =>
  [...d.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === name);

async function confirm(d) {
  assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
  assert.equal(d.getElementById('cd-pw-wrap').hidden, false, 'Die Passwortabfrage fehlt');
  const titel = d.getElementById('cd-title').textContent;
  d.getElementById('cd-pw').value = 'mein-passwort';
  d.getElementById('cd-confirm').click();
  return titel;
}

test('X on the administrator chip revokes after confirmation', async () => {
  let angekuendigt = false;
  const { w, d, aufrufe } = await openUi({
    '/v1/auth/users': () => ({
      success: true,
      users: [
        ANNA,
        BEN,
        { ...CARLA, angekuendigt: angekuendigt ? [{ type: 'rolle_entziehen', effective_at: AB }] : [] },
      ],
    }),
    '/v1/auth/users/3/admin': () => {
      angekuendigt = true;
      return { success: true, effective_at: AB };
    },
  });
  try {
    await reiter(w, 'settings');
    await warte(() => zeile(d, 'carla'));
    const chip = zeile(d, 'carla').querySelector('.rolle-chip');
    assert.equal(chip?.textContent.trim(), 'Administrator', 'Chip mit dem Wort');
    const x = chip.querySelector('button.chip-weg');
    assert.ok(x, 'X im Chip');
    assert.equal(x.getAttribute('aria-label'), 'Administratorrechte von carla entziehen');
    assert.equal(x.getAttribute('type'), 'button');
    assert.equal(
      zeile(d, 'carla').querySelector('[data-click="toggleAdmin"][data-arg2="0"]'),
      null,
      'kein Ernennen am Administrator',
    );

    x.click();
    assert.equal(await confirm(d), '„carla“ die Administratorrolle entziehen?');
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/3/admin'))));
    const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/3/admin'));
    assert.deepEqual(JSON.parse(put.body), { is_admin: false, admin_password: 'mein-passwort' });
    // Gegen einen Administrator wirkt es erst nach 24 h; die Liste zeigt es an.
    assert.ok(
      await warte(() => /Angekündigt: Administratorrechte entziehen ab/.test(zeile(d, 'carla')?.textContent || '')),
      'Angekündigt fehlt nach der Antwort',
    );
    assert.match(d.getElementById('toasts').textContent, /Die Änderung gilt ab/);
  } finally {
    w.close();
  }
});

test('default chip without X, + administrator appoints', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v1/auth/users': { success: true, users: [ANNA, BEN, CARLA] },
    '/v1/auth/users/2/admin': { success: true },
  });
  try {
    await reiter(w, 'settings');
    await warte(() => zeile(d, 'ben'));
    const z = zeile(d, 'ben');
    assert.equal(z.querySelector('.rb.ru')?.textContent.trim(), 'Standard');
    assert.equal(z.querySelector('.chip-weg'), null, 'Standard-Chip ohne X');
    const k = z.querySelector('button[data-click="toggleAdmin"][data-arg2="0"]');
    assert.ok(k, 'Knopf zum Ernennen');
    assert.equal(k.textContent.trim(), 'Administrator');
    assert.equal(k.querySelector('use')?.getAttribute('href'), '#i-plus');
    assert.equal(k.getAttribute('aria-label'), 'ben zum Administrator ernennen');

    k.click();
    assert.equal(await confirm(d), '„ben“ zum Administrator machen?');
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/2/admin'))));
    const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/2/admin'));
    assert.deepEqual(JSON.parse(put.body), { is_admin: true, admin_password: 'mein-passwort' });
    assert.ok(await warte(() => /Rolle geändert/.test(d.getElementById('toasts').textContent)));
  } finally {
    w.close();
  }
});

test('own account: chip without X', async () => {
  const { w, d } = await openUi({ '/v1/auth/users': { success: true, users: [ANNA, BEN, CARLA] } });
  try {
    await reiter(w, 'settings');
    await warte(() => zeile(d, 'anna'));
    const z = zeile(d, 'anna');
    assert.equal(z.querySelector('.rolle-chip')?.textContent.trim(), 'Administrator');
    assert.equal(z.querySelectorAll('button').length, 0, 'kein Knopf gegen das eigene Konto');
    assert.ok(zeile(d, 'carla').querySelector('.chip-weg'), 'Testdaten: ein fremder Administrator hat das X');
  } finally {
    w.close();
  }
});

test('a single administrator: no X', async () => {
  const { w, d } = await openUi({ '/v1/auth/users': { success: true, users: [ANNA, BEN] } });
  try {
    await reiter(w, 'settings');
    await warte(() => zeile(d, 'ben'));
    assert.equal(d.querySelectorAll('#users-tbl .rolle-chip').length, 1, 'Testdaten: ein Administrator-Chip');
    assert.equal(d.querySelectorAll('#users-tbl .chip-weg').length, 0, 'den letzten Administrator entzieht kein X');
    assert.ok(zeile(d, 'ben').querySelector('[data-click="toggleAdmin"][data-arg2="0"]'), 'ernennen bleibt möglich');
  } finally {
    w.close();
  }
});
