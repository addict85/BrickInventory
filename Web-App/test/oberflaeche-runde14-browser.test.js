/**
 * Befunde der UI-Prüfung 14 im echten Browser: Registrierung ohne Mailversand
 * und Freischalten, Kategorien, Bestätigungsseite angemeldet, Menüs und
 * schwebender Knopf bei grosser Schrift, Haushalt, Merkliste, Begriffe,
 * Gutscheinkarte, Offline-Band und Fokus nach Esc.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  Kategorie im SQL wieder COALESCE(…, 'Unbekannt') → rot: „Kategorie in
 *      Tabelle und Filter“
 *   B  bestaetigtAngemeldet() wieder location.replace('/') → rot: „Bestätigung
 *      angemeldet“ (kein Toast)
 *   C  .v-mehr > .mehr-liste wieder min-width:14rem → rot: „Weitere Aktionen bei
 *      320 px und 200 %“
 *   D  Container-Regel (max-width: 15em) für den schwebenden Knopf unwirksam
 *      → rot: „Schwebender Knopf bei 200 %“
 *   E  unlinkHousehold() ohne Namen → rot: „Verknüpfung lösen nennt das Konto“
 *   F  ladeMerkliste() klappt das Formular im Fehlerfall nicht zu → rot:
 *      „Merkliste: Fehler 500 über der Falz“
 *   G  Freischalten-Knopf weg / Rolle wieder „Admin“ / Schalter ohne Mail frei
 *      → je rot: „Verwaltung: wartendes Konto, Schalter ohne Mail“
 *   H  .voucher-actions > .mehr-menue wieder flex → rot: „Gutscheinkarte ruhig“
 *   I  Offline-Band wieder mit Datum → rot: „Offline-Band: heute“
 *   K  Rückfall auf die Überschrift in dialoge.js weg → rot: „Fokus nach Esc
 *      bei Direktaufruf“
 *   L  „Registrieren“ wieder <p> / Bestätigen bleibt bp ohne ausstehende
 *      Adresse → je rot: „Bestätigung angemeldet“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt, haeltTeil } = require('./helpers/bestand');
const { buildAndRequire } = require('./helpers/sources');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const offen = `getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`;
const rechteck = sel => `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();
  return r ? { l: Math.round(r.left), r: Math.round(r.right), o: Math.round(r.top), u: Math.round(r.bottom), b: Math.round(r.width) } : null; })()`;
const schneiden = (a, b) => a.l < b.r && b.l < a.r && a.o < b.u && b.o < a.u;

test('UI-Prüfung 14: Registrierung, Kategorien, Telefon, Begriffe', { timeout: 300_000 }, async t => {
  const NAME = `r14_${process.pid}`,
    KIND = `${NAME}_kind`,
    WARTET = `${NAME}_wartet`;
  const app = await starteApp(t, {
    name: NAME,
    bestand: async (db, uid) => {
      await musterHaushalt(db, uid);
      await db.run(
        `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ('99901', 'Rätselteil', '999') ON CONFLICT DO NOTHING`,
      );
      await haeltTeil(db, uid, '99901', { setNumber: '10294-1', colorId: 0, menge: 3 });
      await db.run(
        `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ('99902', 'Kennstein', 'Bricks') ON CONFLICT DO NOTHING`,
      );
      await haeltTeil(db, uid, '99902', { setNumber: '10294-1', colorId: 0, menge: 2 });
      await db.run(
        `INSERT INTO users (username, email_neu, password_hash, is_active, email_verified, registrierung_offen)
      VALUES ($1, $2, 'x', true, false, true)`,
        [WARTET, `${WARTET}@example.org`],
      );
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db, port, uid, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const smtpVorher = await db.all(
    "SELECT key, value FROM global_settings WHERE key IN ('smtp_host', 'smtp_user', 'registration_enabled')",
  );
  await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user', 'registration_enabled')");
  const geh = async pfad => {
    await b.auswerten(`location.hash = '#/${pfad}'; true`);
    await warte(400);
  };
  const zu = async () => {
    await b.auswerten(klick('#cd-cancel'));
    await bis(`!(${offen})`, 'Dialog zu');
  };
  const telefon = (breite, hoehe) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: true });
  const schrift = prozent => b.auswerten(`document.documentElement.style.fontSize = '${prozent}'; true`);

  await telefon(390, 844);

  await t.test('Merkliste: Fehler 500 über der Falz', async () => {
    await b.auswerten(`(() => { const echt = window.fetch; window.__echtFetch = echt;
      window.fetch = (u, o) => String(u).includes('/api/v1/wanted?') ? Promise.resolve(new Response('{"success":false,"error":"kaputt"}', { status: 500, headers: { 'Content-Type': 'application/json' } })) : echt(u, o);
      return true; })()`);
    try {
      await geh('merkliste');
      await bis(`!!document.querySelector('#mk-list .fehler-zustand')`, 'Fehlerzustand');
      const z =
        await b.auswerten(`(() => { const f = document.querySelector('#mk-list .fehler-zustand').getBoundingClientRect();
        return { kasten: document.getElementById('mk-kasten').open, unterLeiste: f.top > document.querySelector('nav:not(.einst-nav)').getBoundingClientRect().top - 40 }; })()`);
      assert.deepEqual(z, { kasten: false, unterLeiste: false });
    } finally {
      await b.auswerten(`window.fetch = window.__echtFetch; true`);
    }
  });

  await t.test('Gutscheinkarte ruhig', async () => {
    await geh('gutscheine');
    await bis(`!!document.querySelector('.voucher-row .voucher-actions')`, 'Gutscheine');
    const z = await b.auswerten(`(() => { const w = (e) => Math.round(e.getBoundingClientRect().width);
      const knopf = [...document.querySelectorAll('.voucher-row .v-btn')].map(w);
      const [a, m] = [document.querySelector('.voucher-actions > .btn'), document.querySelector('.voucher-actions > .mehr-menue > summary')].map(e => e.getBoundingClientRect());
      const unten = ['guthabenAlleAbfragen', 'gutscheineExportieren'].map(k => w(document.querySelector('[data-click="' + k + '"]')));
      return { knopf: [...new Set(knopf)], nebeneinander: Math.round(a.top) === Math.round(m.top), gleich: Math.abs(a.width - m.width) < 2, unten: unten[0] === unten[1] }; })()`);
    assert.deepEqual(z, { knopf: [44], nebeneinander: true, gleich: true, unten: true });
  });

  await t.test('Schwebender Knopf bei 200 %', async () => {
    await geh('sammlung');
    await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
    await schrift('200%');
    try {
      await b.auswerten(`scrollTo(0, 0); true`);
      await warte(300);
      const knopf = await b.auswerten(rechteck('#tab-gallery .knopf-schwebend'));
      for (const sel of [
        '#gs',
        '#tab-gallery .brick-stats',
        '#tab-gallery .filter-knopf',
        // Am Telefon ist der Umschalter die sichtbare Überschrift (UX-Prüfung 19 M4).
        '#tab-gallery .sammlung-wahl',
      ])
        assert.equal(schneiden(knopf, await b.auswerten(rechteck(sel))), false, `über ${sel}`);
    } finally {
      await schrift('');
    }
  });

  await t.test('Offline-Band: heute', async () => {
    await b.tab('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    try {
      await bis(`!document.getElementById('offline-band').hidden`, 'Band');
      assert.match(await b.auswerten(text('#offline-band')), /seit heute, \d\d:\d\d\./);
    } finally {
      await b.tab('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await b.auswerten(`dispatchEvent(new Event('online')); true`);
    }
    await bis(`document.getElementById('offline-band').hidden`, 'wieder online', 100);
  });

  await telefon(320, 640);
  await schrift('200%');

  await t.test('Weitere Aktionen bei 320 px und 200 %', async () => {
    await geh('sammlung/set/10294-1');
    await bis(
      `document.getElementById('set-modal').classList.contains('open') && !document.querySelector('#set-modal .skelett-zeile')`,
      'Set-Dialog',
    );
    await b.auswerten(klick('#set-modal .v-mehr > summary'));
    await bis(`document.querySelector('#set-modal .v-mehr').open`, 'Menü offen');
    const r = await b.auswerten(rechteck('#set-modal .v-mehr > .mehr-liste'));
    assert.ok(r.l >= 0 && r.r <= 320, `Menü von ${r.l} bis ${r.r}`);
    await b.auswerten(`document.querySelector('#set-modal .v-mehr').open = false; true`);
  });

  await t.test('Fokus nach Esc bei Direktaufruf', async () => {
    for (const type of ['rawKeyDown', 'keyUp'])
      await b.tab('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await bis(`!document.getElementById('set-modal').classList.contains('open')`, 'Dialog zu');
    assert.equal(
      await b.auswerten(`document.activeElement?.closest('h1')?.dataset.tabTitle ?? document.activeElement?.tagName`),
      'gallery',
    );
  });

  await schrift('');
  await b.tab('Emulation.clearDeviceMetricsOverride');
  await ruhig();

  await t.test('Verknüpfung lösen nennt das Konto', async () => {
    await geh('haushalt');
    await bis(`!!document.querySelector('[data-click="unlinkHousehold"]')`, 'Haushalt');
    await b.auswerten(klick('[data-click="unlinkHousehold"]'));
    await bis(offen, 'Dialog');
    assert.equal(await b.auswerten(text('#cd-title')), `Verknüpfung mit „${KIND}“ lösen?`);
    assert.match(
      await b.auswerten(text('#cd-msg')),
      new RegExp(`Sammlung von „${KIND}“ danach nicht mehr.*zwischen den Konten verschoben habt`),
    );
    await zu();
  });

  await t.test('Verwaltung: wartendes Konto, Schalter ohne Mail', async () => {
    await geh('einstellungen/benutzer');
    await bis(
      `!!document.querySelector('#users-tbl tbody tr') && !document.getElementById('reg-mail-hinweis').hidden`,
      'Benutzerliste',
    );
    const z =
      await b.auswerten(`(() => { const zeile = [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.textContent.includes(${JSON.stringify(WARTET)}));
      const tabelle = document.getElementById('users-tbl').innerText;
      return { wartet: /wartet auf Bestätigung/.test(zeile.textContent), knopf: !!zeile.querySelector('[data-click="kontoFreischalten"]'),
        verwalter: /Verwalter/.test(tabelle), admin: /\\bAdmin/.test(tabelle), schalter: document.getElementById('reg-enabled').disabled,
        hinweis: document.getElementById('reg-mail-hinweis').textContent }; })()`);
    assert.deepEqual(
      { ...z, hinweis: /E-Mail-Versand/.test(z.hinweis) },
      { wartet: true, knopf: true, verwalter: true, admin: false, schalter: true, hinweis: true },
    );
    assert.match(await b.auswerten(text('#ubadge')), new RegExp(`${NAME} \\(Verwalter\\)`));
    await b.auswerten(
      `[...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.textContent.includes(${JSON.stringify(WARTET)})).querySelector('[data-click="kontoFreischalten"]').click(); true`,
    );
    await bis(offen, 'Dialog');
    assert.equal(await b.auswerten(text('#cd-title')), `Konto „${WARTET}“ freischalten?`);
    await zu();
  });

  await t.test('Kategorie in Tabelle und Filter', async () => {
    await geh('teile');
    await b.auswerten(klick('[data-click="ansichtWaehlen"][data-arg="parts-view"][data-arg2="table"]'));
    await bis(
      `[...document.querySelectorAll('#parts-main tbody.parts-body tr')].some(r => r.textContent.includes('99901'))`,
      'Teiletabelle',
    );
    const kategorien = `(() => { const zelle = (nr) => [...document.querySelectorAll('#parts-main tbody.parts-body tr')].find(r => r.children[1]?.textContent.trim() === nr)?.children[4]?.textContent.trim();
      return { b99902: zelle('99902'), b99901: zelle('99901'), filter: [...document.querySelectorAll('#parts-cat option')].map(o => o.textContent).slice(1).sort() }; })()`;
    assert.deepEqual(await b.auswerten(kategorien), {
      b99902: 'Bricks',
      b99901: 'Unbekannt',
      filter: ['Bricks', 'Unbekannt'],
    });
    await b.auswerten(
      `(() => { const s = document.getElementById('lang-select'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    try {
      await bis(
        `[...document.querySelectorAll('#parts-cat option')].some(o => o.textContent === 'Unknown')`,
        'englisch',
        50,
      );
      assert.equal(await b.auswerten(text('#link-register')), 'Register');
    } finally {
      await b.auswerten(
        `(() => { const s = document.getElementById('lang-select'); s.value = 'de'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
      );
    }
  });

  await t.test('Hintergrundarbeiten: Anleitungen', async () => {
    await geh('hintergrund');
    await bis(`document.querySelectorAll('.mon-dienste .mon-name').length >= 6`, 'Dienste');
    const namen = await b.auswerten(
      `[...document.querySelectorAll('.mon-dienste .mon-name')].map(n => n.textContent.trim()).join(' | ')`,
    );
    assert.match(namen, /Anleitungen herunterladen/);
    assert.doesNotMatch(namen, /Handbücher/);
  });

  await t.test('Bestätigung angemeldet', async () => {
    const { hashToken } = buildAndRequire()('src/konto/geraeteToken.js');
    const NEU = `${NAME}-neu@example.org`,
      TOKEN = `r14-${process.pid}-${Date.now()}`;
    await db.run(
      `UPDATE users SET email_neu = $2, email_neu_token = $3, email_neu_bis = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [uid, NEU, hashToken(TOKEN)],
    );
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/verify?token=${TOKEN}` });
    await bis(
      `(document.getElementById('verify-ziel')?.textContent || '').includes(${JSON.stringify(NEU)})`,
      'Ziel genannt',
    );
    const z =
      await b.auswerten(`({ haupt: document.getElementById('btn-verify').classList.contains('bp'), zurueck: ${text('#link-verify-to-login')},
      formular: { titel: ${text('#panel-register h1')}, pflicht: ['reg-user', 'reg-email', 'reg-pass', 'reg-pass2'].every(id => document.getElementById(id).required && document.getElementById(id).getAttribute('aria-required') === 'true'),
        regel: document.getElementById(document.getElementById('reg-pass').getAttribute('aria-describedby'))?.textContent } })`);
    assert.deepEqual(z, {
      haupt: true,
      zurueck: '← Zurück zur Sammlung',
      formular: {
        titel: 'Registrieren',
        pflicht: true,
        regel: 'Mindestens 12 Zeichen, kein häufig verwendetes Passwort.',
      },
    });
    await b.auswerten(klick('#btn-verify'));
    await bis(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'App offen');
    await bis(
      `[...document.querySelectorAll('#toasts .toast')].some(x => x.textContent.includes(${JSON.stringify(`Neue Adresse ${NEU} bestätigt.`)}))`,
      'Toast',
    );
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, NEU);
    // Nichts ausstehend: Bestätigen ist nicht mehr der nahegelegte Schritt.
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/verify?token=veraltet` });
    await bis(
      `/wartet keine neue Adresse/.test(document.getElementById('verify-ziel')?.textContent || '')`,
      'nichts ausstehend',
    );
    assert.deepEqual(
      await b.auswerten(`[...document.getElementById('btn-verify').classList].filter(k => k === 'bp' || k === 'bs')`),
      ['bs'],
    );
  });

  // Aufräumen hier, nicht in t.after: Dort endet der Pool aus starteApp zuerst.
  for (const z of smtpVorher)
    await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [z.key, z.value]);
});
