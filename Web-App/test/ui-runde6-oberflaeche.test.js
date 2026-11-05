/**
 * Kleinere Befunde der UI-Prüfung vom 02.11.2026, am echten Bündel in jsdom
 * (mit styles.css, wo es um Sichtbarkeit geht):
 *   - Gutschein-Zeile: „kein PDF“ steht sichtbar da, Löschen ist ein Knopf
 *     wie seine Nachbarn mit Namen; ohne Gutscheine keine Summe, kein
 *     „alle abfragen“, kein Export.
 *   - Das Rebrickable-Band steht nur in Sammlung und Katalog.
 *   - Die QR-Fläche ist leer verborgen.
 *   - Ein normales Konto sieht im Reiter Einstellungen „Kein Zugriff“.
 *   - Das Design hat einen Satz zur Wahl; Noppe und Hochglanz unterscheiden sich.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  voucher-nopdf wieder nur „—“ mit .vh-Text → rot: „Gutscheine …“
 *   B  in ladeGutscheine() das Verbergen von [data-nur-mit-gutscheinen]
 *      entfernt → rot: „ohne Gutscheine …“
 *   C  Regel body:not(:has(…)) #rb-hinweis entfernt → rot: „Rebrickable-Band …“
 *   D  #qr-code:empty-Regel entfernt → rot: „QR-Fläche …“
 *   E  zeigeEinstellungsZugriff() nicht aufgerufen → rot: „Kein Zugriff …“
 *   F  Beschreibung weggelassen (nur Werkbank-Hinweis) → rot: „Design …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, reiter, sicht, warte, takt } = require('./helpers/oberflaeche');

const STIL = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const mitStil = (w) => w.document.addEventListener('DOMContentLoaded', () => {
  const s = w.document.createElement('style'); s.textContent = STIL; w.document.head.append(s); });
const zu = (w, e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === 'none') return true; return false; };

const GUTSCHEIN = { id: 3, number: '6123456789012', pin: '4711', amount: 50, currency: 'CHF', hat_pdf: false, guthaben_geprueft_am: null };

test('Gutscheine: Zeile und Aktionen', async () => {
  const o = await oeffneOberflaeche({ '/v1/vouchers': { success: true, vouchers: [GUTSCHEIN] } }, { vorher: mitStil });
  try {
    await sicht(o.w, 'gutscheine');
    await warte(() => o.d.querySelector('.voucher-row'));
    const zeile = o.d.querySelector('.voucher-row');
    assert.match(zeile.querySelector('.voucher-nopdf').textContent.trim(), /^kein PDF$/);
    const loeschen = zeile.querySelector('[data-click="gutscheinLoeschen"]');
    const bearbeiten = zeile.querySelector('[data-click="gutscheinBearbeiten"]');
    // Beide beschriftet (UI-Prüfung 6, M7), Löschen als Gefahr markiert.
    assert.equal(loeschen.className, bearbeiten.className + ' v-btn-gefahr');
    assert.deepEqual([bearbeiten.textContent.trim(), loeschen.textContent.trim()], ['Bearbeiten', 'Löschen']);
    for (const e of o.d.querySelectorAll('[data-nur-mit-gutscheinen]')) assert.equal(zu(o.w, e), false);
  } finally { o.w.close(); }
});

test('ohne Gutscheine: keine Summe, kein „alle abfragen“, kein Export', async () => {
  const o = await oeffneOberflaeche({ '/v1/vouchers': { success: true, vouchers: [] } }, { vorher: mitStil });
  try {
    await sicht(o.w, 'gutscheine');
    await warte(() => o.d.querySelector('.voucher-leer'));
    const teile = [...o.d.querySelectorAll('[data-nur-mit-gutscheinen]')];
    assert.equal(teile.length, 3);
    assert.deepEqual(teile.map(e => zu(o.w, e)), [true, true, true]);
    assert.equal(zu(o.w, o.d.querySelector('[data-click="gutscheineExportieren"]')), true);
  } finally { o.w.close(); }
});

test('Rebrickable-Band nur in Sammlung und Katalog', async () => {
  const o = await oeffneOberflaeche({ '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } } },
    { vorher: mitStil });
  try {
    const band = o.d.getElementById('rb-hinweis');
    await warte(() => !band.hidden, 2000);
    assert.equal(zu(o.w, band), false, 'Sammlung');
    for (const [tab, versteckt] of [['finance', true], ['wanted', true], ['catalog', false], ['parts', false]]) {
      await reiter(o.w, tab);
      assert.equal(zu(o.w, band), versteckt, tab);
    }
  } finally { o.w.close(); }
});

test('QR-Fläche erst mit Code', async () => {
  const o = await oeffneOberflaeche({}, { vorher: mitStil });
  try {
    const f = o.d.getElementById('qr-code');
    assert.equal(o.w.getComputedStyle(f).display, 'none');
    f.innerHTML = '<canvas></canvas>';
    assert.notEqual(o.w.getComputedStyle(f).display, 'none');
  } finally { o.w.close(); }
});

test('Kein Zugriff für ein normales Konto, Verwalter sieht nichts davon', async () => {
  const normal = await oeffneOberflaeche({ '/v1/auth/me': { loggedIn: true, user: { id: 2, username: 'bert', is_admin: false } } });
  try {
    normal.d.querySelector('.ntab[data-tab="settings"]').click();
    await takt(50);
    const f = normal.d.getElementById('einst-kein-zugriff');
    assert.equal(f.hidden, false);
    assert.match(f.textContent, /Kein Zugriff/);
  } finally { normal.w.close(); }
  const chef = await oeffneOberflaeche({});
  try {
    chef.d.querySelector('.ntab[data-tab="settings"]').click();
    await takt(50);
    assert.equal(chef.d.getElementById('einst-kein-zugriff').hidden, true);
  } finally { chef.w.close(); }
});

test('Design: ein Satz zur Wahl, Noppe und Hochglanz verschieden', async () => {
  const texte = {};
  for (const design of ['noppe', 'hochglanz', 'werkbank']) {
    const o = await oeffneOberflaeche({ '/v1/settings/theme': { success: true, vorgabe: 'classic', eigenes: design, theme: design },
      '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } } });
    try {
      await sicht(o.w, 'profil');
      await warte(() => o.d.getElementById('design-hinweis').textContent);
      texte[design] = o.d.getElementById('design-hinweis').textContent;
    } finally { o.w.close(); }
  }
  assert.match(texte.noppe, /verspielt/);
  assert.match(texte.hochglanz, /glatte Flächen/);
  assert.match(texte.werkbank, /Messing/);
});
