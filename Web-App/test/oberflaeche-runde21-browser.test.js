/**
 * UX-Prüfung 21 im echten Chrome, im Haushalt (musterHaushalt): Sitzungsfrage ohne Antwort (M1), Abfragen der
 * Hintergrundarbeiten (M1), ResizeObserver bei 200 % Schrift (M2), Rechenbasis der Finanzen (N1), Leeren ohne
 * Zahl (N2), Neuladen nach Fehler (N3), Design sofort (N4), Benutzer anlegen (N5), Merkposten-Detail (N6, N11),
 * Bezugslinie im Diagramm (N7), Auftragsrollen (N9), gesperrte Zeitraumknöpfe ohne Verbindung (N11).
 *
 * Gegenproben (13.11.2026 gemessen in drei Läufen, je Prüfung höchstens eine Änderung, Bündel neu gebaut):
 *   A  checkAuth() ohne die Prüfung auf `loggedIn` → rot: „Sitzung ungeklärt“ (Anmeldemaske sichtbar)
 *   B  monitor.js plant die nächste Runde ohne wennSichtbar() → rot: „Hintergrundarbeiten“ (Abfrage im
 *      verborgenen Tab)
 *   C  fehlerfang.js meldet wieder jedes Ereignis ohne Fehlerobjekt → rot: „200 % Schrift“ (roter Toast)
 *   D  finance.js immer mit 'finance.basis.gerechnet' → rot: „Rechenbasis“
 *   T  wertkurve.js zeichnet wieder im ResizeObserver selbst nach → rot: „200 % Schrift“ (Schleife)
 *   E  settings.js wieder mit `z?.prices || 0` ohne Ersatztext → rot: „Leeren ohne Zahl“ („Löscht 0 …“)
 *   F  merkliste.js wieder mit dem Selektor `.mk-zeile, .leer` → rot: „Neuladen nach Fehler“ (Merkliste)
 *   G  loadMinifigs() ohne das Gerüst → rot: ebenda (Figuren)
 *   H  #mon-app-theme ohne data-change → rot: „Design sofort“
 *   I  btn-cu bricht wieder nach dem ersten Feldfehler ab → rot: „Benutzer anlegen“ (nur eine Meldung)
 *   K  styles.css ohne `.nutzer-neu{align-items:flex-start}` → rot: ebenda (Eingabefelder versetzt)
 *   L  mobile.css ohne die volle Breite für .nutzer-neu > .fg → rot: ebenda (390 px)
 *   M  #mk-m-del wieder frei in der Fusszeile statt unter „Weitere Aktionen“ → rot: „Merkposten-Detail“
 *   N  mk-m-sub wieder mit der Nummer ohne Namen → rot: ebenda
 *   O  portfolioChartSVG() ohne Legende (unterDemBild = false) → rot: „Bezugslinie bei 320 px“
 *   R  monitor.js ohne Rolle am Auftragsnamen → rot: „Hintergrundarbeiten“
 *   S  styles.css ohne `.period-btn:disabled` → rot: „Finanzen ohne Verbindung“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const SCHLIESSEN = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const NETZ = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const ZWISCHENSPEICHER_LEEREN = `Object.keys(sessionStorage).filter(k => k.startsWith('bim_api:')).forEach(k => sessionStorage.removeItem(k)); true`;

async function groesse(b, breite, hoehe = 900) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: breite <= 640,
  });
}
const reiter = (b, tab) =>
  b.auswerten(`document.querySelector('.ntab[data-tab="${tab}"]').click(); scrollTo(0, 0); true`);

/**
 * Anfragen, deren URL `enthaelt` enthält, beantwortet `tun(requestId)` (CDP Fetch); zurück kommt das Ende.
 * @param {{ enthaelt: string, tun: (id: string) => Promise<unknown> }[]} regeln
 */
