/**
 * Einstellungen: einheitliche Speichern-Knöpfe und benannte Aktionen der
 * Benutzertabelle — am echten Bündel in jsdom nach dem Übersetzen.
 * Ausführlich: docs/begruendungen/test/einstellungen-oberflaeche.test.js.md#kopf
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  btn-sav-bl wieder mit data-ico="schluessel" → rot: „Speichern-Knöpfe“
 *   B  nutzerKnopf() ohne <span> mit dem Wort → rot: „Aktionen der Benutzertabelle“
 *   C  data-arg2 wieder ${u.is_admin} → rot: „Admin-Rechte entziehen“
 *   E  (29.10.) rb-key wieder type="text" → rot: „Schlüssel verdeckt, mit Knopf
 *      zum Anzeigen“; geheimUmschalten() ohne aria-pressed → rot: dieselbe
 *   F  (29.10.) id="einst-bl" entfernt → rot: „Sprungleiste zu den Abschnitten“
 *   G  (29.10.) in einstAbschnitt() preventDefault weggelassen bzw. die
 *      Klasse einst-aktiv nicht gesetzt → rot: dieselbe Prüfung
 *   D  in toggleAdmin admin_password nicht mitgeschickt → rot: „Admin-Rechte
 *      entziehen“ (am 28.10. nach dem Zusammenführen gemessen)
 *   H  (01.11.) toggleAktiv schickt is_active ohne Umkehr → rot: „Deaktivieren
 *      und Aktivieren …“
 *   J  (04.11.) nutzerAktionen() ohne die Ausnahme für das eigene Konto → rot:
 *      „Aktionen der Benutzertabelle“ (Knöpfe gegen das eigene Konto)
 *   I  (01.11.) loadSmtpSettings() blendet den Hinweis smtp-tls-altlast nicht
 *      ein → rot: „SMTP: Hinweis auf die alte Ausnahme …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

// anna ist das angemeldete Konto: Gegen sich selbst gibt es keine Knöpfe.
const NUTZER = { '/v1/auth/users': { success: true, users: [
  { id: 1, username: 'anna', is_admin: true, is_active: true, created_at: '2026-10-01T00:00:00Z' },
  { id: 2, username: 'ben', is_admin: false, is_active: false, created_at: '2026-10-02T00:00:00Z', zweiter_faktor: true },
  { id: 3, username: 'carla', is_admin: true, is_active: true, created_at: '2026-10-03T00:00:00Z' },
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
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    assert.equal(d.querySelectorAll('#users-tbl tbody tr')[0].querySelectorAll('button').length, 0, 'keine Knöpfe gegen das eigene Konto');
    const knoepfe = [...d.querySelectorAll('#users-tbl .nutzer-aktionen button')];
    assert.equal(knoepfe.length, 9, '5 + 4 Knöpfe erwartet (ben hat einen zweiten Faktor)');
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
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    d.querySelector('#users-tbl [data-click="toggleAdmin"][data-arg="3"]').click();
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
    // Fremde Konten ändern verlangt das eigene Passwort (Verwaltungsprotokoll).
    assert.equal(d.getElementById('cd-pw-wrap').hidden, false, 'Die Passwortabfrage fehlt');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/3/admin')));
    const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes('/v1/auth/users/3/admin'));
    assert.ok(put, 'Kein Aufruf zum Rollenwechsel');
    assert.deepEqual(JSON.parse(put.body), { is_admin: false, admin_password: 'mein-passwort' });
  } finally { w.close(); }
});

test('Deaktivieren und Aktivieren schicken is_active mit dem Passwort', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.querySelectorAll('#users-tbl tbody tr').length === 3);
    const ben = d.querySelectorAll('#users-tbl tbody tr')[1];
    assert.match(ben.textContent, /Deaktiviert/);
    for (const [id, soll] of [[3, false], [2, true]]) {
      d.querySelector(`#users-tbl [data-click="toggleAktiv"][data-arg="${id}"]`).click();
      assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Dialog');
      d.getElementById('cd-pw').value = 'mein-passwort';
      d.getElementById('cd-confirm').click();
      await warte(() => aufrufe.some(a => a.method === 'PUT' && a.url.includes(`/v1/auth/users/${id}/aktiv`)));
      await warte(() => d.getElementById('confirm-modal').style.display !== 'flex');
      const put = aufrufe.find(a => a.method === 'PUT' && a.url.includes(`/v1/auth/users/${id}/aktiv`));
      assert.ok(put, `Kein Aufruf für Konto ${id}`);
      assert.deepEqual(JSON.parse(put.body), { is_active: soll, admin_password: 'mein-passwort' });
    }
  } finally { w.close(); }
});

test('SMTP: Hinweis auf die alte Ausnahme, Fingerabdruck und PEM gehen mit', async () => {
  const roh = { success: true, settings: { language: 'de', smtp_host: 'mail.example', smtp_user: 'u',
    smtp_insecure_tls: '1', smtp_tls_fingerprint: 'AB:CD' } };
  const { w, d, aufrufe } = await oeffneOberflaeche({ ...NUTZER, '/v1/settings/raw': roh, '/v1/settings': { success: true } });
  try {
    await reiter(w, 'settings');
    await warte(() => d.getElementById('smtp-host').value === 'mail.example');
    assert.notEqual(d.getElementById('smtp-tls-altlast').style.display, 'none', 'Der Hinweis fehlt');
    assert.equal(d.getElementById('smtp-tls-fp').value, 'AB:CD');
    d.getElementById('smtp-tls-ca').value = '-----BEGIN CERTIFICATE-----';
    d.getElementById('btn-sav-smtp').click();
    // Der Dialog leert das Passwortfeld beim Öffnen: erst eintragen, wenn er offen ist.
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Kein Passwortdialog');
    d.getElementById('cd-pw').value = 'mein-passwort';
    d.getElementById('cd-confirm').click();
    const istPost = a => a.method === 'POST' && a.url.endsWith('/v1/settings');
    await warte(() => aufrufe.some(istPost));
    const post = aufrufe.find(istPost);
    assert.ok(post, 'Nicht gespeichert');
    const body = JSON.parse(post.body);
    assert.deepEqual([body.smtp_tls_fingerprint, body.smtp_tls_ca, body.smtp_insecure_tls],
      ['AB:CD', '-----BEGIN CERTIFICATE-----', undefined]);
    // Der Hinweis verschwindet erst nach der Antwort aufs Speichern; unter Last
    // dauert das länger als ein fester Takt.
    await warte(() => d.getElementById('smtp-tls-altlast').style.display === 'none');
    assert.equal(d.getElementById('smtp-tls-altlast').style.display, 'none');
  } finally { w.close(); }
});

test('Schlüssel verdeckt, mit Knopf zum Anzeigen', async () => {
  const { w, d } = await oeffneOberflaeche(NUTZER);
  try {
    await reiter(w, 'settings');
    await warte(() => d.getElementById('rb-key').value === 'probe');
    for (const id of ['rb-key', 'bs-key', 'bl-cs', 'bl-ts', 'smtp-pass'])
      assert.equal(d.getElementById(id).type, 'password', `${id} steht im Klartext`);
    const knopf = d.querySelector('[data-click="geheimUmschalten"][data-arg="rb-key"]');
    assert.equal(knopf.getAttribute('aria-label'), 'Anzeigen');
    knopf.click();
    assert.equal(d.getElementById('rb-key').type, 'text');
    assert.equal(knopf.getAttribute('aria-pressed'), 'true');
    knopf.click();
    assert.equal(d.getElementById('rb-key').type, 'password');
    assert.equal(knopf.getAttribute('aria-pressed'), 'false');
  } finally { w.close(); }
});

test('Sprungleiste zu den Abschnitten', async () => {
  const { w, d } = await oeffneOberflaeche(NUTZER);
  try {
    await reiter(w, 'settings');
    const ziele = [...d.querySelectorAll('#tab-settings .einst-nav a')].map(a => a.getAttribute('href'));
    assert.ok(ziele.length >= 6, `nur ${ziele.length} Abschnitte`);
    const fehlt = ziele.filter(z => !d.querySelector(`#global-settings-grid > .ssec${z}`));
    assert.deepEqual(fehlt, [], 'Sprungziele ohne Abschnitt im Raster');
    // Unterseiten: genau einer aktiv, der Klick wechselt ihn und springt nicht.
    const aktiv = () => [...d.querySelectorAll('#global-settings-grid > .ssec.einst-aktiv')].map(s => s.id);
    assert.equal(aktiv().length, 1);
    const link = d.querySelector('.einst-nav a[data-arg="usermgmt"]');
    const klick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(klick);
    assert.deepEqual(aktiv(), ['usermgmt']);
    assert.equal(link.getAttribute('aria-current'), 'page');
    assert.equal(klick.defaultPrevented, true, 'der Link soll nicht zum Anker springen');
    assert.equal(d.querySelectorAll('.einst-nav a[aria-current]').length, 1);
    // Die Karte mit dem Design heisst nicht mehr „Einstellungen“ in „Einstellungen“.
    assert.equal(d.querySelector('#einst-design .stit').textContent.trim(), 'Erscheinungsbild');
  } finally { w.close(); }
});
