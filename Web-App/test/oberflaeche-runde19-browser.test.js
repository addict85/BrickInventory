/**
 * UX-Prüfung 19 im echten Chrome, im Haushalt (musterHaushalt): Set-Detail
 * (H1, H2, M1, M2), Einstellungen an einem Ort (M2, M3), erste Karte am
 * Telefon (M4), Pfad, Kacheln und Achse (M5, N1, N2, N3); was jeweils rot
 * wird, sagen die Gegenproben.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in mengenBlock() `if (!imHaushalt(set))` zu `if (true)` → rot:
 *      „Set-Detail im Haushalt“ (keine Zeile je Konto)
 *   B  in untertitel() wieder nur die fremden Konten → rot: ebenda
 *      („Konto: …_kind“ statt „Konten: ich, …_kind“)
 *   C  in frischeDetailAuf() ladeSetNachtraege(sn) entfernt → rot: ebenda
 *      (Diagramm nennt weiter 205,00 €)
 *   D  in mengeJeKonto() owner_user_id weggelassen → rot: ebenda (Toast
 *      nennt den eigenen Kauf vom 01.06.)
 *   E  meldeAmFeld() in frischeDetailAuf() entfernt → rot: ebenda (kein
 *      „Gespeichert ✓“)
 *   F  in monitor.js die Zeitplanfelder wieder in die Dienstetabelle → rot:
 *      „Einstellungen an einem Ort“ (Felder unter Hintergrundarbeiten)
 *   G  ladeZeitplaene() beim Öffnen der Einstellungen nicht gerufen → rot:
 *      ebenda („Zeitpläne als Felder“)
 *   H  meldeAmFeld() in speichereCacheTtl entfernt → rot: ebenda
 *      („Gespeichert ✓“ am Feld)
 *   I  in mobile.css den Kopf der Sammlung wieder mit sichtbarem Titel →
 *      rot: „Telefon: erste Karte“ (43 % der Höhe)
 *   K  rbHinweisWeg() ohne localStorage → rot: ebenda (Band nach Neuladen)
 *   L  .delbtn wieder mit font-size var(--fs-1) → rot: „Pfad, Kacheln,
 *      Achse“ (Symbol zu klein)
 *   M  Kachel-Papierkorb wieder nur bei (hover:none) and (pointer:coarse)
 *      verborgen → rot: ebenda („Papierkorb auf jeder Kachel“)
 *   N  Kachel ohne „n Käufe, zuletzt“ → rot: ebenda („Gekauft 02.06.2026“)
 *   O  Pfad aus #tab-parts entfernt → rot: ebenda ('' statt „Sammlung ›
 *      Teile“)
 *   P  Tagesachse wieder { day: 'numeric', month: 'short' } → rot: ebenda
 *      („13. Sept. | 27. Sept. …“)
 *   Q  `.ca .delbtn{display:none}` in styles.css (13.11.2026) → rot: ebenda
 *      („Symbol zu klein (0 px)“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const SCHLIESSEN = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

async function setDetailImHaushalt(_t, a) {
  const { b, bis, ruhig } = a;
  const kind = `r19_${process.pid}_kind`;
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click();
    document.querySelector('#gallery [data-click="openModal"][data-arg="21318-1"]').click(); true`);
  await bis(`document.querySelectorAll('#m-menge .menge-konto').length === 2`, 'Regler je Konto');
  await bis(`/205,00/.test(${text('#m-sparkline-content')})`, 'Diagramm mit dem Mischpreis');
  assert.equal(await b.auswerten(text('#m-untertit')), `21318-1 · Konten: ich, ${kind}`);
  const zeilen = `[...document.querySelectorAll('#m-menge .menge-konto')].map(z => z.querySelector('.menge-name').textContent + ' ' + z.querySelector('.menge-zahl').textContent)`;
  assert.deepEqual(await b.auswerten(zeilen), ['ich 1', `${kind} 1`]);

  await b.auswerten(`document.querySelector('#m-menge .menge-konto:nth-child(2) [data-arg2="-1"]').click(); true`);
  await bis(`/Kauf vom 02\\.06\\.2026/.test(document.getElementById('toasts').textContent)`, 'Toast nennt den Kauf');
  await ruhig();
  assert.match(
    await b.auswerten(text('#toasts')),
    new RegExp(`Kauf vom 02\\.06\\.2026 \\(210,00 €\\) entfernt · ${kind}`),
  );
  assert.ok(await b.auswerten(`!!document.querySelector('#toasts .toast-aktion')`), 'kein Rückgängig');
  // Ohne das Kind gehört das Set nur noch dem Konto: wieder das eine Feld, die Kopfzeile ohne Konten.
  assert.deepEqual(await b.auswerten(zeilen), []);
  assert.equal(await b.auswerten(`document.getElementById('m-qty')?.value`), '1');
  assert.equal(await b.auswerten(text('#m-untertit')), '21318-1');
  assert.equal(await b.auswerten(text('#m-menge .feld-status')), 'Gespeichert ✓');
  assert.equal(await b.auswerten(`document.querySelector('#m-menge .feld-status').getAttribute('role')`), 'status');
  await bis(`/199,99/.test(${text('#m-sparkline-content')})`, 'Diagramm mit dem verbliebenen Kaufpreis', 50);

  await b.auswerten(`[...document.querySelectorAll('#toasts .toast-aktion')].at(-1).click(); true`);
  await bis(
    `JSON.stringify(${zeilen}) === ${JSON.stringify(JSON.stringify(['ich 1', `${kind} 1`]))}`,
    'Rückgängig bringt den Kauf zurück',
  );
  await bis(`/205,00/.test(${text('#m-sparkline-content')})`, 'Diagramm wieder mit dem Mischpreis', 50);
}

async function einstellungenEinOrt(_t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.getElementById('ntab-monitor').click(); true`);
  await bis(`document.querySelectorAll('#monitor-content .mon-plan').length > 0`, 'Dienste');
  const felder = await b.auswerten(
    `[...document.querySelectorAll('#tab-monitor :is(select, input, textarea)')].filter(e => e.checkVisibility()).map(e => e.id || e.className)`,
  );
  assert.deepEqual(felder, [], 'Hintergrundarbeiten enthält noch Einstellungen');
  await b.auswerten(`document.querySelector('#monitor-content .mon-plan ~ a').click(); true`);
  await bis(
    `document.getElementById('tab-settings').classList.contains('active') && document.getElementById('einst-hintergrund').classList.contains('einst-aktiv')`,
    'Einstellungen › Hintergrundarbeiten',
  );
  await bis(`document.querySelectorAll('#einst-zeitplaene .job-sched-input').length > 0`, 'Zeitpläne als Felder');
  await b.auswerten(`(() => { const s = document.getElementById('mon-cache-ttl'); s.value = '168';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(`${text('#mon-cache-ttl + .feld-status')} === 'Gespeichert ✓'`, '„Gespeichert ✓“ am Feld');
  const ttl = await b.auswerten(`fetch('/api/v1/admin/cache-ttl').then(r => r.json()).then(d => d.ttl)`);
  assert.equal(String(ttl), '168');
  await b.auswerten(`(() => { const f = document.querySelector('#einst-zeitplaene .mon-minuten, #einst-zeitplaene .mon-zeit');
    f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(`${text('#einst-zeitplaene .feld-status')} === 'Gespeichert ✓'`, 'Zeitplan bestätigt am Feld');
}

const KARTE_OBEN = `(() => { scrollTo(0, 0); const k = document.querySelector('#gallery .sc');
  return k ? k.getBoundingClientRect().top / innerHeight : 1; })()`;

async function telefonErsteKarte(_t, a) {
  const { b, bis, ruhig } = a;
  const groesse = (w, h, mobil) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: mobil });
  try {
    await groesse(390, 844, true);
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(
      `!!document.querySelector('#gallery .sc') && !document.getElementById('rb-hinweis').hidden`,
      'Karten mit Band',
    );
    await ruhig();
    const mitBand = await b.auswerten(KARTE_OBEN);
    assert.ok(mitBand < 0.38, `erste Karte bei ${Math.round(mitBand * 100)} % der Höhe (vorher 43 %)`);
    await b.auswerten(`document.querySelector('#rb-hinweis [data-click="rbHinweisWeg"]').click(); true`);
    await b.tab('Page.reload');
    await bis(`!!document.querySelector('#gallery .sc')`, 'nach dem Neuladen', 200);
    await ruhig();
    assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').hidden`), true, 'Band nach Neuladen zurück');
    const ohne = await b.auswerten(KARTE_OBEN);
    assert.ok(ohne < 0.3, `ohne Band erste Karte bei ${Math.round(ohne * 100)} % der Höhe`);
  } finally {
    await groesse(1280, 900, false);
  }
}

async function pfadKachelnAchse(_t, a) {
  const { b, bis, ruhig } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="parts"]').click(); true`);
  await bis(`document.getElementById('tab-parts').classList.contains('active')`, 'Teile');
  assert.equal(await b.auswerten(text('#tab-parts .brotkrume')), 'Sammlung › Teile');
  assert.ok(await b.auswerten(`document.querySelector('#tab-parts .brotkrume').checkVisibility()`), 'Pfad unsichtbar');
  await b.auswerten(`document.querySelector('#tab-parts .brotkrume a').click(); true`);
  await bis(`document.getElementById('tab-gallery').classList.contains('active')`, 'Pfad führt zur Sammlung');

  await bis(`!!document.querySelector('#gallery [data-arg="21318-1"] .kachel-datum')`, 'Kachel Tree House');
  assert.equal(await b.auswerten(text('#gallery [data-arg="21318-1"] .kachel-datum')), '2 Käufe, zuletzt 02.06.2026');
  // Papierkorb: Ohne Überfahren (Chrome headless meldet hover: none, wie ein Touchgerät) steht er nicht auf
  // der Kachel. Mit Maus erscheint er beim Überfahren; das lässt sich hier nicht emulieren, also wird er für
  // Grösse und Kontrast eingeblendet: Symbol ≥ 16 px, im Dunkeln ≥ 3:1 zur Fläche.
  const korb = `document.querySelector('#gallery [data-arg="21318-1"] .delbtn')`;
  assert.equal(await b.auswerten(`matchMedia('(hover: none)').matches`), true, 'Testaufbau: Überfahren möglich');
  assert.equal(await b.auswerten(`${korb}.checkVisibility()`), false, 'Papierkorb auf jeder Kachel');
  // Einblenden und Messen in einem Schritt: Zeichnet die Galerie dazwischen neu (Auftrag fertig,
  // Statusstrom), wäre der zweite Zugriff ein neues, wieder verstecktes Element mit 0 px.
  const breite = await b.auswerten(
    `(() => { const k = ${korb}; const c = k.parentElement; c.style.display = 'block'; c.style.opacity = '1';
      return k.querySelector('svg').getBoundingClientRect().width; })()`,
  );
  assert.ok(breite >= 16, `Symbol zu klein (${breite} px)`);
  await b.auswerten(`document.documentElement.toggleAttribute('data-dunkel', true); true`);
  const kontrast = await b.auswerten(`(() => { const rgb = s => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = f => 0.2126 * lin(f[0]) + 0.7152 * lin(f[1]) + 0.0722 * lin(f[2]);
    const grund = e => { for (let x = e; x; x = x.parentElement) { const f = getComputedStyle(x).backgroundColor; if (!/rgba\\(.*, 0\\)|transparent/.test(f)) return rgb(f); } return [255, 255, 255]; };
    const k = ${korb}; const [h, d] = [L(rgb(getComputedStyle(k).color)), L(grund(k))].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); })()`);
  await b.auswerten(
    `document.documentElement.toggleAttribute('data-dunkel', false); ${korb}.parentElement.removeAttribute('style'); true`,
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

test('UX-Prüfung 19 im Browser', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await starteApp(t, { name: `r19_${process.pid}`, bestand: musterHaushalt });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Set-Detail im Haushalt', setDetailImHaushalt],
    ['Einstellungen an einem Ort', einstellungenEinOrt],
    ['Telefon: erste Karte', telefonErsteKarte],
    ['Pfad, Kacheln, Achse', pfadKachelnAchse],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.auswerten(SCHLIESSEN);
    await t.test(name, () => fn(t, a));
  }
});
