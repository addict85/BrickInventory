/**
 * Befunde der UI-Prüfung 13 im echten Browser: Die Haushaltseinladung nennt
 * das einladende Konto, der Code ist lesbar, Dialoge und Bestätigungsseite
 * sagen, was bestätigt wird, Toasts und schwebender Knopf verdecken nichts,
 * und Finanzen zeigen fehlende Preise ohne Alarm und die Kurve auch bei 200 %.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel bzw. dist neu gebaut):
 *   A  redeemHouseholdInvite wieder ohne Prüfroute (Titel „Einladung annehmen“)
 *      → rot: „Einladung nennt das Hauptkonto“
 *   B  createInvite wieder mit randomBytes(24).base64url → rot: „Einladungscode
 *      in Vierergruppen“ (Format) und „Einladung nennt das Hauptkonto“
 *      (kleingeschrieben ohne Striche eingegeben: abgelaufen)
 *   C  Profil wieder mit tRaw('konto.profil') ohne Erklärung → rot: „E-Mail-
 *      Änderung: Titel und neue Adresse“
 *   D  verwirfToasts wieder „alle mit Knopf bleiben“ → rot: „Toast der Ansicht
 *      schliesst beim Wechsel“
 *   E  Entf-Zweig in 11-actions.js entfernt → rot: „Lösch-Kreuz: Entf auf der Karte“
 *   F  preisZeile wieder mit Geschenk im Preiskasten → rot: „Geschenk als Plakette“
 *   G  jobIconSvg ohne imgDl und pdfJobs → rot: „Hintergrundarbeiten: jeder Dienst
 *      mit Symbol“
 *   H  priceStatusBadge ohne neutralen Zweig → rot: „Preis fehlt: grau, wenn er
 *      fast überall fehlt“ (6 rote Dreiecke)
 *   I  die Regeln .knopf-schwebend > span { display: none } entfernt → rot:
 *      „Schwebender Knopf: nur Symbol“ (05.11.2026 mit Warten auf den Zustand
 *      erneut gemessen: rot nach 5 s bei „beim Rollen nur das Symbol“)
 *   K  bezugsLinie ohne den Platz-Test oben → rot: „Unterkonto: Kaufpreis-
 *      Beschriftung im Diagramm“ (abgeschnitten oben)
 *   L  zeigeBestaetigungsziel nicht aufgerufen → rot: „Bestätigungsseite nennt
 *      Konto und Adresse“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt, haeltSet } = require('./helpers/bestand');
const { buildAndRequire } = require('./helpers/sources');
const { LAYOUT } = require('./helpers/layout-messung');

const klick = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const offen = `getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`;
const CODE = /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/;

test('UI-Prüfung 13: Haushalt, Dialoge, Finanzen', { timeout: 280_000 }, async (t) => {
  const NAME = `r13_${process.pid}`, KIND = `${NAME}_kind`, ANDERE = `r13x_${process.pid}`;
  const app = await starteApp(t, { name: NAME, bestand: musterHaushalt });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, db, port } = app;
  const haushalt = buildAndRequire()('src/haushalt/haushalt.js');
  await warte(800);
  await b.auswerten(klick('#einrichtung-modal.open [data-click="einrichtungSpaeter"]'));
  const geh = async (pfad) => { await b.auswerten(`location.hash = '#/${pfad}'; true`); await warte(300); };
  const zu = async () => { await b.auswerten(klick('#cd-cancel')); await bis(`!(${offen})`, 'Dialog zu'); };
  const andere = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true) RETURNING id`,
    [ANDERE, `${ANDERE}@example.org`])).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [andere]).catch(() => {}));

  await t.test('Einladungscode in Vierergruppen', async () => {
    await b.auswerten(klick('.umenu-item[data-arg="haushalt"]'));
    await bis(`document.getElementById('household-invite-box')?.checkVisibility()`, 'Haushalt');
    await b.auswerten(klick('[data-click="createHouseholdInvite"]'));
    await bis(`!!document.getElementById('household-invite-code').value`, 'Code erzeugt');
    assert.match(await b.auswerten(`document.getElementById('household-invite-code').value`), CODE);
  });

  await t.test('Einladung nennt das Hauptkonto', async () => {
    const { code } = await haushalt.createInvite(andere);
    assert.match(code, CODE);
    assert.match(await b.auswerten(text('#household-redeem-box')), /sieht und bearbeitet danach deine Sammlung; du kannst die Verknüpfung jederzeit lösen/);
    // Wie abgetippt: klein und ohne Striche.
    await b.auswerten(`document.getElementById('household-redeem-code').value = ${JSON.stringify(code.replace(/-/g, '').toLowerCase())};
      document.querySelector('[data-click="redeemHouseholdInvite"]').click(); true`);
    await bis(offen, 'Bestätigung');
    assert.equal(await b.auswerten(text('#cd-title')), `Einladung von „${ANDERE}“ annehmen?`);
    assert.match(await b.auswerten(text('#cd-msg')), new RegExp(`„${ANDERE}“ kann danach deine Sets, Teile und Minifiguren sehen und ändern`));
    await zu();
    // Ein falscher Code öffnet keinen Dialog, und ohne Anmeldung verrät die Route nichts.
    await b.auswerten(`document.getElementById('household-redeem-code').value = 'AAAA-BBBB-CCCC-DDDD';
      document.querySelector('[data-click="redeemHouseholdInvite"]').click(); true`);
    await bis(`[...document.querySelectorAll('#toasts .toast.error')].some(x => /abgelaufen|ungültig/i.test(x.textContent))`, 'Absage');
    assert.equal(await b.auswerten(offen), false);
    const fremd = await fetch(`http://127.0.0.1:${port}/api/v1/settings/household/redeem/pruefen`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(fremd.status, 401);
    assert.doesNotMatch(await fremd.text(), new RegExp(ANDERE));
  });

  await t.test('E-Mail-Änderung: Titel und neue Adresse', async () => {
    await b.auswerten(klick('.umenu-item[data-arg="profil"]'));
    await bis(`!!document.getElementById('prof-email').value`, 'Profil');
    await b.auswerten(`document.getElementById('prof-email').value = 'neu-${process.pid}@example.org'; document.getElementById('btn-sav-prof').click(); true`);
    await bis(offen, 'Passwortabfrage');
    assert.equal(await b.auswerten(text('#cd-title')), 'E-Mail-Adresse ändern?');
    assert.match(await b.auswerten(text('#cd-msg')), new RegExp(`Neue Adresse: neu-${process.pid}@example.org\\..*Passwort`));
    await zu();
  });

  await t.test('Toast der Ansicht schliesst beim Wechsel', async () => {
    await geh('sammlung/set/99999-9');
    await bis(`[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`, 'Toast');
    await b.auswerten(klick('.ntab[data-tab="parts"]'));
    await bis(`document.getElementById('tab-parts').classList.contains('active')`, 'Teile');
    assert.equal(await b.auswerten(`[...document.querySelectorAll('#toasts .toast')].filter(x => /nicht in deiner Sammlung/.test(x.textContent)).length`), 0);
  });

  await t.test('Lösch-Kreuz: Entf auf der Karte', async () => {
    await geh('sammlung');
    await bis(`!!document.querySelector('#gallery .sc')`, 'Sammlung');
    const z = await b.auswerten(`(() => { const k = document.querySelector('#gallery .sc'); k.focus();
      return { taste: k.getAttribute('aria-keyshortcuts'), kreuz: k.querySelector('.delbtn').getAttribute('aria-hidden') }; })()`);
    assert.deepEqual(z, { taste: 'Delete', kreuz: 'true' });
    for (const type of ['rawKeyDown', 'keyUp']) await b.tab('Input.dispatchKeyEvent', { type, key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await bis(offen, 'Löschdialog');
    assert.match(await b.auswerten(text('#cd-title')), /löschen/i);
    await zu();
  });

  await t.test('Geschenk als Plakette', async () => {
    const z = await b.auswerten(`(() => { const k = [...document.querySelectorAll('#gallery .sc')].find(x => x.textContent.includes('10300-1'));
      return { plakette: k.querySelector('.splaketten .geschenk-badge')?.textContent, preis: k.querySelector('.price-badge').textContent }; })()`);
    assert.equal(z.plakette, 'Geschenk');
    assert.doesNotMatch(z.preis, /Geschenk/);
  });

  await t.test('Hintergrundarbeiten: jeder Dienst mit Symbol', async () => {
    await b.auswerten(klick('.ntab[data-tab="monitor"]'));
    await bis(`document.querySelectorAll('.mon-dienste .mon-name').length >= 6`, 'Dienste');
    const ohne = await b.auswerten(`[...document.querySelectorAll('.mon-dienste .mon-name')].filter(n => !n.querySelector('svg.mon-sinnbild *')).map(n => n.textContent.trim())`);
    assert.deepEqual(ohne, []);
  });

  await t.test('Preis fehlt: grau, wenn er fast überall fehlt', async () => {
    const zeichen = async () => {
      await geh('sammlung'); await geh('finanzen');
      await bis(`!!document.querySelector('#fin-tbl [data-fin-art="sets"] tfoot')`, 'Finanzen', 300);
      return b.auswerten(`({ rot: document.querySelectorAll('#fin-tbl tbody .pst-err').length, grau: document.querySelectorAll('#fin-tbl [data-fin-art="sets"] tbody .pst-leer').length })`);
    };
    // Ohne Preis im Zwischenspeicher und ohne BrickLink-Zugang scheitert der Abruf.
    await haeltSet(db, app.uid, '60001-1', 1, { preis: 20, am: '2026-06-03T10:00:00Z' });
    assert.deepEqual(await zeichen(), { rot: 1, grau: 0 }, 'ein einzelner Fehlschlag bleibt rot');
    for (const nr of ['60002-1', '60003-1', '60004-1', '60005-1', '60006-1']) await haeltSet(db, app.uid, nr, 1, { preis: 20, am: '2026-06-03T10:00:00Z' });
    assert.deepEqual(await zeichen(), { rot: 0, grau: 6 }, 'fehlt er fast überall, ist es kein Alarm');
    await db.run(`DELETE FROM set_acquisitions WHERE user_id = $1 AND set_number LIKE '6000_-1'`, [app.uid]);
    await db.run(`DELETE FROM sets WHERE user_id = $1 AND set_number LIKE '6000_-1'`, [app.uid]);
  });

  // ── Telefon ───────────────────────────────────────────────────────────────
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await t.test('Unterkonto: Kaufpreis-Beschriftung im Diagramm', async () => {
    const kid = (await db.get('SELECT id FROM users WHERE username = $1', [KIND])).id;
    await geh('sammlung'); await geh('finanzen');
    await b.auswerten(`(() => { const s = document.getElementById('scope-finance'); s.value = '${kid}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await bis(`/Kaufpreis .*210[.,]00/.test(document.querySelector('#portfolio-chart .einstand-linie')?.textContent || '')`, 'Kaufpreislinie', 200);
    const funde = (await b.auswerten(LAYOUT(true))).filter(f => /Diagramm/.test(f));
    assert.deepEqual(funde, []);
    assert.doesNotMatch(await b.auswerten(text('#portfolio-chart .einstand-linie')), /gesamt|bewertete/, 'am Telefon kurz');
    await b.auswerten(`(() => { const s = document.getElementById('scope-finance'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  });

  await t.test('Schwebender Knopf: nur Symbol', async () => {
    const knopf = `(() => { const k = document.querySelector('#tab-gallery .knopf-schwebend');
      return { breit: Math.round(k.getBoundingClientRect().width), text: k.querySelector('span').checkVisibility(), name: k.getAttribute('aria-label') }; })()`;
    // Unter Last kommen Scroll-Ereignis und Neuberechnung spät: Gewartet wird auf
    // den Zustand (höchstens 5 s), geprüft danach — eine feste Pause kippte.
    const sobald = async (bedingung) => {
      for (let i = 0; i < 50 && !(await b.auswerten(`(() => { const z = ${knopf}; return ${bedingung}; })()`).catch(() => false)); i++) await warte(100);
    };
    await geh('sammlung');
    await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
    await b.auswerten(`scrollTo(0, 0); true`); await sobald('z.text');
    assert.equal((await b.auswerten(knopf)).text, true, 'oben mit Beschriftung');
    await b.auswerten(`scrollTo(0, 400); true`); await sobald('!z.text && z.breit === 56');
    assert.deepEqual(await b.auswerten(knopf), { breit: 56, text: false, name: 'Set hinzufügen' }, 'beim Rollen nur das Symbol');
    await b.auswerten(`scrollTo(0, 0); document.documentElement.style.fontSize = '200%'; true`); await sobald('!z.text && z.breit <= 120');
    try {
      const z = await b.auswerten(knopf);
      assert.equal(z.text, false, 'bei 200 % nur das Symbol');
      assert.ok(z.breit <= 120, `schmal: ${z.breit} px`);
    } finally {
      await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
    }
  });

  await t.test('Bestätigungsseite nennt Konto und Adresse', async () => {
    const roh = `r13-${process.pid}-link`;
    await db.run(`UPDATE users SET email_neu = $2, email_neu_token = encode(sha256($3::bytea), 'hex'),
      email_neu_bis = NOW() + INTERVAL '1 hour' WHERE id = $1`, [app.uid, `neu-${process.pid}@example.org`, roh]);
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/verify?token=${roh}` });
    await bis(`/neu-${process.pid}@example\\.org/.test(document.getElementById('verify-ziel')?.textContent || '')`, 'Ziel genannt');
    assert.match(await b.auswerten(text('#verify-ziel')), new RegExp(`Konto „${NAME}“`));
  });
});
