/**
 * Ein Set erfassen: Prüfen und Anlegen in einem Schritt, ohne Netz in der
 * Anfrage; Katalog, Bild und Marktpreis holt der Auftrag „nacharbeit/ergaenzen“.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in setErfassen() den Aufruf repo.addLockSet() entfernt → rot:
 *      „gleichzeitig erfasst, genau einmal angelegt“ (8 statt 1 'added')
 *   B  in setErfassen() vor dem Anlegen `await setAngaben(sn)` eingefügt → rot:
 *      „die Anfrage fragt kein Netz …“ (Netzaufrufe 1 statt 0)
 *   C  in setErfassen() placeJobOne() weggelassen → rot: „… und stellt den Auftrag ein“
 *   D  in setSupplement() die Schleife über die Erfassungen ohne Preis entfernt →
 *      rot: „der Auftrag ergänzt Katalog und Kaufpreis“ (Preis null)
 *   E  (10.11.) in rememberCatalogPlaceholder() (src/katalog/repository/setStamm.ts) das
 *      INSERT INTO rb_sets entfernt → rot:
 *      alle drei Teile (set_catalog_rb_sets_fkey; die Route antwortet 409 statt 200)
 *   F  (10.11.) in rememberSetCatalog() `WHERE rb_sets.herkunft = 'api'` zu 'csv' →
 *      rot: „der Auftrag ergänzt …“ (Name „Set …“ statt „Testset“)
 *
 * Rebrickable, BrickLink, Brickset und der Bildabruf sind an der Verdrahtung gestellt
 * (testSources, testImageWorker) und zählen jeden Netzaufruf. Der Code fragt im Konto
 * (asAccount, Route über testServer) als Laufzeitrolle; Testdaten über die Eigentümerin.
 *   B' (13.11.) B über die gestellten Quellen wiederholt → rot: „die Anfrage fragt
 *      kein Netz …“ (Name „Testset“ schon in der Anfrage) und „der Auftrag …“
 *   G  (13.11.) in setAngaben() (rebrickableKatalog.ts) wieder das importierte holeSet
 *      statt quellen(k) → rot: „der Auftrag ergänzt …“ (kein Netzaufruf gezählt)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testSources, testImageWorker, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('Set erfassen ohne Netz und ohne Wettlauf', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  // Jede Quelle im Netz gestellt und gezählt.
  const netz = [];
  testSources(t, {
    holeSet: async sn => {
      netz.push(`rebrickable ${sn}`);
      return { set_num: sn, name: 'Testset', year: 2020, theme_id: 990001, num_parts: 10, set_img_url: null };
    },
    getThemeName: async () => 'Test',
    setAngaben: async () => null,
    bricklinkRequest: async (_m, pfad) => {
      netz.push(`preis ${pfad.split('/')[3]}`);
      return { avg_price: '42', qty_avg_price: '42', currency_code: 'EUR' };
    },
  });
  testImageWorker(t, {
    setBildLaden: async (_u, sn) => {
      netz.push(`bild ${sn}`);
      return null;
    },
  });
  const sets = require('./helpers/sources').areaPage('sets');
  const P = process.pid % 100000;
  const MAIN = `erf-haupt-${P}`,
    KIND = `erf-kind-${P}`;
  const SN = `${70000 + (P % 9000)}-1`,
    SN2 = `${80000 + (P % 9000)}-1`;
  const weg = async () => {
    for (const sn of [SN, SN2]) {
      await db.run('DELETE FROM set_acquisitions WHERE set_number = $1', [sn]);
      await db.run('DELETE FROM sets WHERE set_number = $1', [sn]);
      await db.run('DELETE FROM rb_sets WHERE set_num = $1', [sn]);
      await db.run("DELETE FROM jobs WHERE type = 'nacharbeit' AND payload->>'set_number' = $1", [sn]);
    }
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, KIND]]);
  };
  await weg();
  // Ohne BrickLink-Zugang fragte der Preislauf gar nicht; der Abruf selbst ist gestellt.
  await _req('src/settings/settings.js').setGlobalSetting('bricklink_consumer_key', 'test');
  await db.run("INSERT INTO rb_themes (id, name) VALUES (990001, 'Test') ON CONFLICT (id) DO NOTHING");
  const neu = async n =>
    (await db.get("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [n])).id;
  const haupt = await neu(MAIN),
    kind = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, kind]);
  t.after(async () => {
    await weg().catch(() => {});
    await db.run("DELETE FROM global_settings WHERE key = 'bricklink_consumer_key'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('gleichzeitig erfasst, genau einmal angelegt', async () => {
    // Das Hauptkonto sieht beide Konten; es legt teils für sich, teils für das Kind an.
    const fuer = [haupt, kind, haupt, kind, haupt, kind, haupt, kind];
    const r = await Promise.all(
      fuer.map(b =>
        asAccount(haupt, () => sets.setErfassen({ requester: haupt, ownerWish: b, setNumber: SN, kaufpreis: null })),
      ),
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
    const { base } = testServer(_req, { sitzung: { userId: haupt }, t });
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
    // rb_sets kennt das Set nicht: Die Erfassung legt es als 'api' an, samt set_catalog-Zeile.
    assert.deepEqual(
      await db.get(
        `SELECT r.name, r.source, (c.set_number IS NOT NULL) AS katalog
                      FROM rb_sets r LEFT JOIN set_catalog c ON c.set_number = r.set_num WHERE r.set_num = $1`,
        [SN2],
      ),
      { name: `Set ${SN2}`, source: 'api', katalog: true },
    );
    const a = await db.get(
      "SELECT payload, dedupe_key FROM jobs WHERE type = 'nacharbeit' AND payload->>'set_number' = $1",
      [SN2],
    );
    assert.ok(a, 'kein Auftrag eingestellt');
    assert.equal(a.payload.art, 'ergaenzen');
    assert.equal(a.dedupe_key, `nacharbeit:${haupt}:${SN2}`);
  });

  await t.test('der Auftrag ergänzt Katalog und Kaufpreis', async () => {
    netz.length = 0;
    await asAccount(haupt, () => sets.setSupplement(SN2, haupt));
    const kat = await db.get(
      `SELECT r.name, r.year, t.name AS thema, r.source FROM rb_sets r
                                LEFT JOIN rb_themes t ON t.id = r.theme_id WHERE r.set_num = $1`,
      [SN2],
    );
    assert.deepEqual(kat, { name: 'Testset', year: 2020, thema: 'Test', source: 'api' });
    // Die Sammlung liest Name, Jahr und Thema über rb_sets.
    const liste = await _req('src/sets/repository/sets.js').setList(db, [haupt], { seite: null, themen: false });
    const z = liste.sets.find(x => x.set_number === SN2);
    assert.deepEqual({ name: z.name, year: z.year, theme: z.theme }, { name: 'Testset', year: 2020, theme: 'Test' });
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
    await asAccount(haupt, () => sets.setSupplement(SN2, haupt));
    assert.equal(netz.filter(x => x.startsWith('preis')).length, 0, 'der Preis wurde doppelt geholt');
  });
});
