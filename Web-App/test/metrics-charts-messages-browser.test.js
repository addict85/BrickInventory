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
 *      {amount} Kaufpreis gesamt“ → red: “purchase price card names its reference”
 *      (the reference is not explained)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

test('metrics, charts, messages', { timeout: 280_000 }, async t => {
  const app = await startApp(t, { name: `r11_${process.pid}`, holding: patternCollection, allDesigns: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, db } = app;
  const geh = async path => {
    await b.evaluate(`location.hash = '#/${path}'; true`);
    await sleep(300);
  };

  await t.test('purchase price card names its reference', async () => {
    await geh('finanzen');
    await until(`!!document.querySelector('#fin-tbl .dt-sum tfoot')`, 'Finanzen geladen', 200);
    const z = await b.evaluate(`({ title: document.getElementById('fin-cost-basis-title').textContent.trim(),
      sub: document.getElementById('fin-cost-basis-sub').textContent,
      total: document.querySelector('#fin-tbl .dt-sum tfoot td.fin-footer-value').textContent.trim(),
      basis: document.getElementById('fin-basis').hidden })`);
    assert.equal(z.basis, false, 'test data: items without a market price');
    // Named briefly since UX check 25 (B2); what „bewertet“ means stands in the tooltip and below the cards.
    assert.equal(z.title, 'Kaufpreis (bewertete Positionen)', 'purchase price card names its scope, not „gesamt“');
    assert.match(z.sub, /^Insgesamt bezahlt: /, 'the sum of all purchases is labelled (UX review 19 N4)');
    assert.ok(z.sub.includes(z.total), `the sum of all purchase prices is below: ${z.sub} / ${z.total}`);
  });

  await t.test('value line in the accent color', async () => {
    await until(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm', 200);
    const color = await b.evaluate(`(() => { const h = document.documentElement, alt = h.getAttribute('data-theme');
      h.setAttribute('data-theme', 'werkbank'); const f = getComputedStyle(document.querySelector('#portfolio-chart svg polyline')).stroke;
      if (alt === null) h.removeAttribute('data-theme'); else h.setAttribute('data-theme', alt); return f; })()`);
    assert.equal(color, 'rgb(201, 150, 63)', 'value line in the accent colour (brass for the workbench theme)');
  });

  await t.test('chart grows with the font', async () => {
    // The scale of what is drawn (getScreenCTM), not the frame: with
    // max-height a shrunk image stands centered in a wide frame.
    const mass = `(() => { const svg = document.querySelector('#portfolio-chart svg');
      const k = svg.getScreenCTM().a;
      return { width: svg.viewBox.baseVal.width * k, container: document.getElementById('portfolio-chart').clientWidth,
        font: Math.min(...[...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * k)) }; })()`;
    const prior = await b.evaluate(mass);
    // The old image gone, so that what is newly drawn at 200 % is measured.
    await b.evaluate(
      `document.documentElement.style.fontSize = '200%'; document.getElementById('portfolio-chart').innerHTML = ''; true`,
    );
    await geh('sammlung');
    await geh('finanzen');
    await until(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm bei 200 %', 200);
    const later = await b.evaluate(mass);
    await b.evaluate(`document.documentElement.style.fontSize = ''; true`);
    assert.ok(later.width >= later.container * 0.95, `chart grows with the font: ${JSON.stringify(later)}`);
    assert.ok(later.font >= prior.font * 1.8, `chart grows with the font: ${prior.font} → ${later.font}`);
  });

  await t.test('parts footer names entries', async () => {
    await geh('teile');
    await until(`/\\d/.test(document.getElementById('parts-sentinel')?.textContent || '')`, 'Teileliste', 200);
    const fuss = await b.evaluate(`document.getElementById('parts-sentinel').textContent`);
    assert.match(fuss, /Einträge aus Sets \(Teil × Farbe\)/);
    assert.doesNotMatch(fuss, /Teilesorten/);
  });

  await t.test('unknown set: plain text instead of "error"', async () => {
    await geh('sammlung');
    await b.evaluate(`location.hash = '#/sammlung/set/99999-9'; true`);
    await until(
      `[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`,
      'unbekanntes Set',
      100,
    );
    assert.equal(
      await b.evaluate(`!!document.querySelector('#toasts .toast .toast-action')`),
      true,
      'with „Hinzufügen“',
    );
  });

  await t.test('more actions overlay the content', async () => {
    await geh('sammlung');
    await b.evaluate(`location.hash = '#/sammlung/set/10294-1'; true`);
    await until(
      `document.getElementById('set-modal').classList.contains('open') && !!document.getElementById('m-det').querySelector('.dr')`,
      'Set-Dialog',
      100,
    );
    const height = `document.querySelector('#set-modal .mfooter').getBoundingClientRect().height`;
    const prior = await b.evaluate(height);
    await b.evaluate(`document.querySelector('#set-modal .more-menu > summary').click(); true`);
    await until(`document.querySelector('#set-modal .more-menu').open`, 'Menü offen');
    const situation =
      await b.evaluate(`({ list: document.querySelector('#set-modal .more-list').getBoundingClientRect().bottom,
      fuss: document.querySelector('#set-modal .more-menu > summary').getBoundingClientRect().top })`);
    assert.ok(
      situation.list <= situation.fuss + 1,
      `More actions overlay the content (above their button): ${JSON.stringify(situation)}`,
    );
    assert.ok(Math.abs((await b.evaluate(height)) - prior) < 2, 'the footer does not grow');
    await b.evaluate(`document.querySelector('#set-modal [data-dialog-close]').click(); true`);
  });

  await t.test('no actions against the own account', async () => {
    const OTHERS = `r11_andere_${process.pid}`;
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true)`,
      [OTHERS, `${OTHERS}@example.org`],
    );
    t.after(() => db.run('DELETE FROM users WHERE username = $1', [OTHERS]).catch(() => {}));
    await geh('einstellungen/benutzer');
    await until(
      `[...document.querySelectorAll('#users-tbl tr')].some(r => r.textContent.includes(${JSON.stringify(OTHERS)}))`,
      'Benutzerliste',
      100,
    );
    const z =
      await b.evaluate(`(() => { const line = n => [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === n);
      const owned = line(${JSON.stringify(`r11_${process.pid}`)}), others = line(${JSON.stringify(OTHERS)});
      return { owned: owned.querySelectorAll('button').length, otherDirect: others.querySelectorAll('.user-actions > button').length,
        otherMore: others.querySelectorAll('.v-more .more-list button').length }; })()`);
    assert.equal(z.owned, 0, 'no actions against the own account');
    assert.deepEqual(
      [z.otherDirect, z.otherMore],
      [1, 2],
      'password directly, deactivate and delete behind „Weitere“; the role is on the chip',
    );
  });

  await t.test('werkbank locks the appearance', async () => {
    await geh('konto');
    await until(`document.getElementById('design-choice')?.options.length > 1`, 'Design-Wahl');
    await b.evaluate(
      `(() => { const s = document.getElementById('design-choice'); s.value = 'werkbank'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await until(`document.getElementById('dark-choice').disabled`, 'Werkbank sperrt die Darstellung', 50);
    assert.equal(await b.evaluate(`document.getElementById('dark-hint').hidden`), false);
    await b.evaluate(
      `(() => { const s = document.getElementById('design-choice'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await until(`!document.getElementById('dark-choice').disabled`, 'andere Designs geben sie frei', 50);
  });

  await t.test('empty login: focus into the first field', async () => {
    await b.evaluate(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await until(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
      'Anmeldemaske',
    );
    await b.evaluate(`document.getElementById('btn-login').click(); true`);
    // Since round 26 (N4) the empty field reports itself without asking the server.
    await until(`document.getElementById('lu-error')?.hidden === false`, 'Fehler am Feld', 100);
    assert.equal(await b.evaluate(`document.activeElement?.id`), 'lu', 'empty login: focus in the first field');
  });
});
