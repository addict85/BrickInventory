/**
 * Befunde der UI-Prüfung 12 im echten Browser, mit einem Haushalt (Unterkonto
 * mit demselben Set): Finanzen nennen je Zeile das Konto und zählen nichts
 * doppelt, Dialoge gegen ein fremdes Konto nennen es, Vorleser hören Logo und
 * Kartennamen nicht doppelt, und am Telefon verdecken weder Toasts den Titel
 * noch der gesperrte Knopf den Inhalt.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel bzw. dist neu gebaut):
 *   A  computeSetsValuation sammelt die Käufe wieder nur nach Setnummer →
 *      rot: „Finanzen: ein Kauf je Zeile, mit Konto“ (4 Zeilen Tree House)
 *   B  setsMitErfassungen ohne GROUP BY → rot: „Finanzen: Summen ohne
 *      Doppelzählung“ (Kaufpreise 2149.97 statt 1739.98)
 *   C  delUser wieder mit tRaw('users.delete.title') und dem Knopf
 *      confirm.btn.konto_loeschen → rot: „Löschdialog nennt das Konto“
 *   D  aria-hidden am Kopf-Logo entfernt → rot: „Logo und Kartennamen
 *      einmal“ (img „BIM 6+“)
 *   E  Platzhalter der Kachel wieder role="img" aria-label=Setname → rot:
 *      „Logo und Kartennamen einmal“ (Titanic zweimal im Namen)
 *   F  openSetItemDetail wieder ohne colorName → rot: „Farbname deutsch“
 *   G  die Regel :root .btn.knopf-schwebend:disabled entfernt → rot:
 *      „offline: Knopf deckend“ (opacity 0.5)
 *   H  #toasts am Telefon wieder oben → rot: „Toast verdeckt den Titel nicht“
 *   I  in api() die frühe Meldung bei 401 entfernt → rot: „401 ohne success“
 *   K  .user-tbl-Regeln in mobile.css entfernt → rot: „Benutzerkarte beginnt
 *      mit dem Namen“
 *   L  achsenBetrag ohne die Kurzform → rot: „200 %: Achse kurz, Kopf weicht“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

test('UI-Prüfung 12: Haushalt, Dialoge, Telefon', { timeout: 280_000 }, async t => {
  const NAME = `r12_${process.pid}`,
    KIND = `${NAME}_kind`,
    ANDERE = `r12x_${process.pid}`;
  const app = await starteApp(t, { name: NAME, bestand: musterHaushalt });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const geh = async pfad => {
    await b.auswerten(`location.hash = '#/${pfad}'; true`);
    await warte(300);
  };
  const telefon = an =>
    b.tab(
      'Emulation.setDeviceMetricsOverride',
      an
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
        : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    );

  await t.test('Finanzen: ein Kauf je Zeile, mit Konto', async () => {
    await geh('finanzen');
    await bis(`!!document.querySelector('#fin-tbl [data-fin-art="sets"] tfoot')`, 'Finanzen geladen', 200);
    const zeilen = await b.auswerten(`[...document.querySelectorAll('#fin-tbl [data-fin-art="sets"] tbody tr')]
      .filter(r => r.textContent.includes('Tree House')).map(r => [...r.querySelectorAll('.besitzer-badge')].map(x => x.textContent.replace('Konto: ', '')))`);
    assert.deepEqual(
      zeilen.map(z => z.join()).sort(),
      [KIND, `${NAME} (ich)`].sort(),
      'je Kauf eine Zeile mit ihrem Konto',
    );
    assert.match(
      await b.auswerten(text('#fin-tbl .fin-legende')),
      /Kaufpreis dieser Zeile/,
      'die Legende erklärt die Prozente',
    );
  });

  await t.test('Finanzen: Summen ohne Doppelzählung', async () => {
    const z =
      await b.auswerten(`Promise.all([fetch('/api/v1/finance/pnl').then(r => r.json()), fetch('/api/v1/finance/valuation').then(r => r.json())])
      .then(([p, v]) => ({ kauf: p.totals.sets_purchase, markt: v.totals.avg, baum: p.sets.filter(s => s.set_number === '21318-1').map(s => s.quantity) }))`);
    // 679,99 + 650 + 0 (Geschenk) + 199,99 + 210; Marktwert 712,40 + 801,50 + 163,80 + 2 × 186,20.
    assert.deepEqual(z, { kauf: '1739.98', markt: '2050.10', baum: [2] });
  });

  await t.test('Löschdialog nennt das Konto', async () => {
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true)`,
      [ANDERE, `${ANDERE}@example.org`],
    );
    await geh('einstellungen/benutzer');
    await bis(
      `[...document.querySelectorAll('#users-tbl tr')].some(r => r.textContent.includes(${JSON.stringify(ANDERE)}))`,
      'Benutzerliste',
      100,
    );
    for (const [aktion, titel] of [
      ['delUser', /^Konto „r12x_\d+“ löschen\?$/],
      ['toggleAdmin', /^„r12x_\d+“ zum Verwalter machen\?$/],
      ['toggleAktiv', /^Konto „r12x_\d+“ deaktivieren\?$/],
    ]) {
      await b.auswerten(`(() => { const z = [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(ANDERE)});
        z.querySelector('[data-click="${aktion}"]').click(); return true; })()`);
      await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, `Dialog ${aktion}`);
      assert.match(await b.auswerten(text('#cd-title')), titel);
      if (aktion === 'delUser')
        assert.match(await b.auswerten(text('#cd-confirm')), new RegExp(`${ANDERE}“ endgültig löschen`));
      await b.auswerten(klick('#cd-cancel'));
      await bis(`getComputedStyle(document.getElementById('confirm-modal')).display === 'none'`, 'Dialog zu');
    }
    await db.run('DELETE FROM users WHERE username = $1', [ANDERE]);
  });

  await t.test('Logo und Kartennamen einmal', async () => {
    await geh('sammlung');
    await bis(`!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await b.tab('Accessibility.enable');
    const { nodes } = await b.tab('Accessibility.getFullAXTree');
    const namen = nodes.filter(n => !n.ignored && n.name?.value).map(n => `${n.role?.value}: ${n.name.value}`);
    assert.deepEqual(
      namen.filter(n => /BIM|6\+/.test(n)),
      [],
      'das Logo wird nicht vorgelesen',
    );
    // Seit UI-Prüfung 22 nur Nummer und Name; der Rest ist Beschreibung.
    const karte = namen.find(n => n === 'button: 10294-1 Titanic');
    assert.ok(karte, 'Kachel Titanic als Knopf');
    assert.equal(karte.match(/Titanic/g).length, 1, `Name einmal: ${karte}`);
  });

  await t.test('Farbname deutsch', async () => {
    await geh('teile');
    await bis(
      `!!document.querySelector('.part-card[data-click="openSetItemDetail"][data-arg3="0"]')`,
      'Teile aus Sets',
    );
    await b.auswerten(klick('.part-card[data-click="openSetItemDetail"][data-arg3="0"]'));
    await bis(
      `document.getElementById('setitem-modal').classList.contains('open') && /·/.test(document.getElementById('setitem-sub').textContent)`,
      'Teil-Dialog',
    );
    assert.match(await b.auswerten(text('#setitem-sub')), /· Schwarz$/);
    await b.auswerten(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  });

  await t.test('Platzhalter sieht nicht aus wie ein Wert', async () => {
    const z = await b.auswerten(`(() => { const f = document.getElementById('alarm-neu-set');
      return { text: f.placeholder, stil: getComputedStyle(f, '::placeholder').fontStyle }; })()`);
    assert.deepEqual(z, { text: 'z. B. 75192-1', stil: 'italic' });
  });

  // ── Telefon ───────────────────────────────────────────────────────────────
  await telefon(true);

  await t.test('Merkliste: Liste vor dem Formular', async () => {
    await geh('merkliste');
    await bis(`!!document.querySelector('#mk-list .mk-zeile')`, 'Merkliste');
    const z = await b.auswerten(`({ offen: document.getElementById('mk-kasten').open,
      oben: document.querySelector('#mk-list .mk-zeile').getBoundingClientRect().top, hoehe: innerHeight })`);
    assert.equal(z.offen, false, 'Formular am Telefon zugeklappt');
    assert.ok(z.oben < z.hoehe * 0.6, `erster Merkposten im ersten Bild: ${JSON.stringify(z)}`);
  });

  await t.test('Toast verdeckt den Titel nicht', async () => {
    await geh('sammlung/set/99999-9');
    await bis(
      `[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`,
      'Toast',
    );
    await b.auswerten(`scrollTo(0, 0); true`);
    await ruhig();
    const z = await b.auswerten(`(() => { const r = e => e.getBoundingClientRect();
      const toast = r(document.querySelector('#toasts .toast')), titel = r(document.querySelector('#tab-gallery h1')), leiste = r(document.querySelector('nav.tabs, nav:not(.einst-nav)'));
      return { ueberTitel: toast.top < titel.bottom && toast.bottom > titel.top, ueberLeiste: toast.bottom <= leiste.top + 1, unten: toast.top > innerHeight / 2 }; })()`);
    assert.deepEqual(z, { ueberTitel: false, ueberLeiste: true, unten: true });
    await b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);
  });

  await t.test('offline: Knopf deckend', async () => {
    await geh('sammlung');
    await b.tab('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    try {
      await bis(`document.querySelector('.knopf-schwebend')?.disabled === true`, 'Knopf gesperrt');
      const z = await b.auswerten(`(() => { const s = getComputedStyle(document.querySelector('.knopf-schwebend'));
        return { deckend: s.opacity, grund: s.backgroundColor }; })()`);
      assert.equal(z.deckend, '1', 'der gesperrte Knopf ist deckend');
      assert.doesNotMatch(z.grund, /rgba\(.*, 0(\.\d+)?\)$/, `mit deckendem Grund: ${z.grund}`);
    } finally {
      await b.tab('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await b.auswerten(`dispatchEvent(new Event('online')); true`);
    }
    await bis(`document.querySelector('.knopf-schwebend')?.disabled === false`, 'wieder frei', 100);
  });

  await t.test('Benutzerkarte beginnt mit dem Namen', async () => {
    await geh('einstellungen/benutzer');
    await bis(`!!document.querySelector('#users-tbl tbody tr')`, 'Benutzerliste');
    const z = await b.auswerten(`(() => { const zeilen = [...document.querySelectorAll('#users-tbl tbody tr')];
      return { erste: zeilen.map(r => [...r.cells].find(c => c.checkVisibility()).textContent.trim()), namen: zeilen.map(r => r.querySelector('strong').textContent),
        ids: [...document.querySelectorAll('#users-tbl .nutzer-id')].filter(c => c.checkVisibility()).length }; })()`);
    assert.ok(z.namen.includes(NAME), 'Testdaten: das eigene Konto steht in der Liste');
    assert.deepEqual(z.erste, z.namen, 'jede Karte beginnt mit dem Namen');
    assert.equal(z.ids, 0, 'die ID steht am Telefon nicht');
  });

  await t.test('Gutschein: eine Knopfgrösse', async () => {
    await b.auswerten(klick('.umenu-item[data-arg="gutscheine"]'));
    await bis(`!!document.querySelector('.voucher-row')`, 'Gutscheine');
    const groessen = await b.auswerten(
      `[...document.querySelectorAll('.voucher-row :is(.v-btn, .btn)')].filter(k => k.checkVisibility()).map(k => getComputedStyle(k).fontSize)`,
    );
    assert.ok(groessen.length >= 4, `nur ${groessen.length} Knöpfe`);
    assert.equal(new Set(groessen).size, 1, `Schriftgrössen ${groessen}`);
  });

  await t.test('200 %: Achse kurz, Kopf weicht', async () => {
    await b.auswerten(
      `document.documentElement.style.fontSize = '200%'; document.getElementById('portfolio-chart').innerHTML = ''; true`,
    );
    try {
      await geh('sammlung');
      await geh('finanzen');
      await bis(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm', 200);
      assert.ok(
        await b.auswerten(
          `[...document.querySelectorAll('#portfolio-chart svg text')].some(x => /Tsd\\./.test(x.textContent))`,
        ),
        'Tausender kurz',
      );
      await b.auswerten(`scrollTo(0, 0); true`);
      await warte(200);
      await b.auswerten(`scrollTo(0, 600); true`);
      await warte(400);
      const z = await b.auswerten(
        `({ kopf: getComputedStyle(document.querySelector('header')).transform, leiste: getComputedStyle(document.querySelector('nav:not(.einst-nav)')).transform })`,
      );
      assert.notEqual(z.kopf, 'none', 'der Kopf weicht beim Rollen');
      assert.notEqual(z.leiste, 'none', 'die Leiste weicht beim Rollen');
    } finally {
      await b.auswerten(`document.documentElement.style.fontSize = ''; scrollTo(0, 0); true`);
    }
  });

  await t.test('401 ohne success beendet die Sitzung', async () => {
    // Wie ein vorgeschalteter Proxy: 401 ohne JSON-Feld success.
    await b.auswerten(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('/api/v1/wanted')
      ? Promise.resolve(new Response('{"message":"Unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } })) : f(u, o); return true; })()`);
    await geh('merkliste');
    await bis(
      `getComputedStyle(document.getElementById('login-screen')).display !== 'none' && !document.getElementById('login-hinweis').hidden`,
      'Anmeldung mit Hinweis',
    );
    assert.match(await b.auswerten(text('#login-hinweis')), /Sitzung abgelaufen/);
  });
});
