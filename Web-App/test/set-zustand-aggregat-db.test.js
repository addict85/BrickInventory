/**
 * Zustand und Aggregat eines Sets gegen die Datenbank: was set-condition-aggregate.test.js
 * vorher als Muster im Quelltext suchte, hier an Ergebnissen.
 *
 * Gegenproben (08.11.2026 gemessen, jeweils zurückgenommen):
 *   A  getSetConditionAggregate ohne max_purchase_price → rot „getSet liefert
 *      dieselben Aggregatfelder …“
 *   B  erfassungAendern gibt die nackte Antwort ohne withSetAggregate zurück →
 *      rot „beide Wege einer Erfassung …“ (und der folgende Fall, der auf
 *      dessen Teil aufbaut)
 *   C  POST /api/v1/sets reicht `null` statt des Zustands an addSet → rot
 *      „der im Formular gewählte Zustand kommt beim Anlegen an“
 *   D  getCurrentMarketPrice: `if (!condition)` → `if (true)` → rot „ein
 *      ausdrücklich angefragter Zustand …“ und „der Marktpreis als Kaufpreis …“
 *   E  conditionFromAcquisitions liefert bei Erfassungen immer 'N' → rot
 *      „getSet …“ und „manuelle Teile und Minifiguren …“
 *   F  probeErfassungen sortiert nach `added_at` → rot „die Preis-Probe …“;
 *      ohne `price_cache: cacheRows` in der Antwort ebenso
 *   G  priceFor() in setValue.ts nimmt immer den Neupreis → rot „computePnl
 *      bewertet nach dem Zustand der Erfassungen“ (effectiveCondition allein
 *      auf 'N' gestellt bleibt grün: Mit Erfassungen gilt deren Zustand)
 *   H  (09.11.2026) Route und Vertrag der Preis-Probe wieder als GET → rot
 *      „die Preis-Probe …“ (GET 200 statt 404)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der Nachzug nach dem Erfassen läuft sonst nach dem Test gegen einen
// geschlossenen Pool; addSet lässt sich für die Route stellen.
/** @type {null | ((...a: unknown[]) => Promise<unknown>)} */
let gestellteAddSet = null;
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (/** @type {string} */ name, /** @type {any[]} */ ...rest) {
  const m = _echtesRequire.call(this, name, ...rest);
  if (typeof name === 'string' && /[/\\]erfassen(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) => (k === 'setErfassen' && gestellteAddSet ? (_sk, ...a) => gestellteAddSet?.(...a) : t[k]),
    });
  return m;
};

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');

