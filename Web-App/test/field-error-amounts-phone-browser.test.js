/**
 * UX review 20 in real Chrome, in the household (patternHousehold, sub-account with a long name): purchase price dialog
 * (M1, N8), finances on the phone (M2, N1), set number fields (M3), tile (N2), times of the background
 * jobs (N3), legend (N7), 200 % font (N10), finances without connection (N11), password change (N12).
 *
 * Counter-checks (measured 13.11.2026, each alone, bundle rebuilt):
 *   A  feldFehler() again with insertAdjacentElement at the field instead of its own row → red: “purchase price dialog”
 *      (no message row below the row)
 *   B  amountFromField() without the check for a minus → red: same place (““-5” is not an amount …”)
 *   C  styles.css without the rules for .acq-tabelle select and the wider .acq-wide → red: same place
 *      (selection shortened)
 *   D  unterKauf() returns '' → red: “finances on the phone” (no purchase price below the name)
 *   E  withoutMarket() back to ohneWert() → red: same place (value without “no market price”)
 *   F  rowsButton() without <span> around the content → red: same place (0 px between “4” and “(Schwarz)”)
 *   G  #add-num again inputmode="numeric" without autocapitalize → red: “set number fields”
 *   H  tile again with bare text “2 Käufe, zuletzt” → red: “tile with several purchases”
 *   I  monitor.js again fmtDatum(…, 'zeit') → red: “times with day” (“10:03” instead of “morgen 10:03”)
 *   K  legende() again as one sentence without .legende-eintrag → red: “legend holds together”
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

async function groesse(b, breite, hoehe = 900) {
  const mobil = breite <= 640;
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: mobil,
  });
}

/** First, while the finances have never loaded: this is how it looks to whoever opens the tab offline. */
async function financesOffline(_t, a) {
  const { b, bis, ruhig } = a;
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETWORK });
  try {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    // Since round 24 (M2) the error stands at the top of the chart box, the cards drop away.
    await bis(`!!document.querySelector('#portfolio-chart .fehler-zustand')`, 'Fehlerzustand oben');
    const z = await b.auswerten(`({
      karten: document.getElementById('fin-sum').checkVisibility() ? 'sichtbar' : 'weg',
      hinweise: document.querySelectorAll('#tab-finance .fval-hinweis').length,
      erneut: [...document.querySelectorAll('#tab-finance [data-click="loadFinance"], #tab-finance [data-click="loadPortfolioChart"]')].filter(e => e.checkVisibility()).length,
      zeitraum: [...document.querySelectorAll('.zeitraum-wahl .period-btn')].map(k => k.disabled) })`);
    assert.equal(z.karten, 'weg', 'Karten ohne Zahl');
    assert.equal(z.hinweise, 0, '„Keine Verbindung“ in den Karten');
    assert.equal(z.erneut, 1, 'genau ein „Erneut versuchen“');
    assert.deepEqual(z.zeitraum, [true, true, true, true], 'Zeitraumknöpfe bedienbar');
  } finally {
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETWORK });
  }
  // Back on the network the list loads by itself; otherwise the button helps.
  await b.auswerten(`document.querySelector('#tab-finance [data-click="loadFinance"]')?.click(); true`);
  await bis(`!!document.querySelector('#fin-tbl [data-fin-art="sets"] tfoot')`, 'Finanzen nach dem Neuladen', 200);
  await bis(
    `[...document.querySelectorAll('.zeitraum-wahl .period-btn')].every(k => !k.disabled)`,
    'Zeitraum wieder frei',
  );
  await ruhig();
}

