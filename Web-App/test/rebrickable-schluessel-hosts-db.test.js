/**
 * Der Rebrickable-Schlüssel geht nur an rebrickable.com — auch dann nicht an
 * einen anderen Host der API-Liste, wenn eine Antwort mit `next` dorthin zeigt.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  in holeSetTeile die Prüfung von `next` entfernt UND httpsGetRobust wieder mit
 *      ERLAUBTE_API_HOSTS → rot: „next auf api.upcitemdb.com …“ (Abruf mit Schlüssel gesehen)
 *   B  nur die Hostwahl in httpsGetRobust zurück auf ERLAUBTE_API_HOSTS (next-Prüfung bleibt)
 *      → rot: „Abrufe mit Schlüssel …“ (die next-Prüfung allein fängt diesen Weg nicht)
 *   C  rebrickableRoh wieder mit ERLAUBTE_API_HOSTS → rot: „rebrickableRoh erreicht keinen anderen Host“
 *   D  nur die next-Prüfung entfernt (Hostwahl bleibt) → BLEIBT GRÜN: Die Hostwahl allein
 *      hält den Schlüssel zurück; die next-Prüfung ist das frühe, lesbare Netz davor.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (der Schlüssel liegt in global_settings).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

/** @type {Array<{ url: string, kopf: Record<string, string> }>} */
const abrufe = [];
let antwortFuer = (/** @type {string} */ _url) => ({ status: 404, body: '' });
// @ts-expect-error — Attrappe mit genau dem, was src/infra/abruf.ts benutzt.
https.get = (url, opt, cb) => {
  abrufe.push({ url: String(url), kopf: { .../** @type {Record<string, string>} */ (opt?.headers) } });
  const { status, body } = antwortFuer(String(url));
  const req = new EventEmitter();
  setImmediate(() => {
    const r = /** @type {any} */ (new EventEmitter());
    r.statusCode = status;
    r.headers = {};
    r.resume = () => {};
    r.destroy = () => {};
    cb(r);
    setImmediate(() => {
      r.emit('data', Buffer.from(body));
      r.emit('end');
    });
  });
  return req;
};

test('der Rebrickable-Schlüssel bleibt bei rebrickable.com', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const S = _req('src/einstellungen/settings.js');
  const vorher = await S.getGlobalSetting('rebrickable_api_key');
  await S.setGlobalSetting('rebrickable_api_key', 'geheim-123');
  t.after(async () => {
    if (vorher) await S.setGlobalSetting('rebrickable_api_key', vorher);
    else await S.deleteGlobalSetting('rebrickable_api_key');
  });
  const { holeSetTeile, rebrickableRoh, httpsGetRobust } = _req('src/katalog/quellen.js');
  const mitSchluessel = () => abrufe.filter(a => Object.keys(a.kopf).some(k => k.toLowerCase() === 'authorization'));

  await t.test('next auf api.upcitemdb.com wird nicht verfolgt', async () => {
    abrufe.length = 0;
    antwortFuer = url =>
      url.includes('/lego/sets/')
        ? {
            status: 200,
            body: JSON.stringify({
              results: [{ part: { part_num: 'x' }, color: { id: 1 }, quantity: 1 }],
              next: 'https://api.upcitemdb.com/prod/x',
            }),
          }
        : { status: 200, body: '{}' };
    await holeSetTeile('10294-1');
    assert.ok(abrufe.length >= 1, 'die Attrappe sah keinen Abruf — die Gegenprobe bewiese nichts');
    assert.deepEqual(
      abrufe.filter(a => new URL(a.url).hostname !== 'rebrickable.com').map(a => a.url),
      [],
      'ein Abruf ging an einen anderen Host',
    );
  });

  await t.test('next auf rebrickable.com wird weiter verfolgt', async () => {
    abrufe.length = 0;
    antwortFuer = url =>
      url.includes('page=2')
        ? {
            status: 200,
            body: JSON.stringify({ results: [{ part: { part_num: 'b' }, color: { id: 1 }, quantity: 1 }], next: null }),
          }
        : {
            status: 200,
            body: JSON.stringify({
              results: [{ part: { part_num: 'a' }, color: { id: 1 }, quantity: 1 }],
              next: 'https://rebrickable.com/api/v3/lego/sets/10294-1/parts/?page=2',
            }),
          };
    const r = await holeSetTeile('10294-1');
    assert.equal(r.teile.length, 2, 'die zweite Seite fehlt');
  });

  await t.test('rebrickableRoh erreicht keinen anderen Host', async () => {
    abrufe.length = 0;
    const r = await rebrickableRoh('https://lego.brickinstructions.com/x', 'geheim-123');
    assert.equal(r.status, 0);
    assert.equal(abrufe.length, 0, 'der Abruf mit Schlüssel ging hinaus');
  });

  await t.test(
    'Abrufe mit Schlüssel gehen nur an rebrickable.com; ohne Schlüssel bleibt die EAN-Suche erlaubt',
    async () => {
      abrufe.length = 0;
      antwortFuer = () => ({ status: 200, body: '{}' });
      await httpsGetRobust('https://api.upcitemdb.com/prod/trial/lookup?upc=1', {}, 3000);
      assert.equal(abrufe.length, 1, 'die EAN-Suche ohne Schlüssel muss weiter gehen');
      abrufe.length = 0;
      await httpsGetRobust('https://api.upcitemdb.com/prod/x', { Authorization: 'key geheim-123' }, 3000).catch(
        () => null,
      );
      assert.deepEqual(mitSchluessel(), [], 'ein Abruf mit Schlüssel ging an upcitemdb');
    },
  );
});