test('Zustand und Aggregat eines Sets', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const P = process.pid;
  const NAME = `zustand-agg-${P}`;
  const SN = `${80000 + (P % 900)}-1`;
  const PN = `za${P}`;
  const FN = `fig-za${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM sets WHERE set_number = $1', [SN]);
  };
  await weg();
  t.after(async () => {
    await weg().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1,'x',true) RETURNING id`, [NAME])
  ).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  for (const [z, preis] of [
    ['N', 55],
    ['U', 33],
  ])
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`, [
      SN,
      z,
      preis,
    ]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  const erste = (
    await db.get(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                               VALUES ($1,$2,2,100,'N','CHF', NOW() - INTERVAL '10 days') RETURNING id`,
      [uid, SN],
    )
  ).id;

  await verwalterMitFaktor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t });
  const anfrage = async (
    /** @type {string} */ methode,
    /** @type {string} */ pfad,
    /** @type {unknown} */ rumpf = undefined,
  ) => {
    const r = await fetch(base + '/api/v1' + pfad, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: rumpf === undefined ? undefined : JSON.stringify(rumpf),
    });
    return { status: r.status, body: await r.json() };
  };
  const { getSets, getSet } = _req('src/sets/index.js');

  await t.test('ein ausdrücklich angefragter Zustand schlägt die Erfassungs-Bewertung', async () => {
    const { getCurrentMarketPrice } = _req('src/finanzen/marketPrice.js');
    assert.equal(await getCurrentMarketPrice(SN, uid), 55, 'ohne Wunsch: nach den (neuen) Erfassungen');
    assert.equal(
      await getCurrentMarketPrice(SN, uid, 'U'),
      33,
      'Der angefragte Zustand wurde von der Bewertung der Erfassungen überstimmt',
    );
  });

  await t.test('der Marktpreis als Kaufpreis richtet sich nach dem gewählten Zustand', async () => {
    const { addSet } = _req('src/sets/index.js');
    const r = await addSet({ setNumber: SN, menge: 1, konto: uid, zustand: 'U' });
    assert.equal(r.action, 'updated', 'Aufbau: der Aufstock-Weg ohne Katalog und Netz');
    const neu = await db.get(
      `SELECT condition, purchase_price::float AS preis FROM set_acquisitions
        WHERE user_id = $1 AND set_number = $2 AND id <> $3`,
      [uid, SN, erste],
    );
    assert.deepEqual(neu, { condition: 'U', preis: 33 }, 'Gebraucht erfasst, aber der Neupreis eingetragen');
  });

  await t.test('getSet liefert dieselben Aggregatfelder wie getSets', async () => {
    const liste = (await getSets([uid], {})).sets.find((/** @type {any} */ s) => s.set_number === SN);
    const einzeln = await getSet([uid], SN);
    assert.ok(liste && einzeln, 'Das Set fehlt in einer der beiden Antworten');
    for (const feld of ['condition', 'acq_count', 'used_count', 'max_purchase_price']) {
      assert.ok(einzeln[feld] !== undefined && einzeln[feld] !== null, `getSet() ohne ${feld}`);
      assert.equal(
        String(einzeln[feld]),
        String(liste[feld]),
        `${feld}: getSet ${einzeln[feld]}, getSets ${liste[feld]}`,
      );
    }
    assert.equal(einzeln.condition, 'U', 'eine gebrauchte Erfassung macht das Set gebraucht');
    assert.equal(Number(einzeln.used_count), 1);
  });

  await t.test('beide Wege einer Erfassung liefern das Aggregat mit — nur bei Sets', async () => {
    const geaendert = await anfrage('PUT', `/sets/${SN}/acquisitions/${erste}`, { condition: 'U' });
    assert.equal(geaendert.status, 200, JSON.stringify(geaendert.body));
    assert.equal(geaendert.body.set?.set_number, SN, 'Die Antwort auf das Ändern trägt kein Set-Aggregat');
    assert.equal(geaendert.body.set.acq_count, 2);
    assert.equal(geaendert.body.set.used_count, 2);
    const geloescht = await anfrage('DELETE', `/sets/${SN}/acquisitions/${erste}`);
    assert.equal(geloescht.status, 200, JSON.stringify(geloescht.body));
    assert.equal(geloescht.body.set?.acq_count, 1, 'Die Antwort auf das Löschen trägt kein aktuelles Aggregat');

    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,5,'manual')`, [uid, PN]);
    const tid = (
      await db.get(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
                               VALUES ($1,$2,5,1,1,'N') RETURNING id`,
        [uid, PN],
      )
    ).id;
    const teil = await anfrage('PUT', `/parts/${PN}/5/acquisitions/${tid}`, { quantity: 2 });
    assert.equal(teil.status, 200, JSON.stringify(teil.body));
    assert.equal(teil.body.set, undefined, 'Ein Teil hat kein Set-Aggregat');
  });

  await t.test('manuelle Teile und Minifiguren nutzen dieselbe Zustandsregel wie Sets', async () => {
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
                  VALUES ($1,$2,5,1,1,'U')`,
      [uid, PN],
    );
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
                  VALUES ($1,$2,1,1,'N'), ($1,$2,1,1,'U')`,
      [uid, FN],
    );
    const { getManualParts } = _req('src/teile/abfragen.js');
    const { getManualMinifigs } = _req('src/figuren/abfragen.js');
    const teil = (await getManualParts([uid], uid, {})).find((/** @type {any} */ p) => p.part_number === PN);
    const figur = (await getManualMinifigs([uid], uid, {})).find((/** @type {any} */ f) => f.fig_number === FN);
    assert.equal(teil?.condition, 'U', 'Teil mit gebrauchter Erfassung steht als neu da');
    assert.equal(figur?.condition, 'U', 'Figur mit gebrauchter Erfassung steht als neu da');
  });

  await t.test('computePnl bewertet nach dem Zustand der Erfassungen', async () => {
    const { computePnl } = _req('src/finanzen/financeCalc.js');
    const pnl = await computePnl(uid, [uid]);
    const zeile = pnl.sets.find((/** @type {any} */ s) => s.set_number === SN);
    assert.ok(zeile, 'Das Set fehlt in der Gewinn-und-Verlust-Rechnung');
    assert.equal(
      Number(zeile.current_price),
      33,
      `Ein gebraucht erfasstes Set bekommt den Neupreis: ${JSON.stringify(zeile)}`,
    );
  });

  await t.test('die Preis-Probe läuft ohne Serverfehler', async () => {
    // Per GET löste schon ein Link einer fremden Seite (Lax-Cookie) den Abruf aus.
    const perLink = await fetch(`${base}/api/v1/admin/price-probe?set=${SN}&live=1`);
    assert.equal(perLink.status, 404, 'die Probe lässt sich per GET auslösen');
    const r = await anfrage('POST', '/admin/price-probe', { set: SN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.condition_logic?.chosen_for_price, 'U', 'Die Probe zeigt nicht die Regel der Bewertung');
    assert.deepEqual(
      r.body.price_cache.map((/** @type {any} */ z) => z.condition).sort(),
      ['N', 'U'],
      'Die Cache-Zeilen des Sets gehören in die Antwort',
    );
  });

  await t.test('der im Formular gewählte Zustand kommt beim Anlegen an', async () => {
    /** @type {any[][]} */
    const aufrufe = [];
    gestellteAddSet = async (...a) => {
      aufrufe.push(a);
      return {
        action: 'added',
        set_number: /** @type {any} */ (a[0]).setNumber,
        name: 'Testset',
        katalog_offen: true,
        ergaenzung: 'ausstehend',
        besitzer: uid,
      };
    };
    try {
      const r = await anfrage('POST', '/sets', {
        set_number: `${90000 + (P % 900)}-1`,
        purchase_price: 20,
        condition: 'u',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    } finally {
      gestellteAddSet = null;
    }
    assert.equal(aufrufe.length, 1, 'setErfassen wurde nicht gerufen');
    assert.equal(aufrufe[0][0].kaufpreis, 20, 'Der Kaufpreis kommt nicht an');
    assert.equal(aufrufe[0][0].zustand, 'U', 'Der Zustand aus dem Formular kommt nicht bei setErfassen an');
  });
});
