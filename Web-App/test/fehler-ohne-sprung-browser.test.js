/**
 * Eine Fehlermeldung am Feld verschiebt keine Nachbarn: Was auf der Linie des
 * Feldes oder darüber steht, behält seinen Platz; was darunter steht, rückt
 * höchstens nach unten, nie zur Seite. Gemessen in sieben Formularen bei 1280
 * und 390 px.
 *
 * Gegenproben (am 13.11.2026 gemessen):
 *   A  feldFehler ohne fehlerPlatzieren (Meldung wieder direkt hinter das Feld)
 *      → rot: Bauliste 1280 (Meldung neben statt unter dem Feld), Merkliste
 *      1280 und 390 (Beschriftung „Zustand“ 27 bzw. 47 px tiefer), Lagerorte
 *      1280 und 390 („Hinzufügen“ tiefer), Set erfassen 1280 und 390
 *   B  `.feld-fehler` ohne contain:inline-size → rot: Bauliste 1280 (die
 *      Meldung verbreitert die Spalte, „Hinzufügen“ x 213 → 284)
 *   C  Zweig für Raster und umbrechende Zeilen entfernt → rot: Preisalarm 1280
 *      (76 px), Set erfassen 1280 (126 px), Merkliste 390 (108 px Abstand
 *      zwischen Feld und Meldung)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

/** Lage aller Bedienelemente im Formularkasten des Feldes, in DOM-Reihenfolge. */
const LAGE = id => `(() => {
  const f = document.getElementById(${JSON.stringify(id)});
  let kasten = f.closest('.modal, form, details, .ssec, .pl-leiste, .card') ?? f.parentElement;
  while (getComputedStyle(kasten).display === 'contents') kasten = kasten.parentElement;
  // Bezogen auf den Kasten: Der Fokus auf dem Feld rollt Seite oder Dialog, das ist kein Sprung.
  const k = kasten.getBoundingClientRect(), dy = kasten.scrollTop - k.y, dx = -k.x;
  const r = e => { const b = e.getBoundingClientRect(); return { x: b.x + dx, y: b.y + dy, u: b.bottom + dy, h: b.height }; };
  const teile = [...kasten.querySelectorAll('button, input:not(.datei-versteckt), select, label, .btn')]
    .filter(e => e.getClientRects().length)
    .map(e => ({ was: (e.id || e.textContent.trim() || e.tagName).slice(0, 30), ...r(e) }));
  const m = document.getElementById(${JSON.stringify(id + '-fehler')});
  return { feld: r(f), teile, meldung: m && !m.hidden ? r(m) : null };
})()`;

/** Formulare: Ansicht, Vorbereitung, Auslöser und das Feld, an dem die Meldung erscheint. */
const FAELLE = [
  {
    name: 'Bauliste',
    hash: '#/bauliste',
    bereit: `!!document.getElementById('btn-pl-add')?.getClientRects().length`,
    ausloesen: `document.getElementById('pl-setnr').value = 'abc,,99999999-9'; document.getElementById('btn-pl-add').click();`,
    feld: 'pl-setnr',
  },
  {
    name: 'Merkliste',
    hash: '#/merkliste',
    bereit: `!!document.getElementById('mk-kasten')`,
    vorher: `document.getElementById('mk-kasten').open = true;`,
    ausloesen: `document.getElementById('mk-add').click();`,
    feld: 'mk-num',
  },
  {
    name: 'Lagerorte',
    hash: '#/lagerorte',
    bereit: `!!document.querySelector('[data-click="legeLagerortAn"]')?.getClientRects().length`,
    ausloesen: `document.querySelector('[data-click="legeLagerortAn"]').click();`,
    feld: 'storage-new',
  },
  {
    name: 'Passwort',
    hash: '#/konto',
    bereit: `!!document.getElementById('btn-sav-pw')?.getClientRects().length`,
    ausloesen: `document.getElementById('pw-n').value = 'neu-Passwort-1'; document.getElementById('pw-r').value = 'anders-Passwort-1'; document.getElementById('btn-sav-pw').click();`,
    feld: 'pw-r',
  },
  {
    name: 'Preisalarm',
    hash: '#/alarme',
    bereit: `!!document.getElementById('alarm-neu-knopf')?.getClientRects().length`,
    ausloesen: `document.getElementById('alarm-neu-knopf').click();`,
    feld: 'alarm-neu-set',
  },
  {
    name: 'Gutschein',
    hash: '#/gutscheine',
    bereit: `!!document.querySelector('[data-click="gutscheinSpeichern"]')?.getClientRects().length`,
    ausloesen: `document.querySelector('[data-click="gutscheinSpeichern"]').click();`,
    feld: 'v-number',
  },
  {
    name: 'Set erfassen',
    hash: '#/sammlung',
    bereit: `!!document.querySelector('[data-click="oeffneErfassen"][data-arg="set"]')`,
    vorher: `document.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();`,
    ausloesen: `document.getElementById('add-num').value = '10294-1'; document.getElementById('add-price').value = 'abc'; document.getElementById('btn-add').click();`,
    feld: 'add-price',
  },
];

test('Fehlermeldungen verschieben keine Nachbarn', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, { name: `sprung_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
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
    for (const f of FAELLE) {
      await t.test(`${f.name} ${breite} px`, async () => {
        await b.auswerten(`location.hash = '#/'; location.hash = ${JSON.stringify(f.hash)}; true`);
        await bis(f.bereit, f.name);
        await ruhig();
        if (f.vorher) {
          await b.auswerten(`(() => { ${f.vorher} return true; })()`);
          await ruhig();
        }
        // Eine Meldung aus dem vorigen Durchgang räumt das Feld selbst weg, sobald man tippt.
        await b.auswerten(`(() => { const e = document.getElementById(${JSON.stringify(f.feld)});
          e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await ruhig();
        const vor = await b.auswerten(LAGE(f.feld));
        await b.auswerten(`(() => { ${f.ausloesen} return true; })()`);
        await bis(`!document.getElementById(${JSON.stringify(f.feld + '-fehler')})?.hidden`, `${f.name}: Meldung`);
        await ruhig();
        const nach = await b.auswerten(LAGE(f.feld));
        assert.ok(nach.meldung, 'Meldung sichtbar');
        assert.ok(nach.meldung.y >= nach.feld.u - 1, `Meldung unter dem Feld (${nach.meldung.y} < ${nach.feld.u})`);
        assert.ok(nach.meldung.x <= nach.feld.x + 1, `Meldung beginnt am Feld (${nach.meldung.x} > ${nach.feld.x})`);
        // Direkt darunter, nicht unter dem ganzen Formular: höchstens eine Elementzeile (60 px) dazwischen.
        assert.ok(nach.meldung.y - nach.feld.u < 60, `Meldung ${nach.meldung.y - nach.feld.u} px unter dem Feld`);
        assert.equal(nach.teile.length, vor.teile.length);
        const verschoben = vor.teile
          .map((a, i) => ({ a, z: nach.teile[i] }))
          .filter(({ a, z }) => {
            if (Math.abs(a.x - z.x) > 0.5) return true;
            const aufLinie = a.y < vor.feld.u - 1;
            return aufLinie ? Math.abs(a.y - z.y) > 0.5 : z.y < a.y - 0.5;
          })
          .map(({ a, z }) => `${a.was}: (${a.x}|${a.y}) → (${z.x}|${z.y})`);
        assert.deepEqual(verschoben, []);
        await b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
          document.querySelectorAll('.ovl.open [data-dialog-zu]').forEach(x => x.click()); true`);
      });
    }
  }
});
