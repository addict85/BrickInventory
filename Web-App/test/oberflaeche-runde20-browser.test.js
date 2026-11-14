/**
 * UX-Prüfung 20 im echten Chrome, im Haushalt (musterHaushalt, Unterkonto mit langem Namen): Kaufpreis-Dialog
 * (M1, N8), Finanzen am Telefon (M2, N1), Setnummer-Felder (M3), Kachel (N2), Zeitpunkte der Hintergrund-
 * arbeiten (N3), Legende (N7), 200 % Schrift (N10), Finanzen ohne Verbindung (N11), Passwortwechsel (N12).
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  feldFehler() wieder mit insertAdjacentElement am Feld statt eigener Zeile → rot: „Kaufpreis-Dialog“
 *      (keine Meldungszeile unter der Zeile)
 *   B  betragAusFeld() ohne die Prüfung auf ein Minus → rot: ebenda („„-5“ ist kein Betrag …“)
 *   C  styles.css ohne die Regeln für .acq-tabelle select und die breitere .acq-wide → rot: ebenda
 *      (Auswahl gekürzt)
 *   D  unterKauf() liefert '' → rot: „Finanzen am Telefon“ (kein Kaufpreis unter dem Namen)
 *   E  ohneMarkt() wieder ohneWert() → rot: ebenda (Wert ohne „kein Marktpreis“)
 *   F  zeilenKnopf() ohne <span> um den Inhalt → rot: ebenda (0 px zwischen „4“ und „(Schwarz)“)
 *   G  #add-num wieder inputmode="numeric" ohne autocapitalize → rot: „Setnummer-Felder“
 *   H  Kachel wieder mit nacktem Text „2 Käufe, zuletzt“ → rot: „Kachel mit mehreren Käufen“
 *   I  monitor.js wieder fmtDatum(…, 'zeit') → rot: „Zeitpunkte mit Tag“ („10:03“ statt „morgen 10:03“)
 *   K  legende() wieder als ein Satz ohne .legende-eintrag → rot: „Legende hält zusammen“
 *   L  mobile.css wieder `.bstat:not(:first-child)::after` → rot: „200 % Schrift am Telefon“ (Zeile beginnt
 *      mit „·“)
 *   M  @container leiste ohne `.ntab .ico { display: none }` → rot: ebenda (Leiste 106 px hoch)
 *   N  finanzenFehlen() wieder mit „Keine Verbindung“ in den Karten → rot: „Finanzen ohne Verbindung“;
 *      seit Runde 24 (14.11.2026): `G('fin-sum').hidden = true` entfernt → rot: ebenda („Karten ohne Zahl“)
 *   O  finanzenFehlen() ohne das Sperren der Zeitraumknöpfe → rot: ebenda (Knöpfe bedienbar)
 *   P  #pw-pk wieder mit dem langen Text im Etikett, ohne aria-describedby → rot: „Passwortwechsel“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const SCHLIESSEN = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const NETZ = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

async function groesse(b, breite, hoehe = 900) {
  const mobil = breite <= 640;
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: mobil,
  });
}

/** Zuerst, solange die Finanzen noch nie geladen haben: So sieht es aus, wer offline den Reiter öffnet. */
async function finanzenOffline(_t, a) {
  const { b, bis, ruhig } = a;
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETZ });
  try {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    // Seit Runde 24 (M2) steht der Fehler oben im Diagrammkasten, die Karten fallen weg.
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
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETZ });
  }
  // Zurück am Netz lädt die Liste von selbst; sonst hilft der Knopf.
  await b.auswerten(`document.querySelector('#tab-finance [data-click="loadFinance"]')?.click(); true`);
  await bis(`!!document.querySelector('#fin-tbl [data-fin-art="sets"] tfoot')`, 'Finanzen nach dem Neuladen', 200);
  await bis(
    `[...document.querySelectorAll('.zeitraum-wahl .period-btn')].every(k => !k.disabled)`,
    'Zeitraum wieder frei',
  );
  await ruhig();
}

