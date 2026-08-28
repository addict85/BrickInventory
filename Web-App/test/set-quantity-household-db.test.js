/**
 * Die Anzahl zeigt den HAUSHALT — geändert wird das EIGENE Konto.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Die Anzahl soll immer von allen angezeigt werden. Wenn ich diese erhöhe,
 * soll es für meinen Account einen neuen Kaufpreis-Eintrag erstellen. Analog
 * der bestehenden Logik. Jeweils die Logik im Server implementieren."
 *
 * ── Was vorher war ──────────────────────────────────────────────────────────
 * Zwei Stellen, die sich widersprachen:
 *
 *   • Das DETAIL las `SELECT * FROM sets WHERE user_id = ANY(blickfeld)` und
 *     nahm irgendeine Zeile — welche, entschied die Reihenfolge in der
 *     Tabelle. Marco sah „Anzahl 0" für ein Set, von dem das Unterkonto ein
 *     Exemplar hält. Die LISTE summierte längst; nur das Detail nicht.
 *   • Die ÄNDERUNG schrieb auf den Besitzer eben dieser Zeile. Ein „+" auf
 *     einem Set des Unterkontos erhöhte dessen Bestand, und die neue Erfassung
 *     entstand in einem fremden Konto.
 *
 * ── Die Regel ───────────────────────────────────────────────────────────────
 * Angezeigt wird die Summe über das Blickfeld. Gesendet wird eine
 * Gesamtmenge; geschrieben wird die DIFFERENZ, und zwar auf das eigene Konto.
 * Nach unten bei den eigenen Exemplaren gedeckelt — fremde lassen sich nicht
 * wegnehmen. Die Antwort trägt die tatsächliche Gesamtmenge zurück.
 *
 * „Analog der bestehenden Logik" heisst wörtlich dieselbe Funktion:
 * adjustAcquisitionsToQuantity() legt die Erfassung an, holt den Marktpreis
 * und beachtet die Tagesregel — unverändert, nur mit anderem Ziel.
 *
 * Gegenprobe (durchgeführt): Ziel wieder auf `ownerId` gestellt → der
 * Erhöhungs-Teilschritt wird rot (die Exemplare landen beim Unterkonto).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('Menge: Anzeige = Haushalt, Änderung = eigenes Konto', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `mh-${process.pid}`, SUB = `ms-${process.pid}`;
  const SN = `78${process.pid % 900 + 100}-1`;

  const aufraeumen = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);
  await aufraeumen();
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                VALUES ($1,'U','EUR',3.94,3.94,3)`, [SN]);
  // NUR das Unterkonto hält ein Exemplar — Marcos Ausgangslage.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                VALUES ($1,$2,'T',1,'U',3.94)`, [subId, SN]);
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,3.94,'U',1)`, [subId, SN]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: hauptId };
    req.apiUser = { user_id: hauptId, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  const detail = async () => (await (await fetch(`${base}/api/v1/sets/${SN}`)).json()).set;
  const setzen = async (n) => {
    const r = await fetch(`${base}/api/v1/sets/${SN}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: n }),
    });
    return { status: r.status, body: await r.json() };
  };
  const menge = async (uid) => (await db.get(
    `SELECT COALESCE(SUM(quantity),0)::int q FROM sets WHERE user_id=$1 AND set_number=$2`, [uid, SN])).q;

  try {
    await t.test('das Detail zeigt die Menge aller Konten', async () => {
      const d = await detail();
      assert.equal(d.quantity, 1,
        'Das Detail zeigt die Zeile eines einzelnen Kontos statt der Summe — genau ' +
        'so entstand Marcos „Anzahl 0"');
    });

    await t.test('erhöhen legt im EIGENEN Konto an, mit Marktpreis', async () => {
      const r = await setzen(2);
      assert.equal(r.status, 200);
      assert.equal(await menge(hauptId), 1, 'die Differenz gehört dem eigenen Konto');
      assert.equal(await menge(subId), 1, 'der fremde Bestand bleibt unberührt');
      const acq = await db.get(
        `SELECT quantity, purchase_price, condition FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2`, [hauptId, SN]);
      assert.ok(acq, 'im eigenen Konto ist keine Erfassung entstanden');
      assert.equal(acq.quantity, 1);
      assert.equal(Number(acq.purchase_price), 3.94,
        'die Erfassung braucht den MARKTPREIS — „analog der bestehenden Logik"');
      assert.equal(acq.condition, 'U',
        'der Zustand kommt aus derselben Ermittlung wie beim Erfassen');
      assert.equal((await detail()).quantity, 2);
      assert.equal(r.body.quantity, 2, 'die Antwort trägt die neue Gesamtmenge');
    });

    await t.test('nochmal erhöhen fasst am selben Tag zusammen', async () => {
      // Die Tagesregel gilt unverändert: eine Erfassung je Konto, Set und Tag.
      await setzen(4);
      const zeilen = await db.all(
        `SELECT quantity FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [hauptId, SN]);
      assert.equal(zeilen.length, 1, `${zeilen.length} Erfassungen — die Tagesregel greift nicht`);
      assert.equal(zeilen[0].quantity, 3);
      assert.equal(await menge(hauptId), 3);
    });

    await t.test('verringern nimmt zuerst die eigenen Exemplare', async () => {
      await setzen(1);
      assert.equal(await menge(hauptId), 0, 'die eigenen Exemplare gehen zuerst');
      assert.equal(await menge(subId), 1, 'das fremde bleibt');
      // Nachtrag 84: Bleibt nichts übrig, verschwindet die eigene Zeile ganz.
      const eigene = await db.get(
        `SELECT COUNT(*)::int c FROM sets WHERE user_id=$1 AND set_number=$2`, [hauptId, SN]);
      assert.equal(eigene.c, 0, 'eine eigene Zeile mit Menge 0 bleibt zurück');
    });

    await t.test('unter den eigenen Bestand geht es nicht', async () => {
      // Die Exemplare eines anderen Kontos sind nicht meine. Statt sie
      // wegzunehmen, deckelt der Server — und sagt in der Antwort, was
      // tatsächlich gilt.
      const r = await setzen(0);
      assert.equal(await menge(subId), 1, 'das fremde Exemplar wurde weggenommen');
      assert.equal(r.body.quantity, 1, 'die Antwort muss die WIRKLICHE Menge nennen, nicht die gesendete');
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [hauptId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
