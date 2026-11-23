/**
 * UX review 20 in real Chrome, in the household (patternHousehold, sub-account with a long name): purchase price dialog
 * (M1, N8), finances on the phone (M2, N1), set number fields (M3), tile (N2), times of the background
 * jobs (N3), legend (N7), 200 % font (N10), finances without connection (N11), password change (N12).
 *
 * Counter-checks (measured 13.11.2026, each alone, bundle rebuilt):
 *   A  fieldError() again with insertAdjacentElement at the field instead of its own row → red: “purchase price dialog”
 *      (no message row below the row)
 *   B  amountFromField() without the check for a minus → red: same place (““-5” is not an amount …”)
 *   C  styles.css without the rules for .acq-table select and the wider .acq-wide → red: same place
 *      (selection shortened)
 *   D  unterKauf() returns '' → red: “finances on the phone” (no purchase price below the name)
 *   E  withoutMarket() back to ohneWert() → red: same place (value without “no market price”)
 *   F  rowsButton() without <span> around the content → red: same place (0 px between “4” and “(Schwarz)”)
 *   G  #add-num again inputmode="numeric" without autocapitalize → red: “set number fields”
 *   H  tile again with bare text “2 Käufe, zuletzt” → red: “tile with several purchases”
 *   I  monitor.js again fmtDate(…, 'zeit') → red: “times with day” (“10:03” instead of “morgen 10:03”)
 *   K  legende() again as one sentence without .legend-entry → red: “legend holds together”
 *   L  mobile.css again `.bstat:not(:first-child)::after` → red: “200 % font on the phone” (line starts
 *      with “·”)
 *   M  @container leiste without `.ntab .ico { display: none }` → red: same place (bar 106 px high)
 *   N  finanzenFehlen() again with “Keine Verbindung” in the cards → red: “finances without connection”;
 *      since round 24 (14.11.2026): `G('fin-sum').hidden = true` removed → red: same place (“cards without number”)
 *   O  finanzenFehlen() without locking the period buttons → red: same place (buttons operable)
 *   P  #pw-pk again with the long text in the label, without aria-describedby → red: “password change”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const CLOSE = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const NETWORK = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

async function size(b, width, height = 900) {
  const mobileView = width <= 640;
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: mobileView,
  });
}

/** First, while the finances have never loaded: this is how it looks to whoever opens the tab offline. */
async function financesOffline(_t, a) {
  const { b, until, settle } = a;
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETWORK });
  try {
    await b.evaluate(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    // Since round 24 (M2) the error stands at the top of the chart box, the cards drop away.
    await until(`!!document.querySelector('#portfolio-chart .error-state')`, 'Error state at the top');
    const z = await b.evaluate(`({
      karten: document.getElementById('fin-sum').checkVisibility() ? 'sichtbar' : 'weg',
      hints: document.querySelectorAll('#tab-finance .fval-hint').length,
      retry: [...document.querySelectorAll('#tab-finance [data-click="loadFinance"], #tab-finance [data-click="loadPortfolioChart"]')].filter(e => e.checkVisibility()).length,
      zeitraum: [...document.querySelectorAll('.period-choice .period-btn')].map(k => k.disabled) })`);
    assert.equal(z.karten, 'weg', 'Cards without a number');
    assert.equal(z.hints, 0, '„Keine Verbindung“ in the cards');
    assert.equal(z.retry, 1, 'exactly one „Erneut versuchen“');
    assert.deepEqual(z.zeitraum, [true, true, true, true], 'Period buttons usable');
  } finally {
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETWORK });
  }
  // Back on the network the list loads by itself; otherwise the button helps.
  await b.evaluate(`document.querySelector('#tab-finance [data-click="loadFinance"]')?.click(); true`);
  await until(`!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tfoot')`, 'Finances after reload', 200);
  await until(
    `[...document.querySelectorAll('.period-choice .period-btn')].every(k => !k.disabled)`,
    'Period free again',
  );
  await settle();
}

