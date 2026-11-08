/**
 * Der Import einer Wanted-Liste lässt sich nicht zweimal anstossen: am echten
 * Bündel in jsdom, mit einer Serverantwort, die der Test zurückhält, bricht
 * oder stückweise schickt.
 * Ausführlich: docs/begruendungen/test/wanted-import-riegel.test.js.md#kopf
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln, danach zurückgenommen):
 *   A  `_laeuft` aus der Bedingung in lies() entfernt → rot: „ein zweiter
 *      Klick startet keinen zweiten Lauf“ (zwei Anfragen)
 *   B  im finally von lies() `_laeuft = false;` gestrichen → rot: „der Riegel
 *      geht auch nach einem Fehler wieder auf“ (ein Fehler, der aus dem Lauf
 *      herausfliegt, liesse sich in jsdom nur als unbehandelte Zurückweisung
 *      auslösen, die der Test-Runner dem Test anrechnet)
 *   C  `_laeuft ||` aus der Zeile für den Schreibknopf gestrichen → rot: „ein
 *      zweiter Klick …“ (Schreiben während des Laufs bedienbar)
 *   D  die Zeile `if (_laeuft) { … return; }` in wantedXmlGewaehlt entfernt →
 *      rot: „ein zweiter Klick …“ (neue Datei während des Laufs angenommen)
 *   E  in liesStrom `rest = zeilen.pop() ?? ''` → `rest = ''` → rot: „der
 *      Fortschritt kommt stückweise an …“ (Bericht über zwei Stücke zerbricht)
 *   F  `p.set('strom', '1')` gestrichen → rot: dieselbe Prüfung
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const BERICHT = { success: true, vorschau: true, gelesen: 1, posten: [], angelegt: 0, aufgestockt: 0, fehler: 0 };

/** Öffnet die Oberfläche; Anfragen an den XML-Import beantwortet `antwort(nr)` (Promise einer Response). */
async function mitImport(antwort) {
  const o = await oeffneOberflaeche();
  const importe = [];
  const davor = o.w.fetch;
  o.w.fetch = (url, opt) => {
    if (!String(url).includes('/wanted-list/import/xml')) return davor(url, opt);
    importe.push(String(url));
    return antwort(importe.length);
  };
  const waehle = name => {
    const feld = o.d.getElementById('wanted-xml-part');
    Object.defineProperty(feld, 'files', { configurable: true, value: [new o.w.File(['<INVENTORY/>'], name)] });
    feld.dispatchEvent(new o.w.Event('change', { bubbles: true }));
  };
  const knopf = id => o.d.getElementById(id);
  return { ...o, importe, waehle, knopf };
}

const alsJson = d => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => d });

test('ein zweiter Klick startet keinen zweiten Lauf, eine neue Datei wird abgewiesen', async () => {
  let freigeben;
  const { w, d, importe, waehle, knopf } = await mitImport(
    () =>
      new Promise(r => {
        freigeben = () => r(alsJson(BERICHT));
      }),
  );
  try {
    waehle('liste.xml');
    assert.ok(await warte(() => importe.length === 1), 'Die Datei startet keinen Lauf');
    assert.deepEqual(
      [knopf('wanted-xml-neu').disabled, knopf('wanted-xml-schreiben').disabled],
      [true, true],
      'Während des Laufs sind beide Knöpfe gesperrt',
    );
    // Gesperrt hin oder her: auch ein ausgelöster Klick und eine neue Datei laufen ins Leere.
    knopf('wanted-xml-neu').disabled = false;
    knopf('wanted-xml-neu').click();
    knopf('wanted-xml-schreiben').disabled = false;
    knopf('wanted-xml-schreiben').click();
    waehle('andere.xml');
    assert.ok(await warte(() => d.querySelector('#toasts .toast')), 'Keine Meldung zur abgewiesenen Datei');
    assert.equal(importe.length, 1, 'Ein zweiter Import addierte die Mengen auf');
    // Zurück auf gesperrt, wie es knoepfeStand() hielte: Die Freigabe muss die Vorschau bringen.
    knopf('wanted-xml-neu').disabled = true;
    knopf('wanted-xml-schreiben').disabled = true;
    freigeben();
    assert.ok(await warte(() => d.getElementById('wanted-xml-sub').textContent !== ''), 'Die Vorschau kommt nicht');
    assert.deepEqual(
      [knopf('wanted-xml-neu').disabled, knopf('wanted-xml-schreiben').disabled],
      [false, false],
      'Nach der Vorschau sind beide Knöpfe frei',
    );
    assert.equal(d.getElementById('wanted-xml-sub').textContent, 'liste.xml', 'Die Datei wurde ausgetauscht');
    // Neu einlesen bei stehender Vorschau: Auch jetzt ist Schreiben gesperrt, solange es läuft.
    knopf('wanted-xml-neu').click();
    assert.ok(await warte(() => importe.length === 2));
    assert.equal(knopf('wanted-xml-schreiben').disabled, true, 'Schreiben ist während des Neueinlesens bedienbar');
    freigeben();
    assert.ok(await warte(() => !knopf('wanted-xml-schreiben').disabled));
  } finally {
    w.close();
  }
});

