/**
 * UX-Prüfung 22 im echten Chrome, im Haushalt mit Lagerort: M4 und N1–N13
 * (Namen der Kacheln bis Set-Detail). M3 prüft sammlung-kopf-browser, M1 und
 * M2 fehler-ohne-sprung-browser.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  kachelName(): Teile ohne aria-hidden → rot: „Kachelnamen“, „Merkliste“
 *   B  Katalogabfrage der Merkliste ohne `if (w.name)` → rot: „Merkliste: Set
 *      nicht im Katalog“ (Anfrage an /catalog/sets/10276-1)
 *   C  ownerBadges() wieder mit o.username → rot: „Kachelnamen“, „Kontoangaben“
 *   D  `#gallery .scb > .price-badge{order:1}` entfernt → rot: „Preiskasten auf
 *      einer Höhe“ (925 gegen 943)
 *   E  Lagerortraster mit column-gap:8px → rot: „Lagerorte“ (8 px Lücken)
 *   F  --kopf-h fest 58px → rot: „200 % Schrift“ (Knopf 60,5 > Kopf 58)
 *   G  Gutschein-Knöpfe wieder in .zeile → rot: „Menüseiten“ (Speichern links)
 *   H  .alarm-ue-betrag als display:contents → rot: „Menüseiten“ (EUR bei
 *      320 px unter dem Feld)
 *   I  Bauliste nicht in der :has()-Liste des Bands → rot: „Bauliste mit
 *      Schlüsselband“
 *   K  .m-links als display:contents → rot: „Set-Detail nutzt die linke Spalte“
 *   L  `.filter-knopf[aria-expanded="true"]` nie zutreffend → rot: „Telefon“
 *   M  summary::before mit content:none → rot: „Telefon“ (kein Aufklappzeichen)
 *   N  `.bstat::after { line-height: 1 }` entfernt → rot: „Telefon“ (214/214/212)
 *   O  Teileraster wieder 6.75rem → rot: „Telefon“ (nicht zweispaltig)
 *   P  rootMargin wieder fest -64px → rot: „Telefon“ (Titel im Kopf, während
 *      die Überschrift 6 px unter ihm hervorragt)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const SCHLIESSEN = `document.querySelectorAll('.ovl.open [data-dialog-zu]').forEach(x => x.click()); true`;

/** Name und Beschreibung im Barrierebaum, wie ein Vorleser sie bekommt. */
async function vorgelesen(b, sel) {
  const { root } = await b.tab('DOM.getDocument', { depth: 0 });
  const { nodeId } = await b.tab('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  assert.ok(nodeId, `${sel} fehlt`);
  const { nodes } = await b.tab('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  return { name: nodes[0].name?.value || '', beschreibung: nodes[0].description?.value || '' };
}

async function groesse(b, breite, hoehe, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}

async function geh(a, hash, bereit, was) {
  await a.b.auswerten(SCHLIESSEN);
  await a.b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.bis(bereit, was, 200);
  await a.ruhig(5000);
}

async function kachelnamen(_t, a, name) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery [data-arg="21318-1"]')`, 'Sammlung');
  const set = await vorgelesen(b, '#gallery .sc[data-arg="21318-1"]');
  assert.equal(set.name, '21318-1 Tree House');
  assert.match(set.beschreibung, /2019 · Ideas/);
  assert.match(set.beschreibung, /Marktpreis/);
  assert.match(set.beschreibung, new RegExp(`${name} \\(ich\\)`));

  await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
  const teil = await vorgelesen(b, '#tab-parts .part-card');
  assert.match(teil.name, /^\d+ (Brick|Plate) \d x \d \S+$/);
  assert.ok(teil.name.length <= 40, teil.name);
  assert.match(teil.beschreibung, /×12/);

  await geh(a, '#/minifiguren', `!!document.querySelector('#tab-minifigs [role="button"]')`, 'Minifiguren');
  const figur = await vorgelesen(b, '#tab-minifigs [role="button"][data-arg2="fig-000001"]');
  assert.equal(figur.name, 'fig-000001 Marty McFly');

  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  const katalog = await vorgelesen(b, '#catalog-grid .sc[data-arg="10294-1"]');
  assert.equal(katalog.name, '10294-1 Titanic');
  assert.match(katalog.beschreibung, /Teile/);
}

async function merklisteUnbekannt(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/merkliste', `!!document.querySelector('#mk-list .mk-zeile')`, 'Merkliste');
  assert.equal((await vorgelesen(b, '#mk-list .mk-zeile')).name, '10276-1');
  assert.match(await b.auswerten(text('#mk-list .mk-zeile .mk-unter')), /^Set noch nicht im Katalog · Neuware$/);
  const vorher = b.ereignisse.length;
  await b.auswerten(`document.querySelector('#mk-list .mk-zeile').click(); true`);
  await bis(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Merkposten-Detail');
  await a.ruhig(5000);
  assert.match(await b.auswerten(text('#mk-m-det')), /Katalog ?Set noch nicht im Katalog — Name, Jahr und Thema/);
  assert.doesNotMatch(await b.auswerten(text('#mk-m-det')), /Jahr —/);
  const katalogAnfragen = b.ereignisse
    .slice(vorher)
    .filter(e => e.method === 'Network.requestWillBeSent' && /\/catalog\/sets\/10276-1/.test(e.params.request.url));
  assert.equal(katalogAnfragen.length, 0, 'Anfrage an den Katalog, die mit 404 endet');
  await b.auswerten(SCHLIESSEN);
}

async function kontoangaben(_t, a, name) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery [data-arg="21318-1"]')`, 'Sammlung');
  assert.deepEqual(
    await b.auswerten(
      `[...document.querySelectorAll('#gallery .sc[data-arg="21318-1"] .besitzer-badge')].map(e => e.textContent)`,
    ),
    [`${name} (ich)`, `${name}_kind`],
  );
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await bis(`document.querySelectorAll('#m-menge .menge-konto').length === 2`, 'Set-Detail');
  assert.equal(await b.auswerten(text('#m-untertit')), `21318-1 · Konten: ${name} (ich), ${name}_kind`);
  const schrift = await b.auswerten(`({ kopf: getComputedStyle(document.getElementById('m-untertit')).fontFamily,
    nr: getComputedStyle(document.querySelector('#m-untertit .setnr')).fontFamily,
    mono: getComputedStyle(document.documentElement).getPropertyValue('--mono') })`);
  assert.notEqual(schrift.kopf, schrift.nr, 'Konten in Festbreite');
  await b.auswerten(SCHLIESSEN);
}

async function preiskasten(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `document.querySelectorAll('#gallery .price-badge:not([hidden])').length >= 3`, 'Preise');
  const unten = await b.auswerten(`(() => {
    const k = [...document.querySelectorAll('#gallery .sc')].map(c => ({ oben: Math.round(c.getBoundingClientRect().top),
      p: c.querySelector('.price-badge:not([hidden])')?.getBoundingClientRect().bottom }));
    const zeile = k.filter(x => x.oben === k[0].oben && x.p);
    return zeile.map(x => Math.round(x.p)); })()`);
  assert.ok(unten.length >= 3, `zu wenige Kacheln in der ersten Zeile: ${unten}`);
  assert.equal(new Set(unten).size, 1, `Preiskästen auf verschiedenen Höhen: ${unten}`);
}

