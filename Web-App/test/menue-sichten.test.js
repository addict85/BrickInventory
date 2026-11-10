/**
 * Das Kontomenü führt zu jeder Sicht, die keinen Reiter hat; jeder Eintrag
 * öffnet seine Fläche und lädt, was sie zeigt. Echtes Bündel in jsdom.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in index.html data-arg="gutscheine" → "gutschein" → rot: „jeder
 *      Menüeintrag öffnet …“ und „jede Sicht ohne Reiter …“
 *   B  in 25-navigation.js den SICHTEN-Eintrag `daten` entfernt → rot: „jeder
 *      Menüeintrag öffnet …“ (daten öffnet nichts)
 *   C  in 26-sitzung.js die Zeile, die #ntab-settings für Verwalter einblendet,
 *      entfernt → rot: „Einstellungen und Hintergrundarbeiten …“
 *   D  am Konto-Eintrag data-i18n vom <span> an den <button> verschoben → rot:
 *      „jeder Menüeintrag behält sein Symbol …“
 *   E  in 26-sitzung.js den onclick an btn-logout entfernt → rot: „Abmelden …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, ANMELDUNG, sicht, takt } = require('./helpers/oberflaeche');

const KONTO = (admin) => ({ '/v1/auth/me': { success: true, loggedIn: true,
  user: { ...ANMELDUNG['/v1/auth/me'].user, is_admin: admin } } });
// Jede Sicht bekommt eine leere, vertragsgemässe Antwort (pruefeAntwort ergänzt die Pflichtfelder).
const SICHTDATEN = Object.fromEntries(['/v1/vouchers', '/v1/alerts', '/v1/storage/locations', '/v1/storage',
  '/v1/papierkorb', '/v1/settings/tokens', '/v1/settings/tls', '/v1/settings/household', '/v1/auth/profile',
  '/v1/auth/zweiter-faktor', '/v1/auth/passkeys'].map(p => [p, { success: true }]));
const eintraege = d => [...d.querySelectorAll('.umenu-item[data-click="oeffneSicht"]')];

test('jeder Menüeintrag öffnet seine Fläche und lädt sie', async () => {
  const o = await oeffneOberflaeche(SICHTDATEN);
  try {
    await o.ruhig();
    const namen = eintraege(o.d).map(e => e.dataset.arg);
    assert.equal(namen.length, 7, `${namen.length} Sichten im Menü statt sieben`);
    const fehler = [];
    for (const name of namen) {
      const vorher = o.aufrufe.length;
      await sicht(o.w, name);
      await o.ruhig();
      const aktiv = [...o.d.querySelectorAll('.tab.active')].map(t => t.id);
      if (aktiv.join() !== `tab-${name}`) fehler.push(`${name}: aktiv ist ${aktiv.join(', ') || 'nichts'}`);
      if (o.aufrufe.length === vorher) fehler.push(`${name}: lädt nichts`);
    }
    assert.deepEqual(fehler, []);
    assert.deepEqual(o.fehler.map(e => e.message), [], 'ein Lader ist gescheitert');
  } finally { o.w.close(); }
});

test('jede Sicht ohne Reiter ist über das Menü erreichbar', async () => {
  const o = await oeffneOberflaeche();
  try {
    const reiter = new Set([...o.d.querySelectorAll('.ntab[data-tab]')].map(r => r.dataset.tab));
    const imMenue = new Set(eintraege(o.d).map(e => e.dataset.arg));
    const flaechen = [...o.d.querySelectorAll('.tab[id^="tab-"]')].map(t => t.id.slice(4));
    assert.ok(flaechen.length >= 14, `nur ${flaechen.length} Flächen gefunden`);
    assert.deepEqual(flaechen.filter(n => !reiter.has(n) && !imMenue.has(n)), [],
      'Diese Flächen öffnet weder ein Reiter noch das Menü');
  } finally { o.w.close(); }
});

test('Einstellungen und Hintergrundarbeiten sieht nur ein Verwalter', async () => {
  for (const admin of [true, false]) {
    const o = await oeffneOberflaeche(KONTO(admin));
    try {
      await o.ruhig();
      const sichtbar = el => el.style.display !== 'none';
      assert.equal(sichtbar(o.d.getElementById('ntab-settings')), admin, `Reiter Einstellungen, Verwalter=${admin}`);
      for (const el of o.d.querySelectorAll('.umenu-item.admin-only'))
        assert.equal(sichtbar(el), admin, `${el.dataset.arg} im Menü, Verwalter=${admin}`);
    } finally { o.w.close(); }
  }
});

test('jeder Menüeintrag behält sein Symbol, auch nach dem Übersetzen', async () => {
  const woerter = require('./helpers/sources').loadTranslations().en;
  const o = await oeffneOberflaeche({}, { sprache: 'en' });
  try {
    await o.ruhig();
    const knoepfe = [...o.d.querySelectorAll('#umenu-pop button')];
    assert.equal(knoepfe.length, 10, `${knoepfe.length} Einträge statt zehn`);
    const falsch = [];
    for (const k of knoepfe) {
      const ziel = k.querySelector('svg.ico use')?.getAttribute('href');
      const text = k.querySelector('[data-i18n]');
      if (!ziel || !o.d.getElementById(ziel.slice(1))) falsch.push(`${k.textContent.trim()}: kein Symbol aus dem Sprite`);
      if (!text || text.textContent !== woerter[text.dataset.i18n]) falsch.push(`${k.textContent.trim()}: nicht übersetzt`);
    }
    assert.deepEqual(falsch, []);
  } finally { o.w.close(); }
});

test('Abmelden steht einmal, in der Klappe, und meldet ab', async () => {
  const o = await oeffneOberflaeche({ '/v1/auth/logout': { success: true } });
  try {
    await o.ruhig();
    const knopf = o.d.querySelectorAll('#btn-logout');
    assert.equal(knopf.length, 1);
    assert.ok(o.d.getElementById('umenu-pop').contains(knopf[0]), 'Abmelden steht nicht in der Klappe');
    assert.ok(knopf[0].previousElementSibling?.matches('hr.umenu-trenner'), 'vor Abmelden fehlt der Trenner');
    knopf[0].click();
    await takt(30);
    await o.ruhig();
    assert.ok(o.aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v1/auth/logout')), 'kein Abmeldeaufruf');
    assert.equal(o.d.getElementById('login-screen').style.display, 'flex', 'die Anmeldemaske erscheint nicht');
  } finally { o.w.close(); }
});

test('die Kopfleiste behält ihre bewusste Höhe', () => {
  // Die Höhe gehört der Kopfleiste, nicht .btn-sm: Die Klasse trägt die halbe
  // Oberfläche; min-height 32 px ist die kompakte Knopfgrösse.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.umenu\{[^}]*--kopf-hoehe:\s*(max\()?\d+px/, 'In `.umenu` steht keine Höhe mehr.');
  assert.match(css, /\.umenu \.ubadge\{height:var\(--kopf-hoehe\)\}/, 'Der Namensknopf nimmt die Höhe nicht mehr.');
  assert.doesNotMatch(css, /\.btn-sm\{[^}]*(?<!min-)height:/, '`.btn-sm` hat eine feste Höhe bekommen.');
});
