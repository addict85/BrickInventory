/**
 * Nach dem Verschieben eines Sets hat JEDER Bestandteil im Zielkonto sein Bild.
 *
 * ── Der Befund, der zu diesem Test führte ───────────────────────────────────
 * copyContents() in utils/setMove.ts kopiert Teile, Minifiguren und
 * Anleitungen ins Zielkonto. Die Teile wurden mit 14 Spalten kopiert, die
 * Minifiguren mit 7 — und die einzige, die dabei WIRKLICH fehlte, war
 * `image_local`.
 *
 * Wer ein Set ins Konto seines Kindes verschob, sah dort danach die Teilebilder
 * aus dem Zwischenspeicher und die Figurenbilder wieder über den Proxy vom CDN
 * — bis zum nächsten Serverstart, denn nur dann läuft der Bild-Job.
 *
 * ── Warum der Test jetzt etwas STÄRKERES prüft ──────────────────────────────
 * Mit Migration 0034 steht das Bild nicht mehr an der Bestandszeile, sondern
 * im Katalog: part_color_catalog je (Teil, Farbe), minifigs_catalog je Figur.
 * Beim Verschieben ist damit nichts mitzunehmen — und folglich auch nichts zu
 * vergessen. Die FEHLERQUELLE ist weg, nicht nur der Fehler.
 *
 * Geprüft wird deshalb die Wirkung und nicht der Weg: Nach dem Verschieben
 * liefert die Teile- bzw. Figurenliste des ZIELKONTOS für beide Bestandteile
 * denselben Bildpfad wie vorher. Das ist die Frage, die den Nutzer angeht, und
 * sie bleibt dieselbe, ob der Pfad nun kopiert oder nachgeschlagen wird.
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
    await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,$2,1)`,
      [vonId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,10,'N')`, [vonId, SN]);
    // Beide Bestandteile kommen AUS DEM SET (source='set') und haben ein
    // zwischengespeichertes Bild — genau der Fall, den der Bild-Job herstellt.
    // Das Bild steht seit Migration 0034 im Katalog, der Bestand in
    // parts/minifigs.
    await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_local)
                  VALUES ($1,4,$2)
                  ON CONFLICT (part_number,color_id) DO UPDATE SET image_local=EXCLUDED.image_local`,
                 [PN, PFAD_TEIL]);
    await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_local)
                  VALUES ($1,'Testfigur',$2)
                  ON CONFLICT (fig_number) DO UPDATE SET image_local=EXCLUDED.image_local`,
                 [FN, PFAD_FIGUR]);
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                  VALUES ($1,$2,$3,4,2,'set')`, [vonId, SN, PN]);
    await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
                  VALUES ($1,$2,$3,1,'set')`, [vonId, SN, FN]);

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

    // Gelesen wird über denselben JOIN, den die Oberflächen benutzen — also
    // über die Wirkung. Eine Abfrage auf parts.image_local gibt es nicht mehr,
    // und sie wäre auch die falsche Frage: Der Nutzer will das Bild sehen, und
    // ob es kopiert oder nachgeschlagen wird, ist ihm gleich.
    const teil  = await db.get(
      `SELECT pcc.image_local
         FROM parts p
         LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                         AND pcc.color_id    = p.color_id
        WHERE p.user_id=$1 AND p.part_number=$2`, [nachId, PN]);
    const figur = await db.get(
      `SELECT mc.image_local
         FROM minifigs m
         LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
        WHERE m.user_id=$1 AND m.fig_number=$2`, [nachId, FN]);

    assert.ok(teil,  'Das Teil ist im Zielkonto gar nicht angekommen');
    assert.ok(figur, 'Die Minifigur ist im Zielkonto gar nicht angekommen');

    assert.equal(figur.image_local, PFAD_FIGUR,
      `Die verschobene Minifigur hat image_local=${figur.image_local} statt "${PFAD_FIGUR}". ` +
      'Das Figurenbild ist im Zielkonto nicht sichtbar, und bis zum nächsten ' +
      'Serverstart kommt es wieder über den Proxy vom CDN.');
    assert.equal(teil.image_local, PFAD_TEIL,
      `Das verschobene Teil hat image_local=${teil.image_local} statt "${PFAD_TEIL}".`);

    // Die eigentliche Regel: Beide Zweige liefern dasselbe Ergebnis.
    assert.deepEqual(
      { teil: teil.image_local !== null, figur: figur.image_local !== null },
      { teil: true, figur: true },
      'Teile und Minifiguren kommen beim Verschieben verschieden heraus — ' +
      'copyContents() kopiert zwei Tabellen mit derselben Absicht, und bei ' +
      'einer davon fehlt hinterher das Bild.');
  } finally {
    for (const uid of [vonId, nachId]) {
      await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM minifigs WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    }
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [VON, NACH]).catch(() => {});
    // Die Katalogzeilen hängen an keinem Konto und bleiben sonst stehen.
    await db.run(`DELETE FROM part_color_catalog WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM minifigs_catalog WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