async function purchasePriceDialog(_t, a) {
  const { b, bis, ruhig } = a;
  await groesse(b, 1280);
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`!!document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]')`, 'Kachel');
  await b.auswerten(`document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]').click(); true`);
  await bis(`!!document.querySelector('[data-click="openAcqModal"]')`, 'Knopf Kaufpreise');
  await ruhig();
  await b.auswerten(`document.querySelector('[data-click="openAcqModal"]').click(); true`);
  await bis(`document.querySelectorAll('.acq-tabelle tbody tr').length === 2`, 'Kaufpreis-Tabelle');
  await ruhig();
  // N8: every select shows its chosen entry fully (measured by the select's font).
  const gekuerzt = await b.auswerten(`(() => { const c = document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('.acq-tabelle select')].filter(s => {
      const st = getComputedStyle(s); c.font = st.font;
      const noetig = c.measureText(s.selectedOptions[0].text).width + parseFloat(st.paddingLeft) + 16;
      return s.getBoundingClientRect().width < noetig; }).map(s => s.selectedOptions[0].text); })()`);
  assert.deepEqual(gekuerzt, [], 'Auswahl gekürzt');

  const feld = `document.querySelector('.acq-tabelle tbody tr:first-child .acq-preis')`;
  const eingeben = wert =>
    b.auswerten(`(() => { const f = ${feld}; f.focus(); f.value = ${JSON.stringify(wert)};
    f.dispatchEvent(new Event('input', { bubbles: true })); f.value = ${JSON.stringify(wert)}; f.blur(); return true; })()`);
  await eingeben('-5');
  await bis(`!!document.querySelector('.acq-tabelle .feld-fehler:not([hidden])')`, 'Meldung am Preis');
  const m = await b.auswerten(`(() => { const t = document.querySelector('.acq-tabelle'), w = t.closest('.tw');
    const zeile = t.querySelector('tbody tr:first-child'), danach = zeile.nextElementSibling;
    const meldung = t.querySelector('.feld-fehler');
    return { text: meldung.textContent, ownRow: !!danach?.classList.contains('feld-fehler-zeile') && danach.contains(meldung),
      spalten: danach?.cells[0]?.colSpan, cells: zeile.cells.length, rollt: w.scrollWidth > w.clientWidth + 1,
      headers: [...t.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().right > w.getBoundingClientRect().right + 1).map(th => th.textContent.trim()),
      zustand: t.querySelector('tbody tr:first-child select').getBoundingClientRect().width }; })()`);
  assert.equal(m.text, 'Der Kaufpreis kann nicht negativ sein.');
  assert.equal(m.ownRow, true, 'keine Meldungszeile unter der Zeile');
  assert.equal(m.spalten, m.cells, 'Meldung über alle Spalten');
  assert.equal(m.rollt, false, 'Tabelle rollt seitlich');
  assert.deepEqual(m.headers, [], 'Spalten rutschen aus dem Bild');
  assert.ok(m.zustand >= 80, `„Zustand“ nur ${m.zustand} px breit`);
  await eingeben('12,x');
  await bis(
    `/„12,x“ ist kein Betrag/.test(${text('.acq-tabelle .feld-fehler')})`,
    'Unlesbares heisst weiter „kein Betrag“',
  );
  await eingeben('199,99');
  await bis(`document.querySelector('.feld-fehler-zeile')?.hidden === true`, 'Meldungszeile verschwindet');
  await b.auswerten(CLOSE);
}

async function financesPhone(_t, a) {
  const { b, bis, ruhig } = a;
  await groesse(b, 390, 844);
  try {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await bis(`!!document.querySelector('#fin-tbl [data-fin-art="figs"] tbody tr')`, 'Finanzen mit Figuren', 200);
    await ruhig();
    const zeile = name =>
      b.auswerten(`(() => { const r = [...document.querySelectorAll('#fin-tbl tbody tr')].find(x => x.textContent.includes(${JSON.stringify(name)}));
      const sicht = e => !!e && e.checkVisibility() && e.getBoundingClientRect().width > 0;
      const u = r.querySelector('.fin-unter'), w = r.querySelector('.fin-wert'), g = r.querySelector('.fin-guv');
      return { unter: sicht(u) ? u.innerText.replace(/\\s+/g, ' ').trim() : '', wert: w.innerText.replace(/\\s+/g, ' ').trim(), guv: sicht(g) ? g.innerText.trim() : null }; })()`);
    const titanic = await zeile('Titanic');
    assert.match(titanic.unter, /Kaufpreis 679,99 €/, 'Set ohne Kaufpreis unter dem Namen');
    const doc = await zeile('Doc Brown');
    assert.match(doc.unter, /Kaufpreis 9,00 €/, 'Figur ohne Kaufpreis unter dem Namen');
    assert.equal(doc.wert, 'kein Marktpreis');
    assert.equal(doc.guv, null, 'zweiter Strich neben dem Wert');
    // N1: between “Brick 2 x 4” and “(Schwarz)” there is a word space.
    const abstand =
      await b.auswerten(`(() => { const k = [...document.querySelectorAll('#fin-tbl [data-fin-art="parts"] .zeile-oeffnen')].find(x => x.textContent.includes('(Schwarz)'));
      const farbe = [...k.querySelectorAll('span')].find(s => s.textContent.trim() === '(Schwarz)');
      const w = document.createTreeWalker(k, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.includes('Brick'));
      const r = document.createRange(); const i = n.textContent.indexOf('4'); r.setStart(n, i); r.setEnd(n, i + 1);
      const a = r.getBoundingClientRect(), f = farbe.getClientRects()[0];
      // In der nächsten Zeile ist der Umbruch der Abstand.
      return Math.abs(f.top - a.top) > 3 ? 99 : f.left - a.right; })()`);
    assert.ok(abstand >= 2, `${abstand} px zwischen „4“ und „(Schwarz)“`);
  } finally {
    await groesse(b, 1280);
  }
}

