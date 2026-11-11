/**
 * Antworten von Rebrickable und Brickset laufen durch ihre zod-Schemas
 * (clients/antworten.ts): Eine passende Antwort kommt typisiert an, eine
 * unerwartete Form ist ein Fehler statt leerer Felder. HTTP über eine
 * Attrappe von https.get, Schlüssel und Kontingent über die echte Datenbank.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  in rbGet() wieder `return JSON.parse(body)` statt pruefeAntwort → rot:
 *      „Rebrickable: eine Antwort ohne set_num ist ein Fehler“
 *   B  in parseResponse() (Brickset) die zweite Prüfung entfernt (`return data`)
 *      → rot: „Brickset: ein Set ohne Nummer gilt nicht als Treffer“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

/** Jede Anfrage bekommt 200 mit `koerper` als JSON. */
async function mitKoerper(koerper, lauf) {
  const echt = https.get;
  // @ts-expect-error — Attrappe mit genau dem, was src/infra/abruf.ts benutzt.
  https.get = (_u, _o, beiAntwort) => {
    const r = Object.assign(Readable.from([Buffer.from(JSON.stringify(koerper))]), { statusCode: 200, headers: {} });
    // @ts-expect-error — kein vollständiges IncomingMessage
    setImmediate(() => beiAntwort(r));
    return Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
  };
  try {
    return await lauf();
  } finally {
    https.get = echt;
  }
}

test('Fremdantworten gegen ihr Schema', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const S = _req('src/einstellungen/settings.js');
  const k = _req('src/katalog/apiKontingent.js');
  t.after(async () => {
    await db.run("DELETE FROM global_settings WHERE key IN ('rebrickable_api_key', 'brickset_api_key')");
    await db.pool.end().catch(() => {});
  });
  await S.setGlobalSetting('rebrickable_api_key', 'rb-test');
  await S.setGlobalSetting('brickset_api_key', 'bs-test');
  await k.setzeKontingentZurueck('rebrickable');
  await k.setzeKontingentZurueck('brickset');
  const rb = _req('clients/rebrickable.js');
  const bs = _req('clients/brickset.js');

  await t.test('Rebrickable: eine passende Antwort kommt typisiert an', async () => {
    const set = await mitKoerper(
      { set_num: '10294-1', name: 'Titanic', year: 2021, theme_id: 721, num_parts: 9090 },
      () => rb.holeSet('10294-1'),
    );
    assert.equal(set.name, 'Titanic');
    assert.equal(set.num_parts, 9090);
  });

  await t.test('Rebrickable: eine Antwort ohne set_num ist ein Fehler', async () => {
    await assert.rejects(
      mitKoerper({ name: 'kaputt' }, () => rb.holeSet('10294-1')),
      /Rebrickable: unerwartete Antwort \(set_num/,
    );
  });

  await t.test('Brickset: ein Treffer wird gelesen', async () => {
    const r = await mitKoerper(
      {
        status: 'success',
        matches: 1,
        sets: [{ number: '10294', numberVariant: 1, name: 'Titanic', year: 2021, pieces: 9090 }],
      },
      () => bs.getSetByEan('5702016914313'),
    );
    assert.deepEqual(r, {
      set_number: '10294-1',
      name: 'Titanic',
      year: 2021,
      theme: null,
      pieces: 9090,
      image_url: null,
    });
  });

  await t.test('Brickset: ein Set ohne Nummer gilt nicht als Treffer', async () => {
    const r = await mitKoerper({ status: 'success', matches: 1, sets: [{ name: 'ohne Nummer' }] }, () =>
      bs.getSetByEan('5702016914313'),
    );
    assert.equal(r, null);
  });
});
