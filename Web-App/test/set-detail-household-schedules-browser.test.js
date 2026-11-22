/**
 * UX check 19 in real Chrome, in the household (patternHousehold): set detail
 * (H1, H2, M1, M2), settings in one place (M2, M3), first card on the
 * phone (M4), path, tiles and axis (M5, N1, N2, N3); what turns red in each case
 * is told by the counter-checks.
 *
 * Counter-checks (measured 12.11.2026, each on its own, bundle rebuilt):
 *   A  in mengenBlock() `if (!inHousehold(set))` to `if (true)` → red:
 *      „Set-Detail im Haushalt“ (no row per account)
 *   B  in untertitel() again only the foreign accounts → red: same place
 *      („Konto: …_kind“ instead of „Konten: r19_… (ich), …_kind“)
 *   C  ladeSetNachtraege(sn) removed in frischeDetailAuf() → red: same place
 *      (chart still names 205,00 €)
 *   D  owner_user_id left out in quantityPerAccount() → red: same place (toast
 *      names the own purchase of 01.06.)
 *   E  reportAtField() removed in frischeDetailAuf() → red: same place (no
 *      „Gespeichert ✓“)
 *   F  in monitor.js the schedule fields back into the services table → red:
 *      „Einstellungen an einem Ort“ (fields under background jobs)
 *   G  loadSchedules() not called when opening the settings → red:
 *      same place („Zeitpläne als Felder“)
 *   H  reportAtField() removed in saveCacheTtl → red: same place
 *      („Gespeichert ✓“ at the field)
 *   I  in mobile.css the header of the collection again with a visible title →
 *      red: „Telefon: erste Karte“ (43 % of the height)
 *   K  dismissRbHint() without localStorage → red: same place (banner after reloading)
 *   L  .delbtn again with font-size var(--fs-1) → red: „Pfad, Kacheln,
 *      Achse“ (symbol too small)
 *   M  tile trash can again only hidden at (hover:none) and (pointer:coarse)
 *      → red: same place („Papierkorb auf jeder Kachel“)
 *   N  tile without „n Käufe, zuletzt“ → red: same place („Gekauft 02.06.2026“)
 *   O  path removed from #tab-parts → red: same place ('' instead of „Sammlung ›
 *      Teile“)
 *   P  day axis again { day: 'numeric', month: 'short' } → red: same place
 *      („13. Sept. | 27. Sept. …“)
 *   Q  `.ca .delbtn{display:none}` in styles.css (13.11.2026) → red: same place
 *      („Symbol zu klein (0 px)“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const CLOSE = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

async function setDetailInHousehold(_t, a) {
  const { b, bis, ruhig } = a;
  const kind = `r19_${process.pid}_kind`;
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click();
    document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]').click(); true`);
  await bis(`document.querySelectorAll('#m-quantity .quantity-account').length === 2`, 'Regler je Konto');
  await bis(`/205,00/.test(${text('#m-sparkline-content')})`, 'Diagramm mit dem Mischpreis');
  assert.equal(await b.auswerten(text('#m-subtitle')), `21318-1 · Konten: r19_${process.pid} (ich), ${kind}`);
  const zeilen = `[...document.querySelectorAll('#m-quantity .quantity-account')].map(z => z.querySelector('.quantity-name').textContent + ' ' + z.querySelector('.quantity-number').textContent)`;
  assert.deepEqual(await b.auswerten(zeilen), [`r19_${process.pid} (ich) 1`, `${kind} 1`]);

  await b.auswerten(
    `document.querySelector('#m-quantity .quantity-account:nth-child(2) [data-arg2="-1"]').click(); true`,
  );
  await bis(`/Kauf vom 02\\.06\\.2026/.test(document.getElementById('toasts').textContent)`, 'Toast nennt den Kauf');
  await ruhig();
  assert.match(
    await b.auswerten(text('#toasts')),
    new RegExp(`Kauf vom 02\\.06\\.2026 \\(210,00 €\\) entfernt · ${kind}`),
  );
  assert.ok(await b.auswerten(`!!document.querySelector('#toasts .toast-action')`), 'kein Rückgängig');
  // Without the child the set only belongs to the account: the one field again, the header without accounts.
  assert.deepEqual(await b.auswerten(zeilen), []);
  assert.equal(await b.auswerten(`document.getElementById('m-qty')?.value`), '1');
  assert.equal(await b.auswerten(text('#m-subtitle')), '21318-1');
  assert.equal(await b.auswerten(text('#m-quantity .field-status')), 'Gespeichert ✓');
  assert.equal(await b.auswerten(`document.querySelector('#m-quantity .field-status').getAttribute('role')`), 'status');
  await bis(`/199,99/.test(${text('#m-sparkline-content')})`, 'Diagramm mit dem verbliebenen Kaufpreis', 50);

  await b.auswerten(`[...document.querySelectorAll('#toasts .toast-action')].at(-1).click(); true`);
  await bis(
    `JSON.stringify(${zeilen}) === ${JSON.stringify(JSON.stringify([`r19_${process.pid} (ich) 1`, `${kind} 1`]))}`,
    'Rückgängig bringt den Kauf zurück',
  );
  await bis(`/205,00/.test(${text('#m-sparkline-content')})`, 'Diagramm wieder mit dem Mischpreis', 50);
}

async function settingsOneLocation(_t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.getElementById('ntab-monitor').click(); true`);
  await bis(`document.querySelectorAll('#monitor-content .mon-plan').length > 0`, 'Dienste');
  const felder = await b.auswerten(
    `[...document.querySelectorAll('#tab-monitor :is(select, input, textarea)')].filter(e => e.checkVisibility()).map(e => e.id || e.className)`,
  );
  assert.deepEqual(felder, [], 'Hintergrundarbeiten enthält noch Einstellungen');
  await b.auswerten(`document.querySelector('#monitor-content .mon-plan ~ a').click(); true`);
  await bis(
    `document.getElementById('tab-settings').classList.contains('active') && document.getElementById('settings-background').classList.contains('settings-active')`,
    'Einstellungen › Hintergrundarbeiten',
  );
  await bis(`document.querySelectorAll('#settings-schedules .job-sched-input').length > 0`, 'Zeitpläne als Felder');
  await b.auswerten(`(() => { const s = document.getElementById('mon-cache-ttl'); s.value = '168';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(`${text('#mon-cache-ttl + .field-status')} === 'Gespeichert ✓'`, '„Gespeichert ✓“ am Feld');
  const ttl = await b.auswerten(`fetch('/api/v2/admin/cache-ttl').then(r => r.json()).then(d => d.ttl)`);
  assert.equal(String(ttl), '168');
  await b.auswerten(`(() => { const f = document.querySelector('#settings-schedules .mon-minutes, #settings-schedules .mon-time');
    f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(`${text('#settings-schedules .field-status')} === 'Gespeichert ✓'`, 'Zeitplan bestätigt am Feld');
}

const CARD_TOP = `(() => { scrollTo(0, 0); const k = document.querySelector('#gallery .sc');
  return k ? k.getBoundingClientRect().top / innerHeight : 1; })()`;

async function phoneFirstCard(_t, a) {
  const { b, bis, ruhig } = a;
  const groesse = (w, h, mobil) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: mobil });
  try {
    await groesse(390, 844, true);
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(
      `!!document.querySelector('#gallery .sc') && !document.getElementById('rb-hint').hidden`,
      'Karten mit Band',
    );
    await ruhig();
    const withBand = await b.auswerten(CARD_TOP);
    assert.ok(withBand < 0.38, `erste Karte bei ${Math.round(withBand * 100)} % der Höhe (vorher 43 %)`);
    await b.auswerten(`document.querySelector('#rb-hint [data-click="dismissRbHint"]').click(); true`);
    await b.tab('Page.reload');
    await bis(`!!document.querySelector('#gallery .sc')`, 'nach dem Neuladen', 200);
    await ruhig();
    assert.equal(await b.auswerten(`document.getElementById('rb-hint').hidden`), true, 'Band nach Neuladen zurück');
    const ohne = await b.auswerten(CARD_TOP);
    assert.ok(ohne < 0.3, `ohne Band erste Karte bei ${Math.round(ohne * 100)} % der Höhe`);
  } finally {
    await groesse(1280, 900, false);
  }
}

async function pathTilesAxis(_t, a) {
  const { b, bis, ruhig } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="parts"]').click(); true`);
  await bis(`document.getElementById('tab-parts').classList.contains('active')`, 'Teile');
  assert.equal(await b.auswerten(text('#tab-parts .breadcrumb')), 'Sammlung › Teile');
  assert.ok(await b.auswerten(`document.querySelector('#tab-parts .breadcrumb').checkVisibility()`), 'Pfad unsichtbar');
  await b.auswerten(`document.querySelector('#tab-parts .breadcrumb a').click(); true`);
  await bis(`document.getElementById('tab-gallery').classList.contains('active')`, 'Pfad führt zur Sammlung');

  await bis(`!!document.querySelector('#gallery [data-arg="21318-1"] .tile-date')`, 'Kachel Tree House');
  assert.equal(await b.auswerten(text('#gallery [data-arg="21318-1"] .tile-date')), '2 Käufe, zuletzt 02.06.2026');
  // Trash can: without hovering (Chrome headless reports hover: none, like a touch device) it does not stand on
  // the tile. With a mouse it appears on hover; that cannot be emulated here, so it is shown for
  // size and contrast: symbol ≥ 16 px, in the dark ≥ 3:1 to the surface.
  const korb = `document.querySelector('#gallery [data-arg="21318-1"] .delbtn')`;
  assert.equal(await b.auswerten(`matchMedia('(hover: none)').matches`), true, 'Testaufbau: Überfahren möglich');
  assert.equal(await b.auswerten(`${korb}.checkVisibility()`), false, 'Papierkorb auf jeder Kachel');
  // Show and measure in one step: if the gallery redraws in between (job done,
  // status stream), the second access would be a new, hidden again element with 0 px.
  const breite = await b.auswerten(
    `(() => { const k = ${korb}; const c = k.parentElement; c.style.display = 'block'; c.style.opacity = '1';
      return k.querySelector('svg').getBoundingClientRect().width; })()`,
  );
  assert.ok(breite >= 16, `Symbol zu klein (${breite} px)`);
  await b.auswerten(`document.documentElement.toggleAttribute('data-dark', true); true`);
  const kontrast = await b.auswerten(`(() => { const rgb = s => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = f => 0.2126 * lin(f[0]) + 0.7152 * lin(f[1]) + 0.0722 * lin(f[2]);
    const grund = e => { for (let x = e; x; x = x.parentElement) { const f = getComputedStyle(x).backgroundColor; if (!/rgba\\(.*, 0\\)|transparent/.test(f)) return rgb(f); } return [255, 255, 255]; };
    const k = ${korb}; const [h, d] = [L(rgb(getComputedStyle(k).color)), L(grund(k))].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); })()`);
  await b.auswerten(
    `document.documentElement.toggleAttribute('data-dark', false); ${korb}.parentElement.removeAttribute('style'); true`,
  );
  assert.ok(kontrast >= 3, `Papierkorb im Dunkeln ${kontrast.toFixed(2)}:1`);

  await b.auswerten(`document.querySelector('#gallery [data-click="openModal"][data-arg="10294-1"]').click(); true`);
  await bis(`document.querySelectorAll('#m-sparkline-content svg text').length > 3`, 'Diagramm');
  await ruhig();
  const texte = await b.auswerten(
    `[...document.querySelectorAll('#m-sparkline-content svg text')].map(t => t.textContent.trim())`,
  );
  assert.ok(
    texte.some(t => /^\d{2}\.\d{2}\.$/.test(t)),
    `keine Tagesbeschriftung wie „13.09.“: ${texte.join(' | ')}`,
  );
  assert.deepEqual(
    texte.filter(t => /\d\. ?[A-Za-zÄÖÜäöü]/.test(t)),
    [],
    'Achse mit Monatsnamen',
  );
}

test('set detail in the household, schedules, tiles', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await startApp(t, { name: `r19_${process.pid}`, holding: patternHousehold });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Set-Detail im Haushalt', setDetailInHousehold],
    ['Einstellungen an einem Ort', settingsOneLocation],
    ['Telefon: erste Karte', phoneFirstCard],
    ['Pfad, Kacheln, Achse', pathTilesAxis],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.auswerten(CLOSE);
    await t.test(name, () => fn(t, a));
  }
});
