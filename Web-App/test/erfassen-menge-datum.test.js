/**
 * Anzahl und Kaufdatum beim Erfassen: Was keine Stückzahl von 1 bis 10.000 ist oder in der Zukunft liegt,
 * meldet das Feld und geht nicht an den Server. Früher wurden 0, leer und 1,5 stillschweigend zu 1,
 * −3 und 99999 kamen erst als Toast zurück, ein Datum von 2099 wurde übernommen.
 * Geprüft am echten Bündel in jsdom über die Anfragen, die die Oberfläche schickt.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  in doAddSet() wieder parseInt(...)||1 statt mengeAusFeld() → rot: „Set hinzufügen: Anzahl“ und
 *      „englisch“ (0 und 1,5 gingen als 1 hinaus, kein Hinweis am Feld)
 *   B  in mengeAusFeld() die Obergrenze entfernt → rot: „Set hinzufügen: Anzahl“ und „Kaufpreis-Dialog“
 *      (99999 gesendet)
 *   C  kaufdatumGueltig() meldet nie → rot: „Gekauft am“, „Teil und Figur“ und „Kaufpreis-Dialog“
 *      (2099 gesendet)
 *   E  in acqSave() die Menge wieder per Math.max(1, …) geklemmt → rot: „Kaufpreis-Dialog“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, takt, warte } = require('./helpers/oberflaeche');

const fehlerAm = (d, id) => {
  const e = d.getElementById(id + '-fehler');
  return e && !e.hidden ? e.textContent : '';
};

async function setErfassen(o, { qty, datum = null }) {
  const { d, aufrufe } = o;
  d.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();
  await takt(10);
  d.getElementById('add-num').value = '10294-1';
  d.getElementById('add-qty').value = qty;
  if (datum) d.getElementById('add-date').value = datum;
  const vorher = aufrufe.length;
  d.getElementById('btn-add').click();
  await takt(30);
  const a = aufrufe.slice(vorher).find(x => x.url.includes('/sets/add-stream'));
  return {
    gesendet: a ? JSON.parse(a.body) : null,
    qtyFehler: fehlerAm(d, 'add-qty'),
    datumFehler: fehlerAm(d, 'add-date'),
  };
}

test('Set hinzufügen: Anzahl nur ganz von 1 bis 10.000, sonst Hinweis am Feld', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    for (const roh of ['0', '', '1.5', '-3', '99999', '10001', 'abc']) {
      const r = await setErfassen(o, { qty: roh });
      assert.equal(r.gesendet, null, `„${roh}“ ging an den Server`);
      assert.match(r.qtyFehler, /ganze Zahl von 1 bis 10\.000/, `„${roh}“: kein Hinweis am Feld`);
      assert.equal(o.d.getElementById('add-qty').getAttribute('aria-invalid'), 'true');
    }
    for (const [roh, soll] of [
      ['1', 1],
      ['7', 7],
      ['10000', 10000],
    ]) {
      const r = await setErfassen(o, { qty: roh });
      assert.equal(r.qtyFehler, '', `„${roh}“ gemeldet`);
      assert.equal(r.gesendet?.quantity, soll);
    }
  } finally {
    o.w.close();
  }
});

test('Set hinzufügen: Hinweis englisch', async () => {
  const o = await oeffneOberflaeche({}, { sprache: 'en', browserSprache: 'en-GB' });
  try {
    const r = await setErfassen(o, { qty: '0' });
    assert.equal(r.qtyFehler, 'The quantity must be a whole number from 1 to 10,000.');
  } finally {
    o.w.close();
  }
});

test('Set hinzufügen: „Gekauft am“ nicht in der Zukunft', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    const r = await setErfassen(o, { qty: '1', datum: '2099-01-01' });
    assert.equal(r.gesendet, null, 'Zukunftsdatum ging an den Server');
    assert.match(r.datumFehler, /Zukunft/);
    const heute = new Date();
    const iso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
    assert.equal(o.d.getElementById('add-date').max, iso, 'max steht nicht auf heute');
    const ok = await setErfassen(o, { qty: '1', datum: iso });
    assert.equal(ok.datumFehler, '');
    assert.equal(ok.gesendet?.date, iso);
  } finally {
    o.w.close();
  }
});

test('Teil und Figur hinzufügen: ungültige Anzahl und Zukunftsdatum gehen nicht hinaus', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    const { d, aufrufe } = o;
    for (const [art, nr, knopf, post] of [
      ['part', 'ap', 'btn-add-part', '/parts'],
      ['fig', 'af', 'btn-add-fig', '/minifigs'],
    ]) {
      d.querySelector(`[data-click="oeffneErfassen"][data-arg="${art}"]`).click();
      await takt(10);
      d.getElementById(nr + '-num-inline').value = art === 'part' ? '3001' : 'fig-001';
      for (const [qty, datum, fehlerId] of [
        ['0', null, nr + '-qty-inline'],
        ['1', '2099-01-01', nr + '-date'],
      ]) {
        d.getElementById(nr + '-qty-inline').value = qty;
        if (datum) d.getElementById(nr + '-date').value = datum;
        const vorher = aufrufe.length;
        d.getElementById(knopf).click();
        await takt(30);
        assert.equal(
          aufrufe.slice(vorher).filter(a => a.method === 'POST' && a.url.endsWith(post)).length,
          0,
          `${art}: ${qty}/${datum} ging hinaus`,
        );
        assert.notEqual(fehlerAm(d, fehlerId), '', `${art}: kein Hinweis an ${fehlerId}`);
      }
    }
  } finally {
    o.w.close();
  }
});

async function kaufpreisDialog(puts) {
  const o = await oeffneOberflaeche(
    {
      '/v1/sets/10294-1/acquisitions': () => ({
        success: true,
        acquisitions: [
          { id: 7, quantity: 2, condition: 'N', purchase_price: 129.99, created_at: '2026-06-01T10:00:00Z' },
        ],
        totals: { quantity: 2, amount: 259.98 },
      }),
      '/v1/sets/10294-1/acquisitions/7': (_url, opt) => {
        puts.push(JSON.parse(opt.body));
        return { success: true };
      },
    },
    { browserSprache: 'de-DE' },
  );
  const knopf = o.d.createElement('button');
  knopf.dataset.click = 'openAcqModal';
  knopf.dataset.arg = '10294-1';
  o.d.body.append(knopf);
  knopf.click();
  await warte(() => o.d.getElementById('acq-menge-7'));
  return o;
}

test('Kaufpreis-Dialog: Anzahl und Datum melden am Feld, gültige gehen hinaus', async () => {
  const puts = [];
  const o = await kaufpreisDialog(puts);
  try {
    const { d, w } = o;
    const menge = d.getElementById('acq-menge-7');
    for (const roh of ['0', '', '-1', '10001']) {
      menge.value = roh;
      menge.dispatchEvent(new w.FocusEvent('blur'));
      await takt(30);
      assert.equal(puts.length, 0, `Anzahl „${roh}“ ging hinaus`);
      assert.match(fehlerAm(d, 'acq-menge-7'), /ganze Zahl/, `Anzahl „${roh}“ ohne Hinweis`);
    }
    menge.value = '3';
    menge.dispatchEvent(new w.FocusEvent('blur'));
    await warte(() => puts.length);
    assert.deepEqual(puts[0], { quantity: 3 });

    d.activeElement?.blur();
    await o.ruhig();
    puts.length = 0;
    const datum = d.getElementById('acq-datum-feld-7');
    assert.ok(datum.max, 'Datumsfeld ohne max');
    datum.value = '2099-01-01';
    datum.dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(30);
    assert.equal(puts.filter(p => 'date' in p).length, 0, 'Zukunftsdatum ging hinaus');
    assert.match(fehlerAm(d, 'acq-datum-feld-7'), /Zukunft/);
  } finally {
    o.w.close();
  }
});