test('der Riegel geht auch nach einem Fehler wieder auf', async () => {
  const { w, importe, waehle, knopf } = await mitImport(async nr => {
    if (nr === 1) throw new Error('Netz weg');
    return alsJson(BERICHT);
  });
  try {
    waehle('liste.xml');
    assert.ok(await warte(() => importe.length === 1));
    assert.ok(await warte(() => !knopf('wanted-xml-neu').disabled), 'Nach dem Fehler bleibt der Dialog gesperrt');
    knopf('wanted-xml-neu').click();
    assert.ok(await warte(() => importe.length === 2), 'Neu einlesen startet nach dem Fehler nichts');
  } finally {
    w.close();
  }
});

test('der Fortschritt kommt stückweise an und füllt den Balken', async () => {
  const stuecke = [
    `${JSON.stringify({ fortschritt: { phase: 'rebrickable', fertig: 1, gesamt: 4 } })}\n{"success":true,"vorschau":tr`,
    `ue,"gelesen":7,"posten":[]}\n`,
  ];
  let weiter;
  const { w, d, importe, waehle } = await mitImport(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/x-ndjson' },
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: async () => {
            if (i === 1)
              await new Promise(r => {
                weiter = r;
              });
            return i < stuecke.length ? { value: new TextEncoder().encode(stuecke[i++]), done: false } : { done: true };
          },
        };
      },
    },
  }));
  try {
    const box = d.getElementById('wanted-xml-fortschritt');
    const wrap = d.getElementById('wanted-xml-balken-wrap');
    assert.equal(box.style.display, 'none', 'Der Balken steht vor dem Lauf leer da');
    assert.deepEqual(
      [wrap.getAttribute('role'), wrap.getAttribute('aria-valuemin'), wrap.getAttribute('aria-valuemax')],
      ['progressbar', '0', '100'],
    );
    waehle('liste.xml');
    assert.ok(await warte(() => typeof weiter === 'function'));
    assert.match(importe[0], /[?&]strom=1\b/, 'Ohne strom=1 antwortet der Server in einem Stück');
    assert.equal(box.style.display, '');
    assert.equal(wrap.getAttribute('aria-valuenow'), '25');
    assert.match(d.getElementById('wanted-xml-fortschritt-text').textContent, /1.*4/);
    weiter();
    assert.ok(
      await warte(() => /7/.test(d.getElementById('wanted-xml-bericht').textContent)),
      `Der Bericht über zwei Stücke kommt nicht an: ${d.getElementById('wanted-xml-bericht').textContent}`,
    );
    assert.equal(box.style.display, 'none', 'Nach dem Lauf verschwindet der Balken');
  } finally {
    w.close();
  }
});