async function setnummerFields(_t, a) {
  const { b } = a;
  const felder =
    await b.auswerten(`['add-num', 'mk-num', 'pl-setnr', 'alarm-neu-set'].map(id => { const f = document.getElementById(id);
    return [id, f.inputMode || '', f.getAttribute('autocapitalize'), f.getAttribute('autocorrect'), f.spellcheck]; })`);
  for (const [id, modus, gross, korrektur, spelling] of felder) {
    assert.notEqual(modus, 'numeric', `${id}: Zifferntastatur ohne Bindestrich und Buchstaben`);
    assert.equal(gross, 'off', `${id}: Grossschreibung`);
    assert.equal(korrektur, 'off', `${id}: Autokorrektur`);
    assert.equal(spelling, false, `${id}: Rechtschreibprüfung`);
  }
}

async function tilePurchases(_t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`!!document.querySelector('#gallery [data-arg="21318-1"] .kachel-datum')`, 'Kachel Tree House');
  const k = await b.auswerten(`(() => { const d = document.querySelector('#gallery [data-arg="21318-1"] .kachel-datum');
    return { text: d.textContent.replace(/\\s+/g, ' ').trim(), etikett: d.querySelector(':scope > span')?.textContent,
      lose: [...d.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim() && !/^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(n.textContent.trim())).map(n => n.textContent) }; })()`);
  assert.equal(k.text, '2 Käufe, zuletzt 02.06.2026');
  assert.equal(k.etikett, '2 Käufe, zuletzt', 'Etikett ohne eigenes Element');
  assert.deepEqual(k.lose, [], 'loser Text neben dem Datum');
}

async function momentsWithTag(_t, a) {
  const { b, bis, db } = a;
  const morgen = new Date();
  morgen.setDate(morgen.getDate() + 1);
  morgen.setHours(10, 3, 0, 0);
  const spaeter = new Date(morgen);
  spaeter.setDate(spaeter.getDate() + 2);
  for (const wann of [morgen, spaeter])
    await db.run(`INSERT INTO jobs (type, due_at) VALUES ('konto_dateien', $1)`, [wann.toISOString()]);
  await b.auswerten(`document.getElementById('ntab-monitor').click(); true`);
  await bis(`/Dateien gelöschter Konten/.test(document.getElementById('tab-monitor').textContent)`, 'Aufträge');
  await b.auswerten(`document.querySelector('.mon-einzeln')?.setAttribute('open', ''); true`);
  const z =
    await b.auswerten(`(() => { const zeilen = [...document.querySelectorAll('#tab-monitor tr')].filter(r => r.textContent.includes('Dateien gelöschter Konten'));
    return zeilen.map(r => r.innerText.replace(/\\s+/g, ' ')); })()`);
  const tag = `${String(spaeter.getDate()).padStart(2, '0')}.${String(spaeter.getMonth() + 1).padStart(2, '0')}.${spaeter.getFullYear()}`;
  const alle = z.join(' | ');
  assert.ok(
    z.some(s => /entfernen \d+ 0 0 morgen 10:03/.test(s)),
    `Arten-Tabelle: ${alle}`,
  );
  assert.ok(
    z.some(s => /offen \D*morgen 10:03/.test(s)),
    `Einzelauftrag morgen: ${alle}`,
  );
  assert.ok(
    z.some(s => s.includes(`${tag}, 10:03`)),
    `Einzelauftrag in drei Tagen mit Datum: ${alle}`,
  );
}