async function abfangen(b, regeln) {
  await b.tab('Fetch.enable', {
    patterns: regeln.map(r => ({ urlPattern: `*${r.enthaelt}*`, requestStage: 'Request' })),
  });
  const hoerer = d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const r = regeln.find(x => d.params.request.url.includes(x.enthaelt));
    (r ? r.tun(d.params.requestId) : b.tab('Fetch.continueRequest', { requestId: d.params.requestId })).catch(() => {});
  };
  b.hoerer.push(hoerer);
  return async () => {
    b.hoerer.splice(b.hoerer.indexOf(hoerer), 1);
    await b.tab('Fetch.disable');
  };
}
const antworte = (b, id, status, rumpf, kopf = []) =>
  b.tab('Fetch.fulfillRequest', {
    requestId: id,
    responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...kopf],
    body: Buffer.from(JSON.stringify(rumpf)).toString('base64'),
  });
const spaeter = (b, ms) => id =>
  new Promise(r => setTimeout(r, ms)).then(() => b.tab('Fetch.continueRequest', { requestId: id }));

async function finanzenOffline(_t, a) {
  const { b, bis } = a;
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETZ });
  try {
    await reiter(b, 'finance');
    await bis(`!!document.querySelector('#portfolio-chart .fehler-zustand')`, 'Diagramm nicht verfügbar');
    const k = await b.auswerten(`[...document.querySelectorAll('.zeitraum-wahl .period-btn')].map(k => {
      const s = getComputedStyle(k); return { aus: k.disabled, deckung: +s.opacity, zeiger: s.cursor }; })`);
    assert.equal(k.length, 4);
    for (const z of k) {
      assert.equal(z.aus, true, 'Zeitraumknopf bedienbar');
      assert.ok(z.deckung < 1 && z.zeiger === 'not-allowed', `gesperrt sieht aus wie bedienbar: ${JSON.stringify(z)}`);
    }
  } finally {
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETZ });
  }
  await b.auswerten(`document.querySelector('#fin-tbl [data-click="loadFinance"]')?.click(); true`);
  await bis(`!!document.querySelector('#fin-tbl [data-fin-art="sets"] tfoot')`, 'Finanzen nach dem Neuladen', 200);
}

async function rechenbasis(_t, a) {
  const { b, bis } = a;
  await reiter(b, 'finance');
  await bis(
    `!!document.querySelector('#fin-tbl [data-fin-art="sets"] tbody tr') && !document.getElementById('fin-basis').hidden`,
    'Basiszeile',
  );
  const z = await b.auswerten(`({ basis: ${text('#fin-basis')},
    zeilen: [...document.querySelectorAll('#fin-tbl [data-fin-art] tbody tr')].length })`);
  const von = Number(/von (\d+) Positionen/.exec(z.basis)?.[1]);
  assert.ok(von > 0, `keine Zahl in „${z.basis}“`);
  assert.ok(z.zeilen > von, `Testaufbau: ${z.zeilen} Zeilen, ${von} Positionen`);
  assert.match(
    z.basis,
    /Jede Position zählt einmal, auch wenn die Tabelle sie in mehreren Zeilen zeigt \(je Kauf und Konto\)\./,
  );
}