async function purchasePriceDialog(_t, a) {
  const { b, until, settle } = a;
  await size(b, 1280);
  await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await until(`!!document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]')`, 'Tile');
  await b.evaluate(`document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]').click(); true`);
  await until(`!!document.querySelector('[data-click="openAcqModal"]')`, 'Button purchase prices');
  await settle();
  await b.evaluate(`document.querySelector('[data-click="openAcqModal"]').click(); true`);
  await until(`document.querySelectorAll('.acq-table tbody tr').length === 2`, 'Kaufpreis-Tabelle');
  await settle();
  // N8: every select shows its chosen entry fully (measured by the select's font).
  const gekuerzt = await b.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('.acq-table select')].filter(s => {
      const st = getComputedStyle(s); c.font = st.font;
      const needed = c.measureText(s.selectedOptions[0].text).width + parseFloat(st.paddingLeft) + 16;
      return s.getBoundingClientRect().width < needed; }).map(s => s.selectedOptions[0].text); })()`);
  assert.deepEqual(gekuerzt, [], 'Selection shortened');

  const field = `document.querySelector('.acq-table tbody tr:first-child .acq-price')`;
  const enter = value =>
    b.evaluate(`(() => { const f = ${field}; f.focus(); f.value = ${JSON.stringify(value)};
    f.dispatchEvent(new Event('input', { bubbles: true })); f.value = ${JSON.stringify(value)}; f.blur(); return true; })()`);
  await enter('-5');
  await until(`!!document.querySelector('.acq-table .field-error:not([hidden])')`, 'Message at the price');
  const m = await b.evaluate(`(() => { const t = document.querySelector('.acq-table'), w = t.closest('.tw');
    const line = t.querySelector('tbody tr:first-child'), afterwards = line.nextElementSibling;
    const message = t.querySelector('.field-error');
    return { text: message.textContent, ownRow: !!afterwards?.classList.contains('field-error-row') && afterwards.contains(message),
      columns: afterwards?.cells[0]?.colSpan, cells: line.cells.length, rollt: w.scrollWidth > w.clientWidth + 1,
      headers: [...t.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().right > w.getBoundingClientRect().right + 1).map(th => th.textContent.trim()),
      zustand: t.querySelector('tbody tr:first-child select').getBoundingClientRect().width }; })()`);
  assert.equal(m.text, 'Der Kaufpreis kann nicht negativ sein.');
  assert.equal(m.ownRow, true, 'no message line below the row');
  assert.equal(m.columns, m.cells, 'Message across all columns');
  assert.equal(m.rollt, false, 'Table scrolls sideways');
  assert.deepEqual(m.headers, [], 'Columns slide out of view');
  assert.ok(m.zustand >= 80, `„Zustand“ nur ${m.zustand} px breit`);
  await enter('12,x');
  await until(
    `/„12,x“ ist kein Betrag/.test(${text('.acq-table .field-error')})`,
    'Unreadable still means „kein Betrag“',
  );
  await enter('199,99');
  await until(`document.querySelector('.field-error-row')?.hidden === true`, 'Meldungszeile verschwindet');
  await b.evaluate(CLOSE);
}

async function financesPhone(_t, a) {
  const { b, until, settle } = a;
  await size(b, 390, 844);
  try {
    await b.evaluate(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await until(`!!document.querySelector('#fin-tbl [data-fin-kind="figs"] tbody tr')`, 'Finances with minifigs', 200);
    await settle();
    const row = name =>
      b.evaluate(`(() => { const r = [...document.querySelectorAll('#fin-tbl tbody tr')].find(x => x.textContent.includes(${JSON.stringify(name)}));
      const view = e => !!e && e.checkVisibility() && e.getBoundingClientRect().width > 0;
      const u = r.querySelector('.fin-sub'), w = r.querySelector('.fin-value'), g = r.querySelector('.fin-guv');
      return { sub: view(u) ? u.innerText.replace(/\\s+/g, ' ').trim() : '', wert: w.innerText.replace(/\\s+/g, ' ').trim(), pnl: view(g) ? g.innerText.trim() : null }; })()`);
    const titanic = await row('Titanic');
    assert.match(titanic.sub, /Kaufpreis 679,99 €/, 'set without purchase price below the name');
    const doc = await row('Doc Brown');
    assert.match(doc.sub, /Kaufpreis 9,00 €/, 'minifig without purchase price below the name');
    assert.equal(doc.wert, 'kein Marktpreis');
    assert.equal(doc.pnl, null, 'second dash next to the value');
    // N1: between “Brick 2 x 4” and “(Schwarz)” there is a word space.
    const gap =
      await b.evaluate(`(() => { const k = [...document.querySelectorAll('#fin-tbl [data-fin-kind="parts"] .row-open')].find(x => x.textContent.includes('(Schwarz)'));
      const farbe = [...k.querySelectorAll('span')].find(s => s.textContent.trim() === '(Schwarz)');
      const w = document.createTreeWalker(k, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.includes('Brick'));
      const r = document.createRange(); const i = n.textContent.indexOf('4'); r.setStart(n, i); r.setEnd(n, i + 1);
      const a = r.getBoundingClientRect(), f = farbe.getClientRects()[0];
      // In der nächsten Zeile ist der Umbruch der Abstand.
      return Math.abs(f.top - a.top) > 3 ? 99 : f.left - a.right; })()`);
    assert.ok(gap >= 2, `${gap} px between „4“ and „(Schwarz)“`);
  } finally {
    await size(b, 1280);
  }
}

async function setNumberFields(_t, a) {
  const { b } = a;
  const fields =
    await b.evaluate(`['add-num', 'mk-num', 'pl-setnr', 'alert-new-set'].map(id => { const f = document.getElementById(id);
    return [id, f.inputMode || '', f.getAttribute('autocapitalize'), f.getAttribute('autocorrect'), f.spellcheck]; })`);
  for (const [id, mode, gross, correction, spelling] of fields) {
    assert.notEqual(mode, 'numeric', `${id}: numeric keyboard without hyphen and letters`);
    assert.equal(gross, 'off', `${id}: Grossschreibung`);
    assert.equal(correction, 'off', `${id}: Autokorrektur`);
    assert.equal(spelling, false, `${id}: spell check`);
  }
}

async function tilePurchases(_t, a) {
  const { b, until } = a;
  await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await until(`!!document.querySelector('#gallery [data-arg="21318-1"] .tile-date')`, 'Tile Tree House');
  const k = await b.evaluate(`(() => { const d = document.querySelector('#gallery [data-arg="21318-1"] .tile-date');
    return { text: d.textContent.replace(/\\s+/g, ' ').trim(), label: d.querySelector(':scope > span')?.textContent,
      lose: [...d.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim() && !/^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(n.textContent.trim())).map(n => n.textContent) }; })()`);
  assert.equal(k.text, '2 Käufe, zuletzt 02.06.2026');
  assert.equal(k.label, '2 Käufe, zuletzt', 'Label without its own element');
  assert.deepEqual(k.lose, [], 'loose text next to the date');
}

async function momentsWithTag(_t, a) {
  const { b, until, db } = a;
  const morgen = new Date();
  morgen.setDate(morgen.getDate() + 1);
  morgen.setHours(10, 3, 0, 0);
  const subsequent = new Date(morgen);
  subsequent.setDate(subsequent.getDate() + 2);
  for (const wann of [morgen, subsequent])
    await db.run(`INSERT INTO jobs (type, due_at) VALUES ('account_files', $1)`, [wann.toISOString()]);
  await b.evaluate(`document.getElementById('ntab-monitor').click(); true`);
  await until(`/Dateien gelöschter Konten/.test(document.getElementById('tab-monitor').textContent)`, 'Jobs');
  await b.evaluate(`document.querySelector('.mon-single')?.setAttribute('open', ''); true`);
  const z =
    await b.evaluate(`(() => { const lines = [...document.querySelectorAll('#tab-monitor tr')].filter(r => r.textContent.includes('Dateien gelöschter Konten'));
    return lines.map(r => r.innerText.replace(/\\s+/g, ' ')); })()`);
  const tag = `${String(subsequent.getDate()).padStart(2, '0')}.${String(subsequent.getMonth() + 1).padStart(2, '0')}.${subsequent.getFullYear()}`;
  const all = z.join(' | ');
  assert.ok(
    z.some(s => /entfernen \d+ 0 0 morgen 10:03/.test(s)),
    `Arten-Tabelle: ${all}`,
  );
  assert.ok(
    z.some(s => /offen \D*morgen 10:03/.test(s)),
    `Einzelauftrag morgen: ${all}`,
  );
  assert.ok(
    z.some(s => s.includes(`${tag}, 10:03`)),
    `Single job in three days with a date: ${all}`,
  );
}

async function legendTogether(_t, a) {
  const { b, until } = a;
  await b.evaluate(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
  await until(`!!document.querySelector('#fin-tbl .fin-legend')`, 'Legend');
  try {
    for (const width of [700, 820, 1000, 1280]) {
      await size(b, width);
      await until(`innerWidth === ${width}`, 'Window size');
      const l =
        await b.evaluate(`(() => { const e = [...document.querySelectorAll('#fin-tbl .fin-legend .legend-entry')];
        return { n: e.length, chars: e.filter(x => x.querySelector('.legend-char')).length,
          separate: e.filter(x => new Set([...x.getClientRects()].map(r => Math.round(r.top))).size > 1
            || Math.abs(x.querySelector('.legend-char').getBoundingClientRect().top - x.getBoundingClientRect().top) > 8).map(x => x.textContent.trim()) }; })()`);
      assert.equal(l.n, 3, `${width} px: entries`);
      assert.equal(l.chars, 3, `${width} px: symbols`);
      assert.deepEqual(l.separate, [], `${width} px: symbol and text separated`);
    }
  } finally {
    await size(b, 1280);
  }
}

async function schrift200Phone(_t, a) {
  const { b, until, settle } = a;
  await size(b, 390, 844);
  await b.evaluate(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  try {
    await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); scrollTo(0, 0); true`);
    await until(`!!document.querySelector('#gallery .sc')`, 'Collection');
    await settle();
    const z = await b.evaluate(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .brick-stats .bstat')].filter(e => e.checkVisibility());
      const tops = k.map(e => Math.round(e.getBoundingClientRect().top));
      // Beginnt eine Kennzahl eine Zeile, steht ihre Zahl ganz links; ein führender Punkt schöbe sie nach rechts.
      const orphaned = k.filter((e, i) => i > 0 && tops[i] > tops[i - 1] + 2)
        .map(e => Math.round(e.querySelector('.bstat-v').getBoundingClientRect().left - e.getBoundingClientRect().left))
        .filter(d => d > 2);
      const nav = document.querySelector('nav:not(.settings-nav)');
      const names = [...nav.querySelectorAll('.ntab')].filter(t => t.checkVisibility()).map(t => t.querySelector('.tab-label'))
        .filter(l => l.getBoundingClientRect().width <= 1 || l.scrollWidth > l.clientWidth + 1).map(l => l.textContent.trim());
      return { rows: new Set(tops).size, orphaned, bar: Math.round(nav.getBoundingClientRect().height), names,
        targets: [...nav.querySelectorAll('.ntab')].filter(t => t.checkVisibility()).map(t => Math.round(t.getBoundingClientRect().height)) }; })()`);
    assert.ok(z.rows > 1, `Test setup: the key figures do not wrap (${z.rows} row)`);
    assert.deepEqual(z.orphaned, [], 'Row starts with „·“');
    assert.ok(z.bar <= 100, `Bar ${z.bar} px high`);
    assert.deepEqual(z.names, [], 'Label of the bar cut off');
    assert.ok(Math.min(...z.targets) >= 44, `Tippziel ${Math.min(...z.targets)} px`);
  } finally {
    await b.evaluate(`document.documentElement.style.removeProperty('font-size'); true`);
    await size(b, 1280);
  }
}

async function passwordChange(_t, a) {
  const { b } = a;
  const p = await b.evaluate(`(() => { const k = document.getElementById('pw-pk');
    const ids = (k.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
    return { label: k.closest('label').textContent.replace(/\\s+/g, ' ').trim(),
      description: ids.map(id => document.getElementById(id)?.textContent.trim() || '').join(' ') }; })()`);
  assert.equal(p.label, 'Auch alle Passkeys entfernen');
  assert.match(p.description, /^Empfohlen: Ein Passkey, den jemand Fremdes angelegt hat/);
}

test('field errors, amounts, finances on the phone', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await startApp(t, { name: `r20_pruefer_${process.pid}`, holding: patternHousehold });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  await a.settle();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Finanzen ohne Verbindung', financesOffline],
    ['Kaufpreis-Dialog', purchasePriceDialog],
    ['Finanzen am Telefon', financesPhone],
    ['Setnummer-Felder', setNumberFields],
    ['Kachel mit mehreren Käufen', tilePurchases],
    ['Zeitpunkte mit Tag', momentsWithTag],
    ['Legende hält zusammen', legendTogether],
    ['200 % Schrift am Telefon', schrift200Phone],
    ['Passwortwechsel', passwordChange],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.evaluate(CLOSE);
    await t.test(name, () => fn(t, a));
  }
});
