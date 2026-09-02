/**
 * Beim Verschieben eines Sets nimmt JEDER Bestandteil seinen Bildpfad mit.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * copyContents() in utils/setMove.ts kopiert Teile, Minifiguren und
 * Anleitungen ins Zielkonto. Die Teile wurden mit 14 Spalten kopiert, die
 * Minifiguren mit 7 — und die einzige, die dabei WIRKLICH fehlte, war
 * `image_local`.
 *
 * Die übrigen fehlenden (unit_price, purchase_price, note, condition,
 * bl_fig_number) sind ausschliesslich bei MANUELL erfassten Figuren gefüllt;
 * kopiert werden hier nur Set-Figuren, dort steht überall NULL. image_local
 * nicht: Der Bild-Job setzt es „über Nutzer und Quellen hinweg"
 * (server.ts: UPDATE minifigs SET image_local=… WHERE fig_number=…), also
 * haben Set-Figuren es sehr wohl.
 *
 * Wer ein Set ins Konto seines Kindes verschob, sah dort danach die Teilebilder
 * aus dem Zwischenspeicher und die Figurenbilder wieder über den Proxy vom CDN
 * — bis zum nächsten Serverstart, denn nur dann läuft der Bild-Job.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * Nicht „steht image_local im INSERT", sondern: Nach dem Verschieben steht bei
 * BEIDEN Bestandteilen derselbe Pfad wie vorher. Die Frage ist der Vergleich
 * der zwei Zweige, und den beantwortet nur die Tabelle.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { moveSetBetweenAccounts } = _req('utils/setMove.js');

test('ein verschobenes Set nimmt die Bildpfade aller Bestandteile mit', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const p = String(process.pid).slice(-5);
  const VON = `mv_von_${p}`, NACH = `mv_nach_${p}`;
  const SN = `81${p}-1`, PN = `pt${p}`, FN = `fig${p}`;
  const PFAD_TEIL = `/img/parts/${PN}.png`;
  const PFAD_FIGUR = `/img/minifigs/${FN}.png`;

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [VON, NACH]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [VON, NACH]);
  const vonId  = (await db.get(`SELECT id FROM users WHERE username=$1`, [VON])).id;
  const nachId = (await db.get(`SELECT id FROM users WHERE username=$1`, [NACH])).id;

  try {
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,$2,'Testset',1)`,
      [vonId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,10,'N')`, [vonId, SN]);
    // Beide Bestandteile kommen AUS DEM SET (source='set') und haben ein
    // zwischengespeichertes Bild — genau der Fall, den der Bild-Job herstellt.
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,image_local)
                  VALUES ($1,$2,$3,4,2,'set',$4)`, [vonId, SN, PN, PFAD_TEIL]);
    await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,fig_name,quantity,source,image_local)
                  VALUES ($1,$2,$3,'Testfigur',1,'set',$4)`, [vonId, SN, FN, PFAD_FIGUR]);

    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const tx = {
        get: async (sql, params) => (await c.query(sql, params)).rows[0],
        all: async (sql, params) => (await c.query(sql, params)).rows,
        run: async (sql, params) => { const r = await c.query(sql, params); return { changes: r.rowCount }; },
      };
      await moveSetBetweenAccounts(tx, SN, vonId, nachId);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }

    const teil  = await db.get(
      `SELECT image_local FROM parts WHERE user_id=$1 AND part_number=$2`, [nachId, PN]);
    const figur = await db.get(
      `SELECT image_local FROM minifigs WHERE user_id=$1 AND fig_number=$2`, [nachId, FN]);

    assert.ok(teil,  'Das Teil ist im Zielkonto gar nicht angekommen');
    assert.ok(figur, 'Die Minifigur ist im Zielkonto gar nicht angekommen');

    assert.equal(figur.image_local, PFAD_FIGUR,
      `Die verschobene Minifigur hat image_local=${figur.image_local} statt "${PFAD_FIGUR}". ` +
      'Der Zwischenspeicher-Pfad geht beim Verschieben verloren, und bis zum ' +
      'nächsten Serverstart kommt jedes Figurenbild wieder über den Proxy vom CDN.');

    // Die eigentliche Regel: Beide Zweige behandeln den Bildpfad gleich.
    assert.deepEqual(
      { teil: teil.image_local !== null, figur: figur.image_local !== null },
      { teil: true, figur: true },
      'Teile und Minifiguren werden beim Verschieben verschieden behandelt — ' +
      'copyContents() kopiert zwei Tabellen mit derselben Absicht, und eine ' +
      'davon lässt eine gefüllte Spalte fallen.');
  } finally {
    for (const uid of [vonId, nachId]) {
      await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM minifigs WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    }
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [VON, NACH]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
