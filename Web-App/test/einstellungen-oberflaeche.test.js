/**
 * Einstellungen: einheitliche Speichern-Knöpfe und benannte Aktionen der
 * Benutzertabelle — am echten Bündel in jsdom nach dem Übersetzen.
 *
 *   - Jeder Speichern-Knopf der Einstellungen heisst „Speichern“ und trägt
 *     das Speichern-Symbol (vorher: mal ohne Symbol, mal mit Schlüssel, einmal
 *     „SMTP speichern“).
 *   - Jede Aktion der Benutzertabelle hat ein sichtbares Wort, einen Tooltip
 *     und einen Namen mit dem Konto.
 *   - „Zum Benutzer“ bei einem Admin schickt is_admin:false. Vorher kam
 *     data-arg2="true" an, toggleAdmin() kannte nur '1' und machte jeden
 *     Admin erneut zum Admin.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  btn-sav-bl wieder mit data-ico="schluessel" → rot: „Speichern-Knöpfe“
 *   B  nutzerKnopf() ohne <span> mit dem Wort → rot: „Aktionen der Benutzertabelle“
 *   C  data-arg2 wieder ${u.is_admin} → rot: „Admin-Rechte entziehen“
 *   D  in toggleAdmin admin_password nicht mitgeschickt → rot: „Admin-Rechte
 *      entziehen“ (am 28.10. nach dem Zusammenführen gemessen)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const NUTZER = { '/v1/auth/users': { success: true, users: [
  { id: 1, username: 'anna', is_admin: true, created_at: '2026-10-01T00:00:00Z' },
  { id: 2, username: 'ben', is_admin: false, created_at: '2026-10-02T00:00:00Z', zweiter_faktor: true },
] } };

test('Speichern-Knöpfe sehen gleich aus', async () => {
  const { w, d } = await oeffneOberflaeche(NUTZER);
  try {
    await reiter(w, 'settings');
    const knoepfe = ['btn-save-theme', 'btn-sav-bl', 'btn-sav-rb', 'btn-sav-bs', 'btn-sav-smtp', 'btn-sav-prof']
      .map(id => d.getElementById(id)).concat([d.querySelector('[data-click="gutscheinSpeichern"]')]);
    assert.equal(knoepfe.filter(Boolean).length, 7, 'Nicht alle sieben Knöpfe gefunden');
    for (const k of knoepfe) {
      const name = k.id || k.dataset.click;
      assert.equal(k.textContent.trim(), 'Speichern', `${name}: „${k.textContent.trim()}“`);
      assert.equal(k.querySelector('use')?.getAttribute('href'), '#i-speichern', `${name}: anderes Symbol`);
      assert.ok(k.classList.contains('bp') && k.classList.contains('btn-speichern'), `${name}: andere Form`);
    }
  } finally { w.close(); }
});

test('Aktionen der Benutzertabelle sind benannt', async () => {
  const { w, d } = await oeffneOberflaeche(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 2);
    const knoepfe = [...d.querySelectorAll('#users-tbl .nutzer-aktionen button')];
    assert.equal(knoepfe.length, 7, '3 + 4 Knöpfe erwartet (ben hat einen zweiten Faktor)');
    for (const k of knoepfe) {
      const wort = k.querySelector('span')?.textContent.trim();
      assert.ok(wort, `Knopf ${k.dataset.click} ohne sichtbares Wort`);
      assert.ok(k.getAttribute('title'), `Knopf ${k.dataset.click} ohne Tooltip`);
      const zeile = k.closest('tr').querySelector('strong').textContent;
      assert.equal(k.getAttribute('aria-label'), `${wort}: ${zeile}`);
    }
  } finally { w.close(); }
});

test('Admin-Rechte entziehen schickt is_admin:false', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 2);
    d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="1"]').click();
    await takt(20);
    // Fremde Konten ändern verlangt das eigene Passwort (Verwaltungsprotokoll).
    assert.equal(d.getElementById('cd-pw-wrap').hidden, false, 'Die Passwortabfrage fehlt');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    await takt(20);
    const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/1/admin'));
    assert.ok(put, 'Kein Aufruf zum Rollenwechsel');
    assert.deepEqual(JSON.parse(put.body), { is_admin: false, admin_password: 'mein-passwort' });
  } finally { w.close(); }
});