async function legendTogether(_t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
  await bis(`!!document.querySelector('#fin-tbl .fin-legende')`, 'Legende');
  try {
    for (const breite of [700, 820, 1000, 1280]) {
      await groesse(b, breite);
      await bis(`innerWidth === ${breite}`, 'Fenstergrösse');
      const l =
        await b.auswerten(`(() => { const e = [...document.querySelectorAll('#fin-tbl .fin-legende .legende-eintrag')];
        return { n: e.length, zeichen: e.filter(x => x.querySelector('.legende-zeichen')).length,
          getrennt: e.filter(x => new Set([...x.getClientRects()].map(r => Math.round(r.top))).size > 1
            || Math.abs(x.querySelector('.legende-zeichen').getBoundingClientRect().top - x.getBoundingClientRect().top) > 8).map(x => x.textContent.trim()) }; })()`);
      assert.equal(l.n, 3, `${breite} px: Einträge`);
      assert.equal(l.zeichen, 3, `${breite} px: Zeichen`);
      assert.deepEqual(l.getrennt, [], `${breite} px: Zeichen und Text getrennt`);
    }
  } finally {
    await groesse(b, 1280);
  }
}

async function schrift200Phone(_t, a) {
  const { b, bis, ruhig } = a;
  await groesse(b, 390, 844);
  await b.auswerten(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  try {
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); scrollTo(0, 0); true`);
    await bis(`!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await ruhig();
    const z = await b.auswerten(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .brick-stats .bstat')].filter(e => e.checkVisibility());
      const tops = k.map(e => Math.round(e.getBoundingClientRect().top));
      // Beginnt eine Kennzahl eine Zeile, steht ihre Zahl ganz links; ein führender Punkt schöbe sie nach rechts.
      const verwaist = k.filter((e, i) => i > 0 && tops[i] > tops[i - 1] + 2)
        .map(e => Math.round(e.querySelector('.bstat-v').getBoundingClientRect().left - e.getBoundingClientRect().left))
        .filter(d => d > 2);
      const nav = document.querySelector('nav:not(.einst-nav)');
      const namen = [...nav.querySelectorAll('.ntab')].filter(t => t.checkVisibility()).map(t => t.querySelector('.tab-label'))
        .filter(l => l.getBoundingClientRect().width <= 1 || l.scrollWidth > l.clientWidth + 1).map(l => l.textContent.trim());
      return { reihen: new Set(tops).size, verwaist, leiste: Math.round(nav.getBoundingClientRect().height), namen,
        ziele: [...nav.querySelectorAll('.ntab')].filter(t => t.checkVisibility()).map(t => Math.round(t.getBoundingClientRect().height)) }; })()`);
    assert.ok(z.reihen > 1, `Testaufbau: Die Kennzahlen brechen nicht um (${z.reihen} Reihe)`);
    assert.deepEqual(z.verwaist, [], 'Zeile beginnt mit „·“');
    assert.ok(z.leiste <= 100, `Leiste ${z.leiste} px hoch`);
    assert.deepEqual(z.namen, [], 'Beschriftung der Leiste abgeschnitten');
    assert.ok(Math.min(...z.ziele) >= 44, `Tippziel ${Math.min(...z.ziele)} px`);
  } finally {
    await b.auswerten(`document.documentElement.style.removeProperty('font-size'); true`);
    await groesse(b, 1280);
  }
}

async function passwordChange(_t, a) {
  const { b } = a;
  const p = await b.auswerten(`(() => { const k = document.getElementById('pw-pk');
    const ids = (k.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
    return { etikett: k.closest('label').textContent.replace(/\\s+/g, ' ').trim(),
      beschreibung: ids.map(id => document.getElementById(id)?.textContent.trim() || '').join(' ') }; })()`);
  assert.equal(p.etikett, 'Auch alle Passkeys entfernen');
  assert.match(p.beschreibung, /^Empfohlen: Ein Passkey, den jemand Fremdes angelegt hat/);
}

test('field errors, amounts, finances on the phone', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await startApp(t, { name: `r20_pruefer_${process.pid}`, bestand: patternHousehold });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Finanzen ohne Verbindung', financesOffline],
    ['Kaufpreis-Dialog', purchasePriceDialog],
    ['Finanzen am Telefon', financesPhone],
    ['Setnummer-Felder', setnummerFields],
    ['Kachel mit mehreren Käufen', tilePurchases],
    ['Zeitpunkte mit Tag', momentsWithTag],
    ['Legende hält zusammen', legendTogether],
    ['200 % Schrift am Telefon', schrift200Phone],
    ['Passwortwechsel', passwordChange],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.auswerten(CLOSE);
    await t.test(name, () => fn(t, a));
  }
});
