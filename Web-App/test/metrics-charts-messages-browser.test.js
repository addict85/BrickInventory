/**
 * Findings of UI check 10 in the real browser: numbers that do not
 * contradict each other, charts that grow with the font, messages that say
 * what is going on, and controls that do not aim at the own account.
 *
 * Counter-checks (measured 04.11.2026, each on its own, bundle rebuilt):
 *   A  in showMetrics the title again fixed „Kaufpreis gesamt“ and the
 *      subline „Summe der Kaufpreise“ → red: “purchase price card names its reference”
 *   B  the footer of the parts again with parts.stat.types → red: “parts
 *      footer names entries”
 *   C  .chart-value again with max-height:180px, chartWidth again divides
 *      by the font size and fontFactor delivers 1 (the old state) →
 *      red: “chart grows with the font”
 *   D  in openModal again only toast('Fehler') → red: “unknown set”
 *   E  nutzerAktionen without the exception for the own account → red:
 *      “no actions against the own account”
 *   F  in the set dialog the classes v-more nach-top removed → red: “more
 *      actions overlay the content” (the list stands in the footer)
 *   G  in zeigeDesignWahl the locking of the appearance removed → red:
 *      “werkbank locks the appearance”
 *   H  the value line again fixed var(--chart-new) → red: “value line in the
 *      accent color”
 *   I  in doLogin again ['lp','lu'] → red: “empty login: focus into the first field”
 *   J  (12.11.2026, UX check 19 N4) finance.stat.purchase_of again „von
 *      {betrag} Kaufpreis gesamt“ → red: “purchase price card names its reference”
 *      (the reference is not explained)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, warte } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

test('metrics, charts, messages', { timeout: 280_000 }, async t => {
  const app = await startApp(t, { name: `r11_${process.pid}`, holding: patternCollection, allDesigns: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, db } = app;
  const geh = async path => {
    await b.auswerten(`location.hash = '#/${path}'; true`);
    await warte(300);
  };

  await t.test('purchase price card names its reference', async () => {
    await geh('finanzen');
    await bis(`!!document.querySelector('#fin-tbl .dt-sum tfoot')`, 'Finanzen geladen', 200);
    const z = await b.auswerten(`({ titel: document.getElementById('fin-cost-basis-title').textContent.trim(),
      unter: document.getElementById('fin-cost-basis-sub').textContent,
      gesamt: document.querySelector('#fin-tbl .dt-sum tfoot td.fin-footer-value').textContent.trim(),
      basis: document.getElementById('fin-basis').hidden })`);
    assert.equal(z.basis, false, 'Testdaten: Positionen ohne Marktpreis');
    // Named briefly since UX check 25 (B2); what „bewertet“ means stands in the tooltip and below the cards.
    assert.equal(z.titel, 'Kaufpreis (bewertete Positionen)', 'Kaufpreis-Karte nennt ihren Bezug, nicht „gesamt“');
    assert.match(z.unter, /^Insgesamt bezahlt: /, 'die Summe aller Käufe ist benannt (UX-Prüfung 19 N4)');
    assert.ok(z.unter.includes(z.gesamt), `die Summe aller Kaufpreise steht darunter: ${z.unter} / ${z.gesamt}`);
  });

  await t.test('value line in the accent color', async () => {
    await bis(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm', 200);
    const farbe = await b.auswerten(`(() => { const h = document.documentElement, alt = h.getAttribute('data-theme');
      h.setAttribute('data-theme', 'werkbank'); const f = getComputedStyle(document.querySelector('#portfolio-chart svg polyline')).stroke;
      if (alt === null) h.removeAttribute('data-theme'); else h.setAttribute('data-theme', alt); return f; })()`);
    assert.equal(farbe, 'rgb(201, 150, 63)', 'Wertlinie in der Akzentfarbe (Messing bei Werkbank)');
  });

  await t.test('chart grows with the font', async () => {
    // The scale of what is drawn (getScreenCTM), not the frame: with
    // max-height a shrunk image stands centered in a wide frame.
    const mass = `(() => { const svg = document.querySelector('#portfolio-chart svg');
      const k = svg.getScreenCTM().a;
      return { breite: svg.viewBox.baseVal.width * k, container: document.getElementById('portfolio-chart').clientWidth,
        schrift: Math.min(...[...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * k)) }; })()`;
    const vorher = await b.auswerten(mass);
    // The old image gone, so that what is newly drawn at 200 % is measured.
    await b.auswerten(
      `document.documentElement.style.fontSize = '200%'; document.getElementById('portfolio-chart').innerHTML = ''; true`,
    );
    await geh('sammlung');
    await geh('finanzen');
    await bis(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm bei 200 %', 200);
    const nachher = await b.auswerten(mass);
    await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
    assert.ok(
      nachher.breite >= nachher.container * 0.95,
      `Diagramm wächst mit der Schrift: ${JSON.stringify(nachher)}`,
    );
    assert.ok(
      nachher.schrift >= vorher.schrift * 1.8,
      `Diagramm wächst mit der Schrift: ${vorher.schrift} → ${nachher.schrift}`,
    );
  });

  await t.test('parts footer names entries', async () => {
    await geh('teile');
    await bis(`/\\d/.test(document.getElementById('parts-sentinel')?.textContent || '')`, 'Teileliste', 200);
    const fuss = await b.auswerten(`document.getElementById('parts-sentinel').textContent`);
    assert.match(fuss, /Einträge aus Sets \(Teil × Farbe\)/);
    assert.doesNotMatch(fuss, /Teilesorten/);
  });

  await t.test('unknown set: plain text instead of "error"', async () => {
    await geh('sammlung');
    await b.auswerten(`location.hash = '#/sammlung/set/99999-9'; true`);
    await bis(
      `[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`,
      'unbekanntes Set',
      100,
    );
    assert.equal(
      await b.auswerten(`!!document.querySelector('#toasts .toast .toast-action')`),
      true,
      'mit „Hinzufügen“',
    );
  });

  await t.test('more actions overlay the content', async () => {
    await geh('sammlung');
    await b.auswerten(`location.hash = '#/sammlung/set/10294-1'; true`);
    await bis(
      `document.getElementById('set-modal').classList.contains('open') && !!document.getElementById('m-det').querySelector('.dr')`,
      'Set-Dialog',
      100,
    );
    const hoehe = `document.querySelector('#set-modal .mfooter').getBoundingClientRect().height`;
    const vorher = await b.auswerten(hoehe);
    await b.auswerten(`document.querySelector('#set-modal .more-menu > summary').click(); true`);
    await bis(`document.querySelector('#set-modal .more-menu').open`, 'Menü offen');
    const situation =
      await b.auswerten(`({ liste: document.querySelector('#set-modal .more-list').getBoundingClientRect().bottom,
      fuss: document.querySelector('#set-modal .more-menu > summary').getBoundingClientRect().top })`);
    assert.ok(
      situation.liste <= situation.fuss + 1,
      `Weitere Aktionen überlagern den Inhalt (über ihrem Knopf): ${JSON.stringify(situation)}`,
    );
    assert.ok(Math.abs((await b.auswerten(hoehe)) - vorher) < 2, 'die Fusszeile wächst nicht');
    await b.auswerten(`document.querySelector('#set-modal [data-dialog-close]').click(); true`);
  });

  await t.test('no actions against the own account', async () => {
    const OTHERS = `r11_andere_${process.pid}`;
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true)`,
      [OTHERS, `${OTHERS}@example.org`],
    );
    t.after(() => db.run('DELETE FROM users WHERE username = $1', [OTHERS]).catch(() => {}));
    await geh('einstellungen/benutzer');
    await bis(
      `[...document.querySelectorAll('#users-tbl tr')].some(r => r.textContent.includes(${JSON.stringify(OTHERS)}))`,
      'Benutzerliste',
      100,
    );
    const z =
      await b.auswerten(`(() => { const zeile = n => [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === n);
      const eigene = zeile(${JSON.stringify(`r11_${process.pid}`)}), andere = zeile(${JSON.stringify(OTHERS)});
      return { eigene: eigene.querySelectorAll('button').length, otherDirect: andere.querySelectorAll('.user-actions > button').length,
        otherMore: andere.querySelectorAll('.v-more .more-list button').length }; })()`);
    assert.equal(z.eigene, 0, 'keine Aktionen gegen das eigene Konto');
    assert.deepEqual(
      [z.otherDirect, z.otherMore],
      [1, 2],
      'Passwort direkt, Deaktivieren und Löschen hinter „Weitere“; die Rolle steht am Chip',
    );
  });

  await t.test('werkbank locks the appearance', async () => {
    await geh('konto');
    await bis(`document.getElementById('design-choice')?.options.length > 1`, 'Design-Wahl');
    await b.auswerten(
      `(() => { const s = document.getElementById('design-choice'); s.value = 'werkbank'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await bis(`document.getElementById('dark-choice').disabled`, 'Werkbank sperrt die Darstellung', 50);
    assert.equal(await b.auswerten(`document.getElementById('dark-hint').hidden`), false);
    await b.auswerten(
      `(() => { const s = document.getElementById('design-choice'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await bis(`!document.getElementById('dark-choice').disabled`, 'andere Designs geben sie frei', 50);
  });

  await t.test('empty login: focus into the first field', async () => {
    await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await bis(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
      'Anmeldemaske',
    );
    await b.auswerten(`document.getElementById('btn-login').click(); true`);
    // Since round 26 (N4) the empty field reports itself without asking the server.
    await bis(`document.getElementById('lu-error')?.hidden === false`, 'Fehler am Feld', 100);
    assert.equal(await b.auswerten(`document.activeElement?.id`), 'lu', 'leere Anmeldung: Fokus ins erste Feld');
  });
});