async function kaufpreisDialog(_t, a) {
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
  // N8: Jede Auswahl zeigt ihren gewählten Eintrag ganz (gemessen an der Schrift der Auswahl).
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
    return { text: meldung.textContent, eigeneZeile: !!danach?.classList.contains('feld-fehler-zeile') && danach.contains(meldung),
      spalten: danach?.cells[0]?.colSpan, zellen: zeile.cells.length, rollt: w.scrollWidth > w.clientWidth + 1,
      koepfe: [...t.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().right > w.getBoundingClientRect().right + 1).map(th => th.textContent.trim()),
      zustand: t.querySelector('tbody tr:first-child select').getBoundingClientRect().width }; })()`);
  assert.equal(m.text, 'Der Kaufpreis kann nicht negativ sein.');
  assert.equal(m.eigeneZeile, true, 'keine Meldungszeile unter der Zeile');
  assert.equal(m.spalten, m.zellen, 'Meldung über alle Spalten');
  assert.equal(m.rollt, false, 'Tabelle rollt seitlich');
  assert.deepEqual(m.koepfe, [], 'Spalten rutschen aus dem Bild');
  assert.ok(m.zustand >= 80, `„Zustand“ nur ${m.zustand} px breit`);
  await eingeben('12,x');
  await bis(
    `/„12,x“ ist kein Betrag/.test(${text('.acq-tabelle .feld-fehler')})`,
    'Unlesbares heisst weiter „kein Betrag“',
  );
  await eingeben('199,99');
  await bis(`document.querySelector('.feld-fehler-zeile')?.hidden === true`, 'Meldungszeile verschwindet');
  await b.auswerten(SCHLIESSEN);
}

async function finanzenTelefon(_t, a) {
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
    // N1: Zwischen „Brick 2 x 4“ und „(Schwarz)“ steht ein Wortabstand.
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

async function setnummerFelder(_t, a) {
  const { b } = a;
  const felder =
    await b.auswerten(`['add-num', 'mk-num', 'pl-setnr', 'alarm-neu-set'].map(id => { const f = document.getElementById(id);
    return [id, f.inputMode || '', f.getAttribute('autocapitalize'), f.getAttribute('autocorrect'), f.spellcheck]; })`);
  for (const [id, modus, gross, korrektur, rechtschreibung] of felder) {
    assert.notEqual(modus, 'numeric', `${id}: Zifferntastatur ohne Bindestrich und Buchstaben`);
    assert.equal(gross, 'off', `${id}: Grossschreibung`);
    assert.equal(korrektur, 'off', `${id}: Autokorrektur`);
    assert.equal(rechtschreibung, false, `${id}: Rechtschreibprüfung`);
  }
}

async function kachelKaeufe(_t, a) {
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

async function zeitpunkteMitTag(_t, a) {
  const { b, bis, db } = a;
  const morgen = new Date();
  morgen.setDate(morgen.getDate() + 1);
  morgen.setHours(10, 3, 0, 0);
  const spaeter = new Date(morgen);
  spaeter.setDate(spaeter.getDate() + 2);
  for (const wann of [morgen, spaeter])
    await db.run(`INSERT INTO auftraege (art, faellig_ab) VALUES ('konto_dateien', $1)`, [wann.toISOString()]);
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

async function legendeZusammen(_t, a) {
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

async function schrift200Telefon(_t, a) {
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

async function passwortwechsel(_t, a) {
  const { b } = a;
  const p = await b.auswerten(`(() => { const k = document.getElementById('pw-pk');
    const ids = (k.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
    return { etikett: k.closest('label').textContent.replace(/\\s+/g, ' ').trim(),
      beschreibung: ids.map(id => document.getElementById(id)?.textContent.trim() || '').join(' ') }; })()`);
  assert.equal(p.etikett, 'Auch alle Passkeys entfernen');
  assert.match(p.beschreibung, /^Empfohlen: Ein Passkey, den jemand Fremdes angelegt hat/);
}

test('UX-Prüfung 20 im Browser', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await starteApp(t, { name: `r20_pruefer_${process.pid}`, bestand: musterHaushalt });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Finanzen ohne Verbindung', finanzenOffline],
    ['Kaufpreis-Dialog', kaufpreisDialog],
    ['Finanzen am Telefon', finanzenTelefon],
    ['Setnummer-Felder', setnummerFelder],
    ['Kachel mit mehreren Käufen', kachelKaeufe],
    ['Zeitpunkte mit Tag', zeitpunkteMitTag],
    ['Legende hält zusammen', legendeZusammen],
    ['200 % Schrift am Telefon', schrift200Telefon],
    ['Passwortwechsel', passwortwechsel],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.auswerten(SCHLIESSEN);
    await t.test(name, () => fn(t, a));
  }
});