async function lagerorte(_t, a) {
  const { b } = a;
  await geh(a, '#/lagerorte', `document.querySelectorAll('#storage-list .lager-eingabe').length > 0`, 'Lagerorte');
  const zellen = await b.auswerten(`[...document.querySelector('#storage-list .lager-raster > div').children]
    .map(z => { const r = z.getBoundingClientRect(); return [r.left, r.right, getComputedStyle(z).borderBottomWidth]; })`);
  for (let i = 1; i < zellen.length; i++)
    assert.ok(Math.abs(zellen[i][0] - zellen[i - 1][1]) < 1, `Lücke in der Trennlinie: ${JSON.stringify(zellen)}`);
  assert.equal(
    await b.auswerten(`document.querySelector('#storage-list .lager-eingabe').getAttribute('aria-label')`),
    'Lagerort umbenennen: Regal',
  );
}

async function menueseiten(_t, a) {
  const { b } = a;
  for (const [hash, sel] of [
    ['#/alarme', '#tab-alarme'],
    ['#/lagerorte', '#tab-lagerorte'],
    ['#/gutscheine', '#tab-gutscheine'],
    ['#/konto', '#tab-profil'],
  ]) {
    await geh(a, hash, `document.querySelector('${sel}').classList.contains('active')`, hash);
    const ohne = await b.auswerten(`[...document.querySelectorAll('${sel} h2.stit')].filter(h => h.checkVisibility())
      .filter(h => !h.querySelector('svg')).map(h => h.textContent.trim())`);
    assert.deepEqual(ohne, [], `${hash}: Kartenüberschrift ohne Symbol`);
  }
  // Der Hauptknopf steht rechts unten im Formular.
  await geh(
    a,
    '#/gutscheine',
    `!!document.querySelector('[data-click="gutscheinSpeichern"]')?.checkVisibility()`,
    'Gutschein',
  );
  const rechts = await b.auswerten(`(() => { const k = document.querySelector('[data-click="gutscheinSpeichern"]');
    const f = document.getElementById('v-number').getBoundingClientRect();
    return [k.getBoundingClientRect().right, document.getElementById('v-number').closest('.sform, .ssec').getBoundingClientRect().right, f.right]; })()`);
  assert.ok(rechts[0] > rechts[2] - 2 || rechts[1] - rechts[0] < 40, `Speichern nicht rechts: ${rechts}`);
  // Betrag und Währung des Preisalarms auf einer Linie, auch schmal.
  await groesse(b, 320, 700, true);
  try {
    await geh(a, '#/alarme', `!!document.querySelector('#alerts-list .alarm-ue-feld')`, 'Alarme');
    const lage =
      await b.auswerten(`(() => { const f = document.querySelector('#alerts-list .alarm-ue-feld').getBoundingClientRect(),
      w = document.querySelector('#alerts-list .alarm-ue-waehrung').getBoundingClientRect();
      return { feldOben: f.top, feldUnten: f.bottom, wMitte: (w.top + w.bottom) / 2, wLinks: w.left, feldRechts: f.right }; })()`);
    assert.ok(
      lage.wMitte > lage.feldOben && lage.wMitte < lage.feldUnten,
      `EUR nicht neben dem Feld: ${JSON.stringify(lage)}`,
    );
    assert.ok(lage.wLinks >= lage.feldRechts, 'EUR nicht rechts vom Feld');
  } finally {
    await groesse(b, 1280, 900, false);
  }
}

