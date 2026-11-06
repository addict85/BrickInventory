/**
 * Befunde der UI-Prüfung 16 im echten Browser: Finanztabelle am Tablet und
 * bei 200 % Zoom, Zahlenformat nach Konto, Fremdwährung und Kachel, neue
 * Lagerorte beim Erfassen, Sprachwechsel samt erzeugter Auswahlfelder,
 * aria-label und Trefferzahl für Vorleser, Besitzer im Set-Detail, Knöpfe im …
 * Ausführlich: docs/begruendungen/test/oberflaeche-runde16-browser.test.js.md#kopf
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  .tw ohne position:relative UND die Media-Regel für 641–1100 px
 *      gestrichen → rot: „Finanztabelle ohne seitliches Rollen“ (Seite 913,
 *      1034, 1050 px breit bei 683, 820, 1024 px). A allein bleibt grün: Die
 *      Tablet-Regel lässt die Tabelle schon passen.
 *   B  nur die Media-Regel gestrichen → rot: dieselbe Prüfung (die Tabelle
 *      rollt in ihrem Kasten, „Stand“ liegt ausserhalb)
 *   C  locale() wieder mit Rückfall 'de-CH' → rot: „Zahlenformat …“,
 *      „Fremdwährung …“ und „Sprachwechsel …“ (Platzhalter „z. B. 79.99“)
 *   D  einstandZelle() ohne den Zweig für kaufpreis_original → rot:
 *      „Fremdwährung und Kachel …“
 *   E  ladeLagerorte() füllt die Auswahl wieder aus /v1/storage → rot:
 *      „neuer Lagerort …“
 *   F  der Hörer auf spracheGewechselt in 02-konten-orte.js gestrichen → rot:
 *      „Sprachwechsel …“ (danach auch die zwei folgenden, die Seite bleibt
 *      englisch)
 *   G  data-i18n-aria nicht ausgewertet → rot: dieselben drei
 *   H  meldeTreffer() in renderGallery gestrichen → rot: „Trefferzahl …“
 *   I  im Set-Detail die Besitzerzeile gestrichen → rot: „Set-Detail nennt …“
 *   K  .knopf-fuellend wieder flex:1 → rot: „Merkposten-Dialog …“ (Text
 *      breiter als der Knopf)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt, haeltSet } = require('./helpers/bestand');

const klick = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

test('UI-Prüfung 16: Finanzen, Lagerorte, Sprache, Vorleser', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const NAME = `r16_${process.pid}`, KIND = `${NAME}_kind`;
  const app = await starteApp(t, { name: NAME, bestand: async (db, uid) => {
    const kid = await musterHaushalt(db, uid);
    // Belegt: Vitrine; leer: Regal Keller (musterSammlung). Ein Kauf in ARS mit Marktpreis: Für ARS
    // veröffentlicht die EZB keinen Kurs, auch nicht in der CI mit Netz.
    const vitrine = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Vitrine Wohnzimmer') RETURNING id`, [uid])).id;
    await db.run(`UPDATE sets SET storage_id = $2 WHERE user_id = $1 AND set_number = '10294-1'`, [uid, vitrine]);
    await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces) VALUES ('10497-1', 'Galaxy Explorer', 2022, 'Icons', 1254)
                  ON CONFLICT (set_number) DO NOTHING`);
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10497-1')`, [uid]);
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
                  VALUES ($1, '10497-1', 1, 99.99, 'N', 'ARS')`, [uid]);
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                  VALUES ('10497-1', 'N', 'EUR', 80, 90, 100, 90, 5, NOW()) ON CONFLICT (set_number, condition, currency_code) DO UPDATE SET avg_price = 90`);
    // Nur beim Unterkonto: das Set-Detail soll den Besitzer nennen.
    await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces) VALUES ('75313-1', 'AT-AT', 2021, 'Star Wars', 6785)
                  ON CONFLICT (set_number) DO NOTHING`);
    await haeltSet(db, kid, '75313-1', 1, { preis: 700 });
  } });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  const geh = async (pfad) => { await b.auswerten(`location.hash = '#/${pfad}'; true`); await warte(400); };
  const groesse = async (w, h = 900) => { await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await warte(400); };
  const beleg = async (name) => {
    if (!process.env.BELEG_ORDNER) return;
    const { data } = await b.tab('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(process.env.BELEG_ORDNER, { recursive: true });
    fs.writeFileSync(path.join(process.env.BELEG_ORDNER, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const sprache = async (l) => {
    await b.auswerten(`(() => { const s = document.getElementById('lang-select'); s.value = '${l}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await bis(`document.documentElement.lang === '${l}'`, `Sprache ${l}`);
    await ruhig();
  };

  await geh('finanzen');
  await bis(`document.querySelectorAll('[data-fin-art="sets"] tbody tr').length >= 4 && document.getElementById('fin-sum').dataset.geladen === '1'`, 'Finanztabelle');

  await t.test('Finanztabelle ohne seitliches Rollen bei 683, 820, 1024 und 1280 px', async () => {
    const fehler = [];
    for (const w of [683, 820, 1024, 1280]) {
      await groesse(w, w === 683 ? 450 : 900);
      await b.auswerten(`document.querySelector('[data-fin-art="sets"]').scrollIntoView(); true`);
      await beleg(`finanzen-${w}`);
      const m = await b.auswerten(`(() => {
        const tw = document.querySelector('[data-fin-art="sets"]'), stand = [...tw.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().width > 0).pop();
        const wert = [...tw.querySelectorAll('thead th')].find(th => /Marktwert/.test(th.textContent));
        return { seite: document.documentElement.scrollWidth, fenster: innerWidth, rollt: tw.scrollWidth - tw.clientWidth,
                 stand: Math.round(stand.getBoundingClientRect().right), wert: Math.round(wert.getBoundingClientRect().right),
                 rand: Math.round(tw.getBoundingClientRect().right) }; })()`);
      if (m.seite > m.fenster) fehler.push(`${w}: Seite ${m.seite} px breit`);
      if (m.rollt > 1) fehler.push(`${w}: Tabelle rollt ${m.rollt} px`);
      if (m.stand > m.rand + 1 || m.wert > m.rand + 1) fehler.push(`${w}: Stand/Marktwert bei ${m.stand}/${m.wert}, Rand ${m.rand}`);
    }
    assert.deepEqual(fehler, []);
    await groesse(1280);
  });

  await t.test('Zahlenformat: deutsches Konto in EUR schreibt 1.234,56 €', async () => {
    const einstand = await b.auswerten(text('#fin-einstand'));
    assert.match(einstand.replace(/ /g, ' '), /^\d{1,3}(\.\d{3})*,\d{2} €$/, einstand);
    assert.equal(await b.auswerten(`navigator.language.startsWith('de-')`), false, 'Vorbedingung: Browser ohne deutsche Region');
  });

  await t.test('Fremdwährung und Kachel: Kaufpreis in ARS sichtbar, Marktwert benannt', async () => {
    const zelle = await b.auswerten(`(() => { const tr = [...document.querySelectorAll('[data-fin-art="sets"] tbody tr')].find(r => r.textContent.includes('Galaxy Explorer'));
      return tr.querySelector('td.price-cell').textContent.replace(/\\s+/g, ' ').trim(); })()`);
    assert.match(zelle, /99,99\sARS.*nicht umgerechnet/);
    assert.equal(await b.auswerten(text('#fin-wert-titel')), 'Marktwert der bewerteten Posten');
    assert.match(await b.auswerten(text('#fin-wert-sub')), /^von .* Marktwert insgesamt$/);
    // Fehlende Werte sehen gleich aus: Strich mit Vorlesetext, nirgends „Preis fehlt“ als sichtbarer Text.
    const sichtbar = await b.auswerten(`[...document.querySelectorAll('#fin-tbl td')].filter(td => {
      const k = td.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove()); return /Preis fehlt/.test(k.textContent); }).length`);
    assert.equal(sichtbar, 0);
  });

  await t.test('neuer Lagerort steht beim Erfassen zur Wahl, der Filter zeigt nur belegte', async () => {
    await geh('lagerorte');
    await bis(`!!document.getElementById('storage-new') && !!document.querySelector('#storage-list .lager-eingabe')`, 'Lagerorte');
    await b.auswerten(`document.getElementById('storage-new').value = 'Dachboden Kiste 3'; ${klick('[data-click="legeLagerortAn"]')}`);
    await bis(`[...document.querySelectorAll('#storage-list .lager-eingabe')].some(e => e.value === 'Dachboden Kiste 3')`, 'neuer Ort in der Liste');
    // Ohne den Dialog zu öffnen: Sein Öffnen lädt den Vorrat selbst nach und verdeckte, was die Seite vorher füllt.
    await geh('sammlung');
    await bis(`[...document.querySelectorAll('#add-storage-sel option')].some(o => o.value === 'Dachboden Kiste 3')`, 'neuer Ort in der Auswahl');
    const z = await b.auswerten(`({ auswahl: [...document.querySelectorAll('#add-storage-sel option')].map(o => o.value).filter(Boolean),
      filter: [...document.querySelectorAll('#storage-gallery option')].map(o => o.value).filter(Boolean) })`);
    assert.deepEqual(z.auswahl.slice().sort(), ['Dachboden Kiste 3', 'Regal Keller', 'Vitrine Wohnzimmer']);
    assert.deepEqual(z.filter, ['Vitrine Wohnzimmer']);
  });

  await t.test('Sprachwechsel baut erzeugte Auswahlfelder, aria-label und Platzhalter neu', async () => {
    const lies = `({ konto: document.querySelector('#scope-gallery option[value="all"]')?.textContent,
      ort: document.querySelector('#storage-gallery option[value=""]')?.textContent,
      kein: document.querySelector('#add-storage-sel option')?.textContent,
      neu: [...document.querySelectorAll('#add-storage-sel option')].pop()?.textContent,
      aria: document.getElementById('gs').getAttribute('aria-label'),
      preis: document.getElementById('add-price').getAttribute('placeholder') })`;
    await sprache('en');
    assert.deepEqual(await b.auswerten(lies), { konto: 'All accounts', ort: 'All locations', kein: '— no location —',
      neu: '＋ new location …', aria: 'Search sets', preis: 'e.g. 79.99' });
    await sprache('de');
    assert.deepEqual(await b.auswerten(lies), { konto: 'Alle Konten', ort: 'Alle Lagerorte', kein: '— kein Lagerort —',
      neu: '＋ neuer Lagerort …', aria: 'Sets suchen', preis: 'z. B. 79,99' });
  });

  await t.test('Trefferzahl nach der Suche in einer Live-Region', async () => {
    await geh('sammlung');
    const suche = async (q) => {
      // Die Suche ist entprellt: gewartet wird auf die Änderung der Live-Region, höchstens 5 s.
      await b.auswerten(`new Promise(r => { const e = document.getElementById('treffer-live');
        const mo = new MutationObserver(() => { mo.disconnect(); r(true); });
        mo.observe(e, { childList: true, characterData: true, subtree: true }); setTimeout(() => r(false), 5000);
        const f = document.getElementById('gs'); f.value = ${JSON.stringify(q)}; f.dispatchEvent(new Event('input', { bubbles: true })); })`);
      await ruhig();
      return b.auswerten(text('#treffer-live'));
    };
    assert.deepEqual(await b.auswerten(`(() => { const e = document.getElementById('treffer-live'); return [e.getAttribute('role'), e.getAttribute('aria-live')]; })()`), ['status', 'polite']);
    assert.equal(await suche('Titanic'), '1 Set gefunden');
    assert.equal(await suche('qxzqxz'), 'Keine Treffer für „qxzqxz“');
    await suche('');
  });

  await t.test('Set-Detail nennt das Konto, dem das Set gehört', async () => {
    await geh('sammlung/set/75313-1');
    await bis(`document.getElementById('set-modal').classList.contains('open') && !document.querySelector('#set-modal .skelett-zeile')`, 'Set-Dialog');
    assert.equal(await b.auswerten(text('#m-untertit')), `75313-1 · Konto: ${KIND}`);
    await b.auswerten(klick('#set-modal [data-click="closeModal"]'));
  });

  await t.test('Merkposten-Dialog: Knopftexte passen in ihre Knöpfe', async () => {
    await geh('merkliste');
    await bis(`!!document.querySelector('#mk-list .mk-zeile')`, 'Merkliste');
    await b.auswerten(klick('#mk-list .mk-zeile'));
    await bis(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Merkposten-Dialog');
    // Der BrickLink-Knopf erscheint erst mit einer Katalogantwort; gemessen wird er auch ohne.
    await b.auswerten(`document.getElementById('mk-m-bricklink').style.display = ''; document.getElementById('mk-m-vergleich').style.display = ''; true`);
    await ruhig();
    const eng = await b.auswerten(`[...document.querySelectorAll('#mk-detail-modal .knopf-fuellend')].filter(k => k.scrollWidth > k.clientWidth + 1).map(k => k.textContent.trim())`);
    assert.deepEqual(eng, []);
  });
});
