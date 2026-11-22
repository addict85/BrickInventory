/**
 * An error message at the field moves no neighbors: what stands on the line of the
 * field or above it keeps its place; what stands below moves
 * at most downwards, never sideways. Measured in seven forms at 1280
 * and 390 px.
 *
 * Counter-checks (measured on 13.11.2026):
 *   A  fieldError without errorPlace (message directly behind the field again)
 *      → red: build list 1280 (message next to instead of below the field), wishlist
 *      1280 and 390 (label “Zustand” 27 or 47 px lower), storage locations
 *      1280 and 390 (“Hinzufügen” lower), add set 1280 and 390
 *   B  `.field-error` without contain:inline-size → red: build list 1280 (the
 *      message widens the column, “Hinzufügen” x 213 → 284)
 *   C  branch for grid and wrapping rows removed → red: price alert 1280
 *      (76 px), add set 1280 (126 px), wishlist 390 (108 px gap
 *      between field and message)
 *   D  (15.11.2026) message in the grid cell without checking the neighbors
 *      (feldzelle() only top-aligned) → red: storage locations 1280 and 390
 *      (“Hinzufügen” 27 or 47 px lower)
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

/** Position of all controls in the field's form box, in DOM order. */
const SITUATION = id => `(() => {
  const f = document.getElementById(${JSON.stringify(id)});
  let kasten = f.closest('.modal, form, details, .ssec, .pl-bar, .card') ?? f.parentElement;
  while (getComputedStyle(kasten).display === 'contents') kasten = kasten.parentElement;
  // Bezogen auf den Kasten: Der Fokus auf dem Feld rollt Seite oder Dialog, das ist kein Sprung.
  const k = kasten.getBoundingClientRect(), dy = kasten.scrollTop - k.y, dx = -k.x;
  const r = e => { const b = e.getBoundingClientRect(); return { x: b.x + dx, y: b.y + dy, u: b.bottom + dy, h: b.height }; };
  const teile = [...kasten.querySelectorAll('button, input:not(.file-hidden), select, label, .btn')]
    .filter(e => e.getClientRects().length)
    .map(e => ({ was: (e.id || e.textContent.trim() || e.tagName).slice(0, 30), ...r(e) }));
  const m = document.getElementById(${JSON.stringify(id + '-error')});
  return { feld: r(f), teile, meldung: m && !m.hidden ? r(m) : null };
})()`;

/** Forms: view, preparation, trigger and the field at which the message appears. */
const CASES = [
  {
    name: 'Bauliste',
    hash: '#/bauliste',
    bereit: `!!document.getElementById('btn-pl-add')?.getClientRects().length`,
    trigger: `document.getElementById('pl-setnr').value = 'abc,,99999999-9'; document.getElementById('btn-pl-add').click();`,
    field: 'pl-setnr',
  },
  {
    name: 'Merkliste',
    hash: '#/merkliste',
    bereit: `!!document.getElementById('mk-box')`,
    vorher: `document.getElementById('mk-box').open = true;`,
    trigger: `document.getElementById('mk-add').click();`,
    field: 'mk-num',
  },
  {
    name: 'Lagerorte',
    hash: '#/lagerorte',
    bereit: `!!document.querySelector('[data-click="createLocation"]')?.getClientRects().length`,
    trigger: `document.querySelector('[data-click="createLocation"]').click();`,
    field: 'storage-new',
  },
  {
    name: 'Passwort',
    hash: '#/konto',
    bereit: `!!document.getElementById('btn-sav-pw')?.getClientRects().length`,
    trigger: `document.getElementById('pw-n').value = 'neu-Passwort-1'; document.getElementById('pw-r').value = 'anders-Passwort-1'; document.getElementById('btn-sav-pw').click();`,
    field: 'pw-r',
  },
  {
    name: 'Preisalarm',
    hash: '#/alarme',
    bereit: `!!document.getElementById('alert-new-button')?.getClientRects().length`,
    trigger: `document.getElementById('alert-new-button').click();`,
    field: 'alert-new-set',
  },
  {
    name: 'Voucher',
    hash: '#/gutscheine',
    bereit: `!!document.querySelector('[data-click="saveVoucher"]')?.getClientRects().length`,
    trigger: `document.querySelector('[data-click="saveVoucher"]').click();`,
    field: 'v-number',
  },
  {
    name: 'Set erfassen',
    hash: '#/sammlung',
    bereit: `!!document.querySelector('[data-click="openCapture"][data-arg="set"]')`,
    vorher: `document.querySelector('[data-click="openCapture"][data-arg="set"]').click();`,
    trigger: `document.getElementById('add-num').value = '10294-1'; document.getElementById('add-price').value = 'abc'; document.getElementById('btn-add').click();`,
    field: 'add-price',
  },
];

test('error messages do not move neighbors', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `sprung_${process.pid}` });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  for (const breite of [1280, 390]) {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: breite > 500 ? 900 : 844,
      deviceScaleFactor: 1,
      mobile: breite < 500,
    });
    for (const f of CASES) {
      await t.test(`${f.name} ${breite} px`, async () => {
        await b.auswerten(`location.hash = '#/'; location.hash = ${JSON.stringify(f.hash)}; true`);
        await bis(f.bereit, f.name);
        await ruhig();
        if (f.vorher) {
          await b.auswerten(`(() => { ${f.vorher} return true; })()`);
          await ruhig();
        }
        // A message from the previous pass is cleared by the field itself as soon as one types.
        await b.auswerten(`(() => { const e = document.getElementById(${JSON.stringify(f.field)});
          e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await ruhig();
        const ago = await b.auswerten(SITUATION(f.field));
        await b.auswerten(`(() => { ${f.trigger} return true; })()`);
        await bis(`!document.getElementById(${JSON.stringify(f.field + '-error')})?.hidden`, `${f.name}: Meldung`);
        await ruhig();
        const nach = await b.auswerten(SITUATION(f.field));
        assert.ok(nach.meldung, 'Meldung sichtbar');
        assert.ok(nach.meldung.y >= nach.field.u - 1, `Meldung unter dem Feld (${nach.meldung.y} < ${nach.field.u})`);
        assert.ok(nach.meldung.x <= nach.field.x + 1, `Meldung beginnt am Feld (${nach.meldung.x} > ${nach.field.x})`);
        // Directly below, not below the whole form: at most one element row (60 px) in between.
        assert.ok(nach.meldung.y - nach.field.u < 60, `Meldung ${nach.meldung.y - nach.field.u} px unter dem Feld`);
        assert.equal(nach.parts.length, ago.parts.length);
        const moved = ago.parts
          .map((a, i) => ({ a, z: nach.parts[i] }))
          .filter(({ a, z }) => {
            if (Math.abs(a.x - z.x) > 0.5) return true;
            const onLine = a.y < ago.field.u - 1;
            return onLine ? Math.abs(a.y - z.y) > 0.5 : z.y < a.y - 0.5;
          })
          .map(({ a, z }) => `${a.was}: (${a.x}|${a.y}) → (${z.x}|${z.y})`);
        assert.deepEqual(moved, []);
        await b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
          document.querySelectorAll('.ovl.open [data-dialog-close]').forEach(x => x.click()); true`);
      });
    }
  }
});