async function bezugslinieSchmal(_t, a) {
  const { b, bis, ruhig } = a;
  await groesse(b, 320, 800);
  await b.auswerten(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  try {
    await reiter(b, 'finance');
    await bis(`!!document.querySelector('#portfolio-chart svg.diagramm-wert')`, 'Wertkurve');
    await b.auswerten(`document.querySelector('.zeitraum-wahl [data-arg="max"]').click(); true`);
    await bis(`!!document.querySelector('#portfolio-chart svg.diagramm-wert')`, 'Wertkurve neu');
    await ruhig();
    const d = await b.auswerten(`(() => { const s = document.querySelector('#portfolio-chart svg.diagramm-wert');
      const flaeche = s.querySelector('polyline').getBoundingClientRect();
      const leg = s.querySelector('[data-legende="bezug"] text');
      return { imBild: [...s.querySelectorAll('.einstand-linie text')].map(t => t.textContent),
        legende: leg?.textContent.replace(/\\s+/g, ' ') ?? '', legOben: leg?.getBoundingClientRect().top ?? 0,
        flaecheUnten: flaeche.bottom }; })()`);
    assert.deepEqual(d.imBild, [], 'mehrzeilige Beschriftung über der Kurve');
    assert.match(d.legende, /^Kaufpreis/);
    assert.ok(d.legOben > d.flaecheUnten, `Legende ${d.legOben} px, Kurve endet ${d.flaecheUnten} px`);
  } finally {
    await b.auswerten(`document.documentElement.style.removeProperty('font-size'); true`);
    await groesse(b, 1280);
  }
}

async function schrift200(_t, a) {
  const { b, bis, ruhig } = a;
  await b.auswerten(
    `window.__ro = 0; addEventListener('error', e => { if (/ResizeObserver/.test(e.message)) window.__ro++; }); true`,
  );
  const fehlerToasts = `[...document.querySelectorAll('#toasts .toast.error')].filter(t => /Unerwarteter Fehler/.test(t.textContent)).length`;
  // Das Ereignis, wie Chrome es schickt: ohne Fehlerobjekt.
  await b.auswerten(
    `dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })); true`,
  );
  assert.equal(await b.auswerten(fehlerToasts), 0, 'roter Toast für die ResizeObserver-Meldung');
  await b.auswerten(`window.__ro = 0; true`);
  await b.auswerten(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  try {
    for (const breite of [320, 390])
      for (const tab of ['settings', 'gallery', 'finance']) {
        await groesse(b, breite, 760);
        await reiter(b, tab);
        await bis(`document.querySelector('.ntab[data-tab="${tab}"]').classList.contains('active')`, tab);
        await ruhig();
        await b.auswerten(`(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) {
          scrollTo(0, y); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); } return true; })()`);
      }
    const z = await b.auswerten(`({ ro: window.__ro, toasts: ${fehlerToasts} })`);
    assert.equal(z.toasts, 0, 'roter Toast „Unerwarteter Fehler“');
    assert.equal(z.ro, 0, 'ResizeObserver-Schleife');
  } finally {
    await b.auswerten(`document.documentElement.style.removeProperty('font-size'); scrollTo(0, 0); true`);
    await groesse(b, 1280);
  }
}

async function leerenOhneZahl(_t, a) {
  const { b, bis } = a;
  const aus = await abfangen(b, [
    {
      enthaelt: '/api/v1/admin/cache-stats',
      tun: id => antworte(b, id, 503, { success: false, error: 'Server ausgelastet' }),
    },
  ]);
  try {
    await b.auswerten(`document.getElementById('btn-clr-prices').click(); true`);
    await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Rückfrage');
    const msg = await b.auswerten(text('#cd-msg'));
    assert.doesNotMatch(msg, /\b0 gespeicherte/, 'unbekannte Zahl als 0');
    assert.match(msg, /^Löscht alle gespeicherten Marktpreise\./);
  } finally {
    await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
    await aus();
  }
}

/** Erst offline in den Fehlerzustand, dann langsam am Netz: Während des neuen Versuchs steht das Gerüst da. */
async function neuNachFehler(b, bis, tab, ziel, pfad) {
  await b.auswerten(ZWISCHENSPEICHER_LEEREN);
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETZ });
  let aus = async () => {};
  try {
    await reiter(b, tab);
    await bis(`!!document.querySelector('${ziel} .fehler-zustand')`, `${tab}: Fehlerzustand`);
    aus = await abfangen(b, [{ enthaelt: pfad, tun: spaeter(b, 3000) }]);
  } finally {
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETZ });
  }
  try {
    await b.auswerten(`document.querySelector('${ziel} .fehler-zustand [data-click]')?.click(); true`);
    await bis(
      `!document.querySelector('${ziel} .fehler-zustand') && !!document.querySelector('${ziel} [aria-busy="true"]')`,
      `${tab}: Gerüst statt altem Fehler`,
      25,
    );
    await bis(`!document.querySelector('${ziel} [aria-busy="true"], ${ziel} .fehler-zustand')`, `${tab}: geladen`, 100);
  } finally {
    await aus();
  }
}

