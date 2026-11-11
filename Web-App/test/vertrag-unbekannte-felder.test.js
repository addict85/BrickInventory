/**
 * Strenge Antwortprüfung in Tests: Ein Feld, das der Vertrag nicht nennt, wird
 * gemeldet, auch in offenen Objekten (looseObject), Listen, Unions und
 * Erweiterungen; ein record() beschreibt beliebige Schlüssel und meldet keine.
 * Der zweite Teil prüft die Verdrahtung in vertragsRouter am echten Router.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  in unbekannteFelder() `else if (offen) funde.add(…)` entfernt → rot:
 *      „ein fremdes Feld, auch verschachtelt in Listen“
 *   B  im Zweig 'union' die erste Option statt der passenden genommen → rot:
 *      „in einer Union zählt die Option, die passt“
 *   C  in antwortGegenVertrag() die Zeile `if (fremd.length) fehler.push(…)`
 *      entfernt → rot: „die Route antwortet 500, wenn ein Feld fehlt im Vertrag“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const _req = require('./helpers/sources').buildAndRequire();
const { unbekannteFelder } = _req('src/vertrag/unbekannteFelder.js');

test('ein fremdes Feld, auch verschachtelt in Listen', () => {
  const Zeile = z.looseObject({ id: z.number(), name: z.string().nullable().optional() });
  const Antwort = z.looseObject({ success: z.boolean(), sets: z.array(Zeile) });
  const wert = {
    success: true,
    extra: 1,
    sets: [
      { id: 1, name: null },
      { id: 2, geheim: 'x' },
    ],
  };
  assert.deepEqual(unbekannteFelder(Antwort, wert), ['extra', 'sets.1.geheim']);
  assert.deepEqual(unbekannteFelder(Antwort, { success: true, sets: [{ id: 1 }] }), []);
});

test('Erweiterungen, Hüllen und records', () => {
  const Basis = z.looseObject({ a: z.number() });
  const Mehr = Basis.extend({ b: z.string().optional() });
  assert.deepEqual(unbekannteFelder(Mehr.nullable().optional(), { a: 1, b: 'x', c: 2 }), ['c']);
  const Karte = z.looseObject({ jobs: z.record(z.string(), z.looseObject({ n: z.number() })) });
  assert.deepEqual(unbekannteFelder(Karte, { jobs: { preise: { n: 1, lauf: 2 }, bilder: { n: 2 } } }), [
    'jobs.preise.lauf',
  ]);
});

test('in einer Union zählt die Option, die passt', () => {
  const A = z.looseObject({ art: z.literal('a'), x: z.number() });
  const B = z.looseObject({ art: z.literal('b'), y: z.number() });
  assert.deepEqual(unbekannteFelder(z.union([A, B]), { art: 'b', y: 1 }), []);
  assert.deepEqual(unbekannteFelder(z.union([A, B]), { art: 'b', y: 1, z: 0 }), ['z']);
});

test('die Route antwortet 500, wenn ein Feld fehlt im Vertrag', async () => {
  const { vertragPruefen } = _req('src/http/vertragsRouter.js');
  const pruefer = vertragPruefen();
  assert.ok(pruefer, 'VERTRAG_PRUEFEN ist in Tests gesetzt');
  // GET /api/v1/sets/info/:setNumber: SetInfoResponse nennt kein Feld `geheim`.
  const req = { method: 'GET', baseUrl: '/api/v1', route: { path: '/sets/info/:setNumber' }, body: {} };
  let status = 200;
  let gesendet;
  const res = {
    statusCode: 200,
    locals: {},
    status(s) {
      status = s;
      this.statusCode = s;
      return this;
    },
    json(r) {
      gesendet = r;
      return this;
    },
  };
  pruefer(req, res, () => {});
  res.json({ success: true, set_number: '1-1', name: 'x', geheim: 1 });
  assert.equal(status, 500);
  assert.match(String(gesendet.abweichungen), /nicht im Vertrag: geheim/);

  const res2 = {
    ...res,
    statusCode: 200,
    locals: {},
    json(r) {
      gesendet = r;
      return this;
    },
  };
  status = 200;
  pruefer(req, res2, () => {});
  res2.json({ success: true, set_number: '1-1', name: 'x' });
  assert.equal(status, 200);
});
