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
const { openUi, ANMELDUNG, sicht, takt } = require('./helpers/ui');

const ACCOUNT = admin => ({
  '/v2/auth/me': { success: true, loggedIn: true, user: { ...ANMELDUNG['/v2/auth/me'].user, is_admin: admin } },
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
    await o.ruhig();
    const namen = entries(o.d).map(e => e.dataset.arg);
    assert.equal(namen.length, 7, `${namen.length} Sichten im Menü statt sieben`);
    const error = [];
    for (const name of namen) {
      const vorher = o.aufrufe.length;
      await sicht(o.w, name);
      await o.ruhig();
      const active = [...o.d.querySelectorAll('.tab.active')].map(t => t.id);
      if (active.join() !== `tab-${name}`) error.push(`${name}: aktiv ist ${active.join(', ') || 'nichts'}`);
      if (o.aufrufe.length === vorher) error.push(`${name}: lädt nichts`);
    }
    assert.deepEqual(error, []);
    assert.deepEqual(
      o.error.map(e => e.message),
      [],
      'ein Lader ist gescheitert',
    );
  } finally {
    o.w.close();
  }
});

test('every view without a tab is reachable via the menu', async () => {
  const o = await openUi();
  try {
    const reiter = new Set([...o.d.querySelectorAll('.ntab[data-tab]')].map(r => r.dataset.tab));
    const inMenu = new Set(entries(o.d).map(e => e.dataset.arg));
    const surfaces = [...o.d.querySelectorAll('.tab[id^="tab-"]')].map(t => t.id.slice(4));
    assert.ok(surfaces.length >= 14, `nur ${surfaces.length} Flächen gefunden`);
    assert.deepEqual(
      surfaces.filter(n => !reiter.has(n) && !inMenu.has(n)),
      [],
      'Diese Flächen öffnet weder ein Reiter noch das Menü',
    );
  } finally {
    o.w.close();
  }
});

test('only an admin sees settings and background jobs', async () => {
  for (const admin of [true, false]) {
    const o = await openUi(ACCOUNT(admin));
    try {
      await o.ruhig();
      const sichtbar = el => el.style.display !== 'none';
      assert.equal(sichtbar(o.d.getElementById('ntab-settings')), admin, `Reiter Einstellungen, Verwalter=${admin}`);
      for (const el of o.d.querySelectorAll('.umenu-item.admin-only'))
        assert.equal(sichtbar(el), admin, `${el.dataset.arg} im Menü, Verwalter=${admin}`);
    } finally {
      o.w.close();
    }
  }
});

test('every menu entry keeps its icon, even after translating', async () => {
  const words = require('./helpers/sources').loadTranslations().en;
  const o = await openUi({}, { language: 'en' });
  try {
    await o.ruhig();
    const buttonList = [...o.d.querySelectorAll('#umenu-pop button')];
    assert.equal(buttonList.length, 10, `${buttonList.length} Einträge statt zehn`);
    const falsch = [];
    for (const k of buttonList) {
      const ziel = k.querySelector('svg.ico use')?.getAttribute('href');
      const text = k.querySelector('[data-i18n]');
      if (!ziel || !o.d.getElementById(ziel.slice(1)))
        falsch.push(`${k.textContent.trim()}: kein Symbol aus dem Sprite`);
      if (!text || text.textContent !== words[text.dataset.i18n])
        falsch.push(`${k.textContent.trim()}: nicht übersetzt`);
    }
    assert.deepEqual(falsch, []);
  } finally {
    o.w.close();
  }
});

test('logout stands once, in the drawer, and logs out', async () => {
  const o = await openUi({ '/v2/auth/logout': { success: true } });
  try {
    await o.ruhig();
    const knopf = o.d.querySelectorAll('#btn-logout');
    assert.equal(knopf.length, 1);
    assert.ok(o.d.getElementById('umenu-pop').contains(knopf[0]), 'Abmelden steht nicht in der Klappe');
    assert.ok(knopf[0].previousElementSibling?.matches('hr.umenu-divider'), 'vor Abmelden fehlt der Trenner');
    knopf[0].click();
    await takt(30);
    await o.ruhig();
    assert.ok(
      o.aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v2/auth/logout')),
      'kein Abmeldeaufruf',
    );
    assert.equal(o.d.getElementById('login-screen').style.display, 'flex', 'die Anmeldemaske erscheint nicht');
  } finally {
    o.w.close();
  }
});

test('the header bar keeps its deliberate height', () => {
  // The height belongs to the header bar, not .btn-sm: the class carries half the
  // UI; min-height 32 px is the compact button size.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.umenu\{[^}]*--header-height:\s*(max\()?\d+px/, 'In `.umenu` steht keine Höhe mehr.');
  assert.match(css, /\.umenu \.ubadge\{height:var\(--header-height\)\}/, 'Der Namensknopf nimmt die Höhe nicht mehr.');
  assert.doesNotMatch(css, /\.btn-sm\{[^}]*(?<!min-)height:/, '`.btn-sm` hat eine feste Höhe bekommen.');
});
