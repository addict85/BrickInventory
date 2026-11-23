/**
 * The account menu leads to every view that has no tab; every entry
 * opens its area and loads what it shows. Real bundle in jsdom.
 *
 * Counter-checks (measured 10.11.2026, each on its own, bundle rebuilt):
 *   A  in index.html data-arg="gutscheine" → "gutschein" → red: “every
 *      menu entry opens …” and “every view without a tab …”
 *   B  the VIEWS entry `data` removed in navigation.js → red: “every
 *      menu entry opens …” (daten opens nothing)
 *   C  in sitzung.js the line that shows #ntab-settings for admins
 *      removed → red: “only an admin sees settings and background jobs …”
 *   D  on the account entry data-i18n moved from the <span> to the <button> → red:
 *      “every menu entry keeps its icon …”
 *   E  the onclick on btn-logout removed in sitzung.js → red: “logout …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, SIGNED_IN, view, tick } = require('./helpers/ui');

const ACCOUNT = admin => ({
  '/v2/auth/me': { success: true, loggedIn: true, user: { ...SIGNED_IN['/v2/auth/me'].user, is_admin: admin } },
});
// Every view gets an empty, contract-conforming response (checkResponse adds the required fields).
const VIEW_DATA = Object.fromEntries(
  [
    '/v2/vouchers',
    '/v2/alerts',
    '/v2/storage/locations',
    '/v2/storage',
    '/v2/trash',
    '/v2/settings/tokens',
    '/v2/settings/tls',
    '/v2/settings/household',
    '/v2/auth/profile',
    '/v2/auth/second-factor',
    '/v2/auth/passkeys',
  ].map(p => [p, { success: true }]),
);
const entries = d => [...d.querySelectorAll('.umenu-item[data-click="openView"]')];

test('every menu entry opens its area and loads it', async () => {
  const o = await openUi(VIEW_DATA);
  try {
    await o.settle();
    const names = entries(o.d).map(e => e.dataset.arg);
    assert.equal(names.length, 7, `${names.length} views in the menu instead of seven`);
    const error = [];
    for (const name of names) {
      const prior = o.calls.length;
      await view(o.w, name);
      await o.settle();
      const active = [...o.d.querySelectorAll('.tab.active')].map(t => t.id);
      if (active.join() !== `tab-${name}`) error.push(`${name}: aktiv ist ${active.join(', ') || 'nichts'}`);
      if (o.calls.length === prior) error.push(`${name}: lädt nichts`);
    }
    assert.deepEqual(error, []);
    assert.deepEqual(
      o.error.map(e => e.message),
      [],
      'a loader failed',
    );
  } finally {
    o.w.close();
  }
});

test('every view without a tab is reachable via the menu', async () => {
  const o = await openUi();
  try {
    const switchTab = new Set([...o.d.querySelectorAll('.ntab[data-tab]')].map(r => r.dataset.tab));
    const inMenu = new Set(entries(o.d).map(e => e.dataset.arg));
    const surfaces = [...o.d.querySelectorAll('.tab[id^="tab-"]')].map(t => t.id.slice(4));
    assert.ok(surfaces.length >= 14, `only ${surfaces.length} surfaces found`);
    assert.deepEqual(
      surfaces.filter(n => !switchTab.has(n) && !inMenu.has(n)),
      [],
      'Neither a tab nor the menu opens these surfaces',
    );
  } finally {
    o.w.close();
  }
});

test('only an admin sees settings and background jobs', async () => {
  for (const admin of [true, false]) {
    const o = await openUi(ACCOUNT(admin));
    try {
      await o.settle();
      const visible = el => el.style.display !== 'none';
      assert.equal(visible(o.d.getElementById('ntab-settings')), admin, `settings tab, admin=${admin}`);
      for (const el of o.d.querySelectorAll('.umenu-item.admin-only'))
        assert.equal(visible(el), admin, `${el.dataset.arg} in the menu, admin=${admin}`);
    } finally {
      o.w.close();
    }
  }
});

test('every menu entry keeps its icon, even after translating', async () => {
  const words = require('./helpers/sources').loadTranslations().en;
  const o = await openUi({}, { language: 'en' });
  try {
    await o.settle();
    const buttonList = [...o.d.querySelectorAll('#umenu-pop button')];
    assert.equal(buttonList.length, 10, `${buttonList.length} entries instead of ten`);
    const wrong = [];
    for (const k of buttonList) {
      const target = k.querySelector('svg.ico use')?.getAttribute('href');
      const text = k.querySelector('[data-i18n]');
      if (!target || !o.d.getElementById(target.slice(1)))
        wrong.push(`${k.textContent.trim()}: kein Symbol aus dem Sprite`);
      if (!text || text.textContent !== words[text.dataset.i18n])
        wrong.push(`${k.textContent.trim()}: nicht übersetzt`);
    }
    assert.deepEqual(wrong, []);
  } finally {
    o.w.close();
  }
});

test('logout stands once, in the drawer, and logs out', async () => {
  const o = await openUi({ '/v2/auth/logout': { success: true } });
  try {
    await o.settle();
    const button = o.d.querySelectorAll('#btn-logout');
    assert.equal(button.length, 1);
    assert.ok(o.d.getElementById('umenu-pop').contains(button[0]), '„Abmelden“ is not in the dropdown');
    assert.ok(
      button[0].previousElementSibling?.matches('hr.umenu-divider'),
      'the separator before „Abmelden“ is missing',
    );
    button[0].click();
    await tick(30);
    await o.settle();
    assert.ok(
      o.calls.some(a => a.method === 'POST' && a.url.endsWith('/v2/auth/logout')),
      'no logout call',
    );
    assert.equal(o.d.getElementById('login-screen').style.display, 'flex', 'the login form does not appear');
  } finally {
    o.w.close();
  }
});

test('the header bar keeps its deliberate height', () => {
  // The height belongs to the header bar, not .btn-sm: the class carries half the
  // UI; min-height 32 px is the compact button size.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.umenu\{[^}]*--header-height:\s*(max\()?\d+px/, '`.umenu` no longer sets a height.');
  assert.match(css, /\.umenu \.ubadge\{height:var\(--header-height\)\}/, 'The name button no longer takes the height.');
  assert.doesNotMatch(css, /\.btn-sm\{[^}]*(?<!min-)height:/, '`.btn-sm` has been given a fixed height.');
});