async function neuladenNachFehler(_t, a) {
  await neuNachFehler(a.b, a.bis, 'wanted', '#mk-list', '/api/v1/wanted?');
  await neuNachFehler(a.b, a.bis, 'minifigs', '#figs-list', '/api/v1/minifigs?');
}

async function merkpostenDetail(_t, a) {
  const { b, bis, ruhig } = a;
  await reiter(b, 'wanted');
  await bis(`!!document.querySelector('#mk-list .mk-zeile[data-arg^="10276-1|"]')`, 'Merkposten');
  await b.auswerten(`document.querySelector('#mk-list .mk-zeile[data-arg^="10276-1|"]').click(); true`);
  await bis(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Detail');
  await ruhig();
  const d = await b.auswerten(`(() => { const f = document.querySelector('#mk-detail-modal .mfooter');
    const sichtbar = [...f.querySelectorAll('button, a, summary')].filter(e => e.checkVisibility());
    const loeschen = document.getElementById('mk-m-del');
    return { erste: sichtbar[0]?.className, loeschenSichtbar: loeschen.checkVisibility(),
      imMenue: !!loeschen.closest('details.mehr-menue'), titel: ${text('#mk-m-tit')}, unter: ${text('#mk-m-sub')} }; })()`);
  assert.doesNotMatch(d.erste || '', /\bbd\b/, 'roter Knopf als erste Aktion');
  assert.equal(d.loeschenSichtbar, false, 'Löschen ohne „Weitere Aktionen“ sichtbar');
  assert.equal(d.imMenue, true, 'Löschen nicht unter „Weitere Aktionen“');
  assert.equal(d.titel, '10276-1', 'Testaufbau: Merkposten ohne Katalognamen');
  assert.equal(d.unter, 'Neuware', 'Nummer doppelt im Kopf');
  await b.auswerten(`document.querySelector('#mk-detail-modal .mehr-menue summary').click(); true`);
  await bis(`document.getElementById('mk-m-del').checkVisibility()`, 'Löschen im Menü');
  await b.auswerten(SCHLIESSEN);
}

async function benutzerAnlegen(_t, a) {
  const { b, bis } = a;
  await groesse(b, 1280);
  await reiter(b, 'settings');
  await b.auswerten(`document.querySelector('.einst-link[data-arg="usermgmt"]').click(); true`);
  await bis(`document.getElementById('btn-cu')?.checkVisibility()`, 'Benutzerverwaltung');
  const setze = (id, wert) =>
    b.auswerten(`(() => { const f = document.getElementById('${id}'); f.value = ${JSON.stringify(wert)};
      f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const stand = `(() => { const r = id => document.getElementById(id).getBoundingClientRect();
    const sicht = id => !!document.getElementById(id)?.checkVisibility();
    const zeile = document.querySelector('.nutzer-neu').getBoundingClientRect();
    return { nameFehler: sicht('nu-n-fehler') ? ${text('#nu-n-fehler')} : '', pwFehler: sicht('nu-p-fehler') ? ${text('#nu-p-fehler')} : '',
      nameRegel: sicht('nu-n-regel'), pwRegel: sicht('nu-p-regel'),
      oben: [r('nu-n').top, r('nu-p').top].map(Math.round), haken: (r('nu-a').top + r('nu-a').bottom) / 2,
      feld: [r('nu-n').top, r('nu-n').bottom], zeile: zeile.width,
      breiten: ['nu-p', 'nu-a'].map(id => document.getElementById(id).closest('.fg').getBoundingClientRect().width) }; })()`;
  await setze('nu-n', '');
  await setze('nu-p', '');
  await b.auswerten(`document.getElementById('btn-cu').click(); true`);
  await bis(`!!document.getElementById('nu-p-fehler')?.checkVisibility()`, 'Meldungen');
  let s = await b.auswerten(stand);
  assert.equal(s.nameFehler, 'Bitte einen Benutzernamen eintragen.');
  assert.equal(s.pwFehler, 'Bitte ein Passwort eintragen.', 'nur eine Meldung auf einmal');
  assert.deepEqual([s.nameRegel, s.pwRegel], [false, false], 'Regel und Meldung zugleich');
  assert.equal(await b.auswerten('document.activeElement.id'), 'nu-n', 'Fokus beim ersten Fehler');
  // Nur der Name falsch: neben der Meldung steht die Passwortregel, die Felder bleiben auf einer Höhe.
  await setze('nu-p', 'Ziegel-Turm-Fenster-42');
  await setze('nu-n', 'a b');
  await b.auswerten(`document.getElementById('btn-cu').click(); true`);
  await bis(`!!document.getElementById('nu-n-fehler')?.checkVisibility()`, 'Meldung am Namen');
  s = await b.auswerten(stand);
  assert.equal(s.pwFehler, '');
  assert.equal(s.pwRegel, true, 'Passwortregel fehlt');
  assert.equal(s.oben[0], s.oben[1], `Eingabefelder versetzt: ${s.oben}`);
  assert.ok(s.haken > s.feld[0] && s.haken < s.feld[1], `Häkchen ${s.haken} neben Feld ${s.feld}`);
  try {
    await groesse(b, 390, 844);
    await bis(`innerWidth === 390`, 'Telefonbreite');
    s = await b.auswerten(stand);
    for (const w of s.breiten) assert.ok(w >= s.zeile - 1, `${w} px von ${s.zeile} px`);
  } finally {
    await setze('nu-n', '');
    await setze('nu-p', '');
    await groesse(b, 1280);
  }
}

async function designSofort(_t, a) {
  const { b, bis, db } = a;
  await reiter(b, 'settings');
  await bis(`!!document.getElementById('mon-app-theme')?.value`, 'Design-Auswahl');
  assert.equal(await b.auswerten(`!!document.getElementById('btn-save-theme')`), false, 'Speichern-Knopf');
  await b.auswerten(`(() => { const s = document.getElementById('mon-app-theme'); s.value = 'brick';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(
    `/Gespeichert/.test(document.getElementById('mon-app-theme').nextElementSibling?.textContent || '')`,
    'Bestätigung am Feld',
  );
  const w = await db.get(`SELECT value FROM global_settings WHERE key = 'app_theme'`);
  assert.equal(w?.value, 'brick');
  await b.auswerten(`(() => { const s = document.getElementById('mon-app-theme'); s.value = 'classic';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(`document.documentElement.dataset.theme !== 'brick'`, 'zurück auf Klassisch');
}

async function hintergrundarbeiten(_t, a) {
  const { b, bis, ruhig, db } = a;
  await db.run(`DELETE FROM auftraege WHERE art = 'wechselkurse'`);
  await db.run(
    `INSERT INTO auftraege (art, schluessel, faellig_ab) VALUES ('wechselkurse', 'plan:wechselkurse', NOW() + interval '5 hours')`,
  );
  await db.run(`INSERT INTO auftraege (art, versuche, max_versuche, fehler, faellig_ab)
                VALUES ('wechselkurse', 3, 6, 'ECONNRESET', NOW() + interval '1 hour')`);
  const abrufe = [];
  const zaehler = d => {
    if (d.method === 'Network.requestWillBeSent' && d.params.request.url.includes('/api/v1/admin/jobs'))
      abrufe.push(Date.now());
  };
  b.hoerer.push(zaehler);
  try {
    await b.auswerten(`document.getElementById('ntab-monitor').click(); true`);
    await bis(`/Wechselkurse/.test(document.getElementById('tab-monitor').textContent)`, 'Aufträge');
    await b.auswerten(`document.querySelector('.mon-einzeln')?.setAttribute('open', ''); true`);
    const zeilen = await b.auswerten(`[...document.querySelectorAll('#tab-monitor .mon-einzeln tbody tr')]
      .filter(r => r.textContent.includes('Wechselkurse')).map(r => r.querySelector('.mon-rolle')?.textContent || '')`);
    assert.deepEqual(zeilen.sort(), ['Wiederholung nach Fehler', 'regulärer Lauf'], 'Rollen der beiden Läufe');
    await ruhig();
    // Verborgen: keine Abfrage, auch über die 15 s des ruhigen Takts hinaus.
    await b.auswerten(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange')); true`);
    const ab = Date.now();
    for (const ende = ab + 17_000; Date.now() < ende; ) await warte(250);
    assert.deepEqual(
      abrufe.filter(z => z > ab),
      [],
      'Abfrage im verborgenen Tab',
    );
    await b.auswerten(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true`);
    await bis(`true`, 'sichtbar');
    for (const ende = Date.now() + 3000; !abrufe.some(z => z > ab) && Date.now() < ende; ) await warte(100);
    assert.ok(
      abrufe.some(z => z > ab),
      'sichtbar wieder: keine Abfrage',
    );
  } finally {
    b.hoerer.splice(b.hoerer.indexOf(zaehler), 1);
    await b.auswerten(`delete document.hidden; true`);
    await reiter(b, 'gallery');
  }
}

async function sitzungUngeklaert(_t, a) {
  const { b, bis } = a;
  let art = '429';
  const aus = await abfangen(b, [
    {
      enthaelt: '/api/v1/auth/me',
      tun: id =>
        art === '429'
          ? antworte(
              b,
              id,
              429,
              {
                success: false,
                code: 'zu_viele_anfragen',
                error: 'Zu viele Anfragen — bitte in 1 Min. erneut versuchen',
              },
              [{ name: 'Retry-After', value: '40' }],
            )
          : art === 'netz'
            ? b.tab('Fetch.failRequest', { requestId: id, errorReason: 'InternetDisconnected' })
            : b.tab('Fetch.continueRequest', { requestId: id }),
    },
  ]);
  try {
    await b.tab('Page.reload');
    await bis(
      `!document.getElementById('start-offline')?.hidden && !!document.getElementById('start-offline')`,
      'Kasten',
      200,
    );
    const z = await b.auswerten(`({ maske: getComputedStyle(document.getElementById('login-screen')).display,
      app: getComputedStyle(document.getElementById('app')).display, titel: ${text('#start-offline-titel')},
      text: ${text('#start-offline-text')}, knopf: document.getElementById('start-erneut').checkVisibility() })`);
    assert.equal(z.maske, 'none', 'Anmeldemaske trotz gültiger Sitzung');
    assert.equal(z.app, 'none');
    assert.equal(z.titel, 'Anmeldung konnte nicht geprüft werden');
    assert.match(z.text, /^Zu viele Anfragen — bitte in 1 Min\. erneut versuchen\. Neuer Versuch in (40|39|38) s\.$/);
    assert.equal(z.knopf, true, '„Erneut versuchen“ fehlt');
    art = 'netz';
    await b.auswerten(`document.getElementById('start-erneut').click(); true`);
    await bis(`/Keine Verbindung zum Server/.test(${text('#start-offline-text')})`, 'Grund: kein Netz');
    assert.equal(await b.auswerten(`getComputedStyle(document.getElementById('login-screen')).display`), 'none');
    art = 'durch';
    await b.auswerten(`document.getElementById('start-erneut').click(); true`);
    await bis(
      `getComputedStyle(document.getElementById('app')).display !== 'none' && document.getElementById('start-offline').hidden`,
      'App nach dem neuen Versuch',
      200,
    );
  } finally {
    await aus();
  }
}

test('UX-Prüfung 21 im Browser', { concurrency: 1, timeout: 400_000 }, async t => {
  const a = await starteApp(t, { name: `r21_pruefer_${process.pid}`, bestand: musterHaushalt });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Finanzen ohne Verbindung', finanzenOffline],
    ['Rechenbasis', rechenbasis],
    ['Bezugslinie bei 320 px', bezugslinieSchmal],
    ['200 % Schrift', schrift200],
    ['Leeren ohne Zahl', leerenOhneZahl],
    ['Neuladen nach Fehler', neuladenNachFehler],
    ['Merkposten-Detail', merkpostenDetail],
    ['Benutzer anlegen', benutzerAnlegen],
    ['Design sofort', designSofort],
    ['Hintergrundarbeiten', hintergrundarbeiten],
    ['Sitzung ungeklärt', sitzungUngeklaert],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.auswerten(SCHLIESSEN);
    await t.test(name, () => fn(t, a));
  }
});
