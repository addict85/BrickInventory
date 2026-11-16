/**
 * Rollen-Chip der Kontenverwaltung im echten Browser: Das X ist am Rechner
 * mindestens 24 px gross, am Telefon 44 px, zeigt den Tastaturfokus, öffnet die
 * Rückfrage mit dem Kontonamen, und bei 320 px (auch mit 200 % Schrift) ragt
 * nichts aus der Karte.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  .chip-weg ohne min-width/min-height → rot: „Rechner: X mindestens 24 px“
 *      (16 × 16)
 *   B  die Telefonregel .chip-weg { min-width: 44px … } entfernt → rot:
 *      „Telefon: X mindestens 44 px“ (24 × 24)
 *   C  .chip-weg:focus-visible{outline:none} → rot: „Rechner: sichtbarer Fokus“
 *   D  .rollen-zelle ohne flex-wrap und der Chip mit white-space:nowrap und
 *      min-width:20rem → rot: „320 px, 200 %: nichts ragt aus der Karte“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

test('Rollen-Chip: Tippfläche, Fokus, 320 px und 200 %', { timeout: 200_000 }, async t => {
  const ANDERE = `rc_admin_${process.pid}`;
  const app = await starteApp(t, { name: `rc_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db } = app;
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin) VALUES ($1, $2, 'x', true, true, true)`,
    [ANDERE, `${ANDERE}@example.org`],
  );
  t.after(() => db.run('DELETE FROM users WHERE username = $1', [ANDERE]).catch(() => {}));
  const X = `[...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(ANDERE)})?.querySelector('.rolle-chip .chip-weg')`;
  const metrik = (breite, telefon) =>
    b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: 800,
      deviceScaleFactor: 1,
      mobile: telefon,
    });
  // Neu laden über einen anderen Reiter: Die Liste steht dann in der Breite, die gerade gilt.
  const zurListe = async () => {
    await b.auswerten(`location.hash = '#/sammlung'; true`);
    await bis(`document.getElementById('tab-gallery').classList.contains('active')`, 'Sammlung');
    await b.auswerten(`location.hash = '#/einstellungen/benutzer'; true`);
    await bis(`!!(${X})`, 'X am fremden Administrator');
  };
  const mass = () =>
    b.auswerten(`(() => { const x = ${X}, r = x.getBoundingClientRect(), karte = x.closest('tr').getBoundingClientRect();
      const zelle = x.closest('.rollen-zelle').getBoundingClientRect();
      return { b: Math.round(r.width), h: Math.round(r.height), seite: document.documentElement.scrollWidth, fenster: innerWidth,
        ragt: zelle.right > karte.right + 0.5 || r.right > karte.right + 0.5 }; })()`);

  await t.test('Rechner: X mindestens 24 px, sichtbarer Fokus, Rückfrage nennt das Konto', async () => {
    await metrik(1280, false);
    await zurListe();
    const m = await mass();
    assert.ok(m.b >= 24 && m.h >= 24, `Rechner: X mindestens 24 px (${m.b} × ${m.h})`);
    // Tastatur zuletzt benutzt: Dann gilt :focus-visible auch für focus().
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft' });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' });
    const f = await b.auswerten(`(() => { const x = ${X}; x.focus(); const s = getComputedStyle(x);
      return { sichtbar: x.matches(':focus-visible'), stil: s.outlineStyle, breite: parseFloat(s.outlineWidth) }; })()`);
    assert.ok(f.sichtbar && f.stil !== 'none' && f.breite >= 2, `Rechner: sichtbarer Fokus ${JSON.stringify(f)}`);
    await b.auswerten(`${X}.click(); true`);
    await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Rückfrage');
    assert.equal(
      await b.auswerten(`document.getElementById('cd-title').textContent.trim()`),
      `„${ANDERE}“ die Administratorrolle entziehen?`,
    );
    await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
    await bis(`getComputedStyle(document.getElementById('confirm-modal')).display === 'none'`, 'Rückfrage zu');
  });

  await t.test('Telefon: X mindestens 44 px', async () => {
    await metrik(390, true);
    await zurListe();
    const m = await mass();
    assert.ok(m.b >= 44 && m.h >= 44, `Telefon: X mindestens 44 px (${m.b} × ${m.h})`);
  });

  await t.test('320 px, 200 %: nichts ragt aus der Karte', async () => {
    for (const schrift of ['', '200%']) {
      await b.auswerten(`document.documentElement.style.fontSize = '${schrift}'; true`);
      await metrik(320, true);
      await zurListe();
      const m = await mass();
      assert.ok(m.b >= 44 && m.h >= 44, `${schrift || '100 %'}: X ${m.b} × ${m.h}`);
      assert.equal(m.ragt, false, `${schrift || '100 %'}: der Chip ragt aus der Karte`);
      assert.ok(m.seite <= m.fenster, `${schrift || '100 %'}: Seite ${m.seite} px breiter als ${m.fenster} px`);
    }
    await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
  });
});
