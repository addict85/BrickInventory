/**
 * Die Route bekommt Rumpf und Abfrage so, wie der Vertrag sie geprüft hat
 * (req.eingabe, req.abfrage aus eingabePruefen): umgewandelt, ohne unbekannte
 * Felder. Eingaben und Abfragen sind geschlossen; ein unbekanntes Feld ist 400
 * mit dem Code feld_unbekannt. Die Abfrage steht in docs/openapi.json.
 * Ausführlich: docs/begruendungen/test/eingabe-geprueft.test.js.md#kopf
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in eingabePruefen `geprueft.eingabe = r.data` gestrichen → rot: „die
 *      Route sieht den umgewandelten Rumpf“
 *   B  in eingabePruefen `geprueft.abfrage = req.query` statt des Ergebnisses
 *      → rot: „die Route sieht die umgewandelte Abfrage“
 *   C  NeuesSet (vertrag/sets.ts) als z.looseObject → rot: „ein unbekanntes Feld
 *      ist 400“ und „jede Eingabe und Abfrage ist geschlossen“
 *   D  in meldeAbweichung den Zweig unrecognized_keys gestrichen → rot: „ein
 *      unbekanntes Feld ist 400“ und „eine falsche Abfrage ist 400“ (Code
 *      eingabe_ungueltig)
 *   E  in openapi.ts die Abfrageparameter als `in: 'header'` → rot: „die
 *      Abfrage steht in der OpenAPI-Beschreibung“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { vertragsRouter } = _req('src/infra/vertrag/pruefen.js');
const { VERTRAG } = _req('src/infra/vertrag/index.js');

test('geprüfte Eingabe und Abfrage', { concurrency: 1 }, async (t) => {
  let aufrufe = 0;
  const router = vertragsRouter();
  // An res.json vorbei: Die Prüfung der Antwort (Testmodus) gilt dem echten Rumpf.
  const zeige = (req, res) => { aufrufe++; res.type('json').send(JSON.stringify({ eingabe: req.eingabe, abfrage: req.abfrage })); };
  router.post('/sets', zeige);
  router.get('/catalog/sets', zeige);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', router);
  const srv = app.listen(0);
  t.after(() => new Promise((r) => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}/api/v1`;
  const sende = async (pfad, rumpf) => {
    const r = await fetch(basis + pfad, rumpf === undefined ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) });
    return { status: r.status, body: await r.json() };
  };

  await t.test('die Route sieht den umgewandelten Rumpf', async () => {
    const r = await sende('/sets', { set_number: '10179-1', quantity: '3', purchase_price: '12,50', condition: 'U' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.eingabe, { set_number: '10179-1', quantity: 3, purchase_price: 12.5, condition: 'U' });
  });

  await t.test('ein unbekanntes Feld ist 400', async () => {
    const vorher = aufrufe;
    const r = await sende('/sets', { set_number: '10179-1', purchasePrice: 12 });
    assert.deepEqual([r.status, r.body.code], [400, 'feld_unbekannt']);
    assert.match(r.body.error, /purchasePrice/);
    assert.equal(aufrufe, vorher, 'die Route lief trotzdem');
  });

  await t.test('die Route sieht die umgewandelte Abfrage', async () => {
    const r = await sende('/catalog/sets?page=2&theme_id=&q=Haus');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.abfrage, { page: 2, theme_id: null, q: 'Haus' });
  });

  await t.test('eine falsche Abfrage ist 400', async () => {
    const vorher = aufrufe;
    const zahl = await sende('/catalog/sets?page=zwei');
    assert.deepEqual([zahl.status, zahl.body.code], [400, 'eingabe_ungueltig']);
    assert.match(zahl.body.error, /page/);
    const fremd = await sende('/catalog/sets?seite=2');
    assert.deepEqual([fremd.status, fremd.body.code], [400, 'feld_unbekannt']);
    assert.equal(aufrufe, vorher);
  });
});

test('jede Eingabe und Abfrage ist geschlossen', () => {
  // Ausnahmen: Schlüssel-Wert-Listen, deren Schlüssel die Route selbst prüft.
  const OFFEN = ['PUT /api/v1/settings'];
  const offen = [];
  for (const [k, r] of Object.entries(VERTRAG)) {
    for (const s of [r.eingabe, r.abfrage].filter(Boolean)) {
      const def = s._zod.def;
      if (def.type === 'object' ? def.catchall?._zod.def.type !== 'never' : !OFFEN.includes(k)) offen.push(k);
    }
  }
  assert.deepEqual(offen, []);
  assert.ok(Object.values(VERTRAG).filter((r) => r.abfrage).length >= 40, 'zu wenige Routen mit Abfrage');
});

test('die Abfrage steht in der OpenAPI-Beschreibung', () => {
  const dok = _req('src/infra/vertrag/openapi.js').openapi();
  const abfrage = dok.paths['/api/v1/sets'].get.parameters.filter((p) => p.in === 'query');
  assert.deepEqual(abfrage.map((p) => p.name).sort(), ['accounts', 'page', 'page_size', 'search', 'sort', 'storage', 'theme']);
  assert.equal(abfrage.find((p) => p.name === 'page').schema.type, 'string');
  const alle = Object.values(dok.paths).flatMap((o) => Object.values(o)).flatMap((op) => op.parameters ?? [])
    .filter((p) => p.in === 'query');
  assert.ok(alle.length >= 80, `nur ${alle.length} Abfrageparameter in der OpenAPI-Beschreibung`);
});
