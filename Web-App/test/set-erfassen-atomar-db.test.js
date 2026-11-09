/**
 * Ein Set erfassen: Prüfen und Anlegen in einem Schritt, ohne Netz in der
 * Anfrage; Katalog, Bild und Marktpreis holt der Auftrag „nacharbeit/ergaenzen“.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in setErfassen() den Aufruf repo.sperreSetErfassen() entfernt → rot:
 *      „gleichzeitig erfasst, genau einmal angelegt“ (8 statt 1 'added')
 *   B  in setErfassen() vor dem Anlegen `await getSetInfo(sn)` eingefügt → rot:
 *      „die Anfrage fragt kein Netz …“ (Netzaufrufe 1 statt 0)
 *   C  in setErfassen() stelleAuftragEin() weggelassen → rot: „… und stellt den Auftrag ein“
 *   D  in setErgaenzen() die Schleife über die Erfassungen ohne Preis entfernt →
 *      rot: „der Auftrag ergänzt Katalog und Kaufpreis“ (Preis null)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Jede Quelle im Netz gestellt und gezählt, bevor ein Dienst sie lädt.
const netz = [];
const Module = require('node:module');
const _echt = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _echt.call(this, name, ...rest);
  if (typeof name !== 'string') return m;
  if (/rebrickableKatalog(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'getSetInfo'
          ? async sn => {
              netz.push(`rebrickable ${sn}`);
              return { name: 'Testset', year: 2020, theme: 'Test', pieces: 10, image_url: null };
            }
          : t[k],
    });
  if (/finanzen[/\\]marketPrice(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'getCurrentMarketPrice'
          ? async sn => {
              netz.push(`preis ${sn}`);
              return 42;
            }
          : t[k],
    });
  if (/bilder[/\\]setImages(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'downloadSetImage'
          ? async (_u, sn) => {
              netz.push(`bild ${sn}`);
              return null;
            }
          : t[k],
    });
  if (/katalog[/\\]quellen(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => (k === 'brickset' ? { getSetInfo: async () => null } : t[k]) });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('Set erfassen ohne Netz und ohne Wettlauf', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const sets = _req('src/sets/index.js');
  const P = process.pid % 100000;
  const HAUPT = `erf-haupt-${P}`,
    KIND = `erf-kind-${P}`;
  const SN = `${70000 + (P % 9000)}-1`,
    SN2 = `${80000 + (P % 9000)}-1`;
  const weg = async () => {
    for (const sn of [SN, SN2]) {
      await db.run('DELETE FROM set_acquisitions WHERE set_number = $1', [sn]);
      await db.run('DELETE FROM sets WHERE set_number = $1', [sn]);
      await db.run('DELETE FROM set_catalog WHERE set_number = $1', [sn]);
      await db.run("DELETE FROM auftraege WHERE art = 'nacharbeit' AND nutzlast->>'set_number' = $1", [sn]);
    }
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, KIND]]);
  };
  await weg();
  const neu = async n =>
    (await db.get("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [n])).id;
  const haupt = await neu(HAUPT),
    kind = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, kind]);
  t.after(async () => {
    await weg().catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('gleichzeitig erfasst, genau einmal angelegt', async () => {
    // Das Hauptkonto sieht beide Konten; es legt teils für sich, teils für das Kind an.
    const fuer = [haupt, kind, haupt, kind, haupt, kind, haupt, kind];
    const r = await Promise.all(
      fuer.map(b => sets.setErfassen({ anfragender: haupt, besitzerWunsch: b, setNumber: SN, kaufpreis: null })),
    );
    assert.equal(r.filter(x => x.action === 'added').length, 1, JSON.stringify(r.map(x => x.action)));
    const zeilen = await db.all('SELECT user_id FROM sets WHERE set_number = $1', [SN]);
    assert.equal(zeilen.length, 1, 'Das Set steht mehrfach im Haushalt');
    const erf = await db.all('SELECT quantity, purchase_price FROM set_acquisitions WHERE set_number = $1', [SN]);
    assert.deepEqual(
      erf.map(z => [z.quantity, z.purchase_price]),
      [[1, null]],
      'genau eine Erfassung, noch ohne Preis',
    );
  });

  await t.test('die Anfrage fragt kein Netz und stellt den Auftrag ein', async () => {
    netz.length = 0;
    const { base } = testServer(_req, {
      sitzung: {},
      apiNutzer: { user_id: haupt, is_admin: 0 },
      routen: { '/api/v1': 'routes/api_v1/index.js' },
      t,
    });
    const r = await fetch(`${base}/api/v1/sets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: SN2, condition: 'U' }),
    });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(
      {
        action: j.action,
        set_number: j.set_number,
        name: j.name,
        katalog_offen: j.katalog_offen,
        ergaenzung: j.ergaenzung,
      },
      { action: 'added', set_number: SN2, name: `Set ${SN2}`, katalog_offen: true, ergaenzung: 'ausstehend' },
    );
    assert.deepEqual(netz, [], 'Netzaufrufe in der Anfrage');
    const a = await db.get(
      "SELECT nutzlast, schluessel FROM auftraege WHERE art = 'nacharbeit' AND nutzlast->>'set_number' = $1",
      [SN2],
    );
    assert.ok(a, 'kein Auftrag eingestellt');
    assert.equal(a.nutzlast.art, 'ergaenzen');
    assert.equal(a.schluessel, `nacharbeit:${haupt}:${SN2}`);
  });

  await t.test('der Auftrag ergänzt Katalog und Kaufpreis', async () => {
    netz.length = 0;
    await sets.setErgaenzen(SN2, haupt);
    const kat = await db.get('SELECT name, year FROM set_catalog WHERE set_number = $1', [SN2]);
    assert.deepEqual({ name: kat.name, year: kat.year }, { name: 'Testset', year: 2020 });
    const erf = await db.get(
      'SELECT purchase_price, price_estimated, condition FROM set_acquisitions WHERE user_id = $1 AND set_number = $2',
      [haupt, SN2],
    );
    assert.deepEqual(
      { preis: Number(erf.purchase_price), geschaetzt: erf.price_estimated, zustand: erf.condition },
      { preis: 42, geschaetzt: true, zustand: 'U' },
    );
    assert.ok(netz.includes(`rebrickable ${SN2}`) && netz.includes(`preis ${SN2}`), JSON.stringify(netz));
    // Ein zweiter Lauf fragt den Katalog nicht noch einmal: Strom und Auftrag stören sich nicht.
    netz.length = 0;
    await sets.setErgaenzen(SN2, haupt);
    assert.equal(netz.filter(x => x.startsWith('preis')).length, 0, 'der Preis wurde doppelt geholt');
  });
});