async function bauliste(_t, a) {
  const { b } = a;
  await b.auswerten(
    `(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hinweis_weg')) localStorage.removeItem(k); return true; })()`,
  );
  await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
  assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').checkVisibility()`), true, 'Band fehlt');
  await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');
  assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').checkVisibility()`), false, 'Band in Finanzen');
}

async function grosseSchrift(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  try {
    await b.auswerten(`document.documentElement.style.fontSize = '32px'; true`);
    await a.ruhig(2000);
    const m = await b.auswerten(`(() => { const r = s => document.querySelector(s).getBoundingClientRect();
      return { kopf: r('header').bottom, knopf: r('.ubadge-knopf').bottom, knopfOben: r('.ubadge-knopf').top, nav: r('nav').top }; })()`);
    assert.ok(m.knopf <= m.kopf && m.knopfOben >= 0, `Kontoknopf ragt aus dem Kopf: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.nav - m.kopf) < 1, `Reiterleiste nicht unter dem Kopf: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
  }
}

async function setDetail(_t, a) {
  const { b, bis } = a;
  for (const [breite, telefon] of [
    [1280, false],
    [390, true],
  ]) {
    await groesse(b, breite, telefon ? 844 : 900, telefon);
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
    await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg')`, 'Preisverlauf');
    const l = await b.auswerten(`(() => { const r = s => document.querySelector(s).getBoundingClientRect().toJSON();
      const zeilen = [...document.querySelectorAll('#m-det > .dr')].map(z => z.getBoundingClientRect().toJSON());
      return { bild: r('#m-img'), chart: r('#m-price-chart'), det: r('#m-det > .dr'), letzte: zeilen.at(-1) }; })()`);
    if (!telefon) {
      assert.ok(l.chart.right <= l.det.left, `Preisverlauf nicht in der linken Spalte: ${JSON.stringify(l)}`);
      assert.ok(l.chart.top >= l.bild.bottom, 'Preisverlauf nicht unter dem Bild');
    } else assert.ok(l.chart.top >= l.letzte.bottom, 'Telefon: Preisverlauf nicht am Ende');
    await b.auswerten(SCHLIESSEN);
  }
  await groesse(b, 1280, 900, false);
}

async function telefon(_t, a) {
  const { b, bis } = a;
  await groesse(b, 390, 844, true);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    const knopf = '#tab-gallery .filter-knopf';
    const zu = await b.auswerten(`getComputedStyle(document.querySelector('${knopf}')).backgroundColor`);
    await b.auswerten(`document.querySelector('${knopf}').click(); true`);
    await bis(`document.querySelector('${knopf}').getAttribute('aria-expanded') === 'true'`, 'Filter offen');
    const offen = await b.auswerten(`getComputedStyle(document.querySelector('${knopf}')).backgroundColor`);
    assert.notEqual(offen, zu, 'Filterknopf offen sieht aus wie zu');
    await b.auswerten(`document.querySelector('${knopf}').click(); true`);

    // Zahlenzeile auf einer Grundlinie.
    const oben =
      await b.auswerten(`[...document.querySelectorAll('#tab-gallery .bstat')].filter(x => x.checkVisibility())
      .map(x => Math.round(x.querySelector('.bstat-v').getBoundingClientRect().bottom))`);
    assert.equal(new Set(oben).size, 1, `Kennzahlen versetzt: ${oben}`);

    // Teile und Figuren in so vielen Spalten wie die Sets.
    await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
    const spalten = await b.auswerten(`new Set([...document.querySelectorAll('#tab-parts .parts-grid')].at(-1)
      .querySelectorAll('.part-card').values().map(k => Math.round(k.getBoundingClientRect().left))).size`);
    assert.equal(spalten, 2, 'Teile nicht zweispaltig');

    // Hintergrundarbeiten: Ragt die Überschrift nur noch wenige Pixel unter dem Kopf hervor, steht der
    // Titel nicht zusätzlich im Kopf.
    await geh(a, '#/hintergrund', `!!document.querySelector('#tab-monitor .ptitle')?.checkVisibility()`, 'Hintergrund');
    await b.auswerten(`(() => { const kopf = document.querySelector('header').getBoundingClientRect().bottom;
      const h = document.querySelector('#tab-monitor .ptitle').getBoundingClientRect();
      window.scrollBy(0, h.bottom - kopf - 6); return true; })()`);
    await a.ruhig(1000);
    const doppelt = await b.auswerten(`(() => { const k = document.getElementById('kopf-sicht');
      const h = document.querySelector('#tab-monitor .ptitle').getBoundingClientRect();
      return { kopf: k.checkVisibility() && k.textContent, ueberstand: h.bottom - document.querySelector('header').getBoundingClientRect().bottom }; })()`);
    assert.ok(!(doppelt.kopf && doppelt.ueberstand > 0), `Titel doppelt: ${JSON.stringify(doppelt)}`);
    await bis(`!!document.querySelector('#auftraege-karte .mon-einzeln > summary')`, 'Einzelne Aufträge');
    const zeichen =
      await b.auswerten(`(() => { const v = getComputedStyle(document.querySelector('#auftraege-karte .mon-einzeln > summary'), '::before');
      return { inhalt: v.content, breite: parseFloat(v.width) }; })()`);
    assert.ok(zeichen.inhalt !== 'none' && zeichen.breite > 3, `kein Aufklappzeichen (${JSON.stringify(zeichen)})`);
  } finally {
    await groesse(b, 1280, 900, false);
  }
}

test('UX-Prüfung 22 im Browser', { concurrency: 1, timeout: 400_000 }, async t => {
  const name = `r22_${process.pid}`;
  const a = await starteApp(t, {
    name,
    bestand: async (db, uid) => {
      await musterHaushalt(db, uid);
      await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal')`, [uid]);
      // Ein Auftrag, damit „Einzelne Aufträge“ als aufklappbare Liste erscheint.
      await db.run(`INSERT INTO auftraege (art, faellig_ab) VALUES ('konto_dateien', NOW() + interval '5 hours')`);
    },
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM auftraege WHERE art = 'konto_dateien' AND status = 'offen'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object, name: string) => Promise<void>][]} */
  const pruefungen = [
    ['Kachelnamen', kachelnamen],
    ['Merkliste: Set nicht im Katalog', merklisteUnbekannt],
    ['Kontoangaben', kontoangaben],
    ['Preiskasten auf einer Höhe', preiskasten],
    ['Lagerorte', lagerorte],
    ['Menüseiten', menueseiten],
    ['Bauliste mit Schlüsselband', bauliste],
    ['200 % Schrift', grosseSchrift],
    ['Set-Detail nutzt die linke Spalte', setDetail],
    ['Telefon', telefon],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a, name));
});
