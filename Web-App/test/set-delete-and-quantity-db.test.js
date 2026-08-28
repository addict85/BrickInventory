/**
 * Set löschen: EINE Rückfrage, und alles Zugehörige geht mit.
 * Setanzahl ändern: Teile und Minifiguren ziehen mit.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn ich in der Android-App ein Set lösche, erscheint eine Rückfrage und das
 * Set wird gelöscht. Wenn ich in der Webapp ein Set lösche, erscheinen 2
 * Rückfragen. In beiden Fällen soll nur eine Rückfrage erscheinen und das Set
 * direkt gelöscht werden inkl. Teile und Minifiguren die zu diesem Set
 * gehören. Kannst du bitte auch prüfen, dass die Anzahl korrekt angepasst wird
 * bei den Minifiguren und den Teilen, wenn die Setanzahl erhöht oder reduziert
 * wird?"
 *
 * ── Teil 1: die Rückfrage ───────────────────────────────────────────────────
 * Der Löschknopf im Detail-Dialog der Webapp fragte selbst nach und rief danach
 * delSet(), das ein zweites Mal fragte. Von der Kachel und aus der Listenzeile
 * kam nur eine — dieselbe Handlung, drei Einstiege, zwei Erlebnisse.
 *
 * ── Teil 2: die Mengen ──────────────────────────────────────────────────────
 * Hier war NICHTS zu reparieren, und genau deshalb steht der Test hier: Die
 * Teile eines Sets liegen mit ihrer Menge JE EXEMPLAR in der Tabelle, und die
 * Abfragen multiplizieren mit sets.quantity. Nachgemessen mit einem Set aus 10
 * Teilen und 1 Minifigur:
 *
 *     Menge 1 → Teile 10, Minifiguren 1
 *     Menge 3 → Teile 30, Minifiguren 3
 *     zurück  → Teile 10, Minifiguren 1
 *
 * Der Test hält das fest, weil die Multiplikation an mehreren Stellen steht
 * (Kennzahlen, Teileliste, Minifigurenliste, Minifiguren-Kennzahlen) und in
 * dieser Reihe schon mehrfach eine davon vergessen wurde. Dazu die
 * Zusammenfassungstabelle (utils/partsSummary.ts), die vorberechnete Mengen
 * hält: Ihre Zähler-Trigger hängen an `parts` UND `sets` — fiele `sets` weg,
 * bliebe die Teilezahl nach einer Mengenänderung stehen, ohne dass irgendetwas
 * falsch aussähe.
 *
 * Gegenproben (durchgeführt): Rückfrage im btn-md-Handler wieder eingebaut →
 * Teilschritt 1 rot. `sets` aus der Trigger-Liste entfernt → Teilschritt 4 rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { ohneKommentare } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('das Löschen fragt genau einmal', () => {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/02-gallery.js'), 'utf8'));

  // Der Knopf im Detail-Dialog darf NICHT selbst fragen.
  const btn = src.slice(src.indexOf("G('btn-md').onclick"));
  const zeile = btn.slice(0, btn.indexOf('\n'));
  assert.doesNotMatch(zeile, /confirmDelete/,
    'Der Löschknopf im Dialog fragt wieder selbst — zusammen mit der Rückfrage ' +
    'in delSet() sind das zwei');
  assert.match(zeile, /await delSet\(/, 'Er muss über delSet() gehen');

  // …und delSet fragt genau einmal.
  const fn = src.slice(src.indexOf('export async function delSet'),
                       src.indexOf('export async function reimportParts'));
  assert.equal((fn.match(/confirmDelete\(/g) || []).length, 1,
    'delSet() muss GENAU EINE Rückfrage stellen');
  // Und die Rückfrage muss abbrechen können, ohne dass gelöscht wird.
  assert.match(fn, /\) return false;/,
    'Ein „Abbrechen" muss vor dem DELETE herausspringen');
  assert.match(fn, /loadStats\(\)/,
    'Nach dem Löschen müssen die Kennzahlen nachziehen — die Teile und ' +
    'Minifiguren des Sets sind mit weg');
});

test('die Mengen-Multiplikation steht an allen Stellen', () => {
  const h = ohneKommentare(require('./helpers/sources').handlerQuelle());
  // Teile und Minifiguren eines Sets zählen JE EXEMPLAR mal Setanzahl.
  const stellen = (h.match(/COALESCE\(s\.quantity, ?1\)/g) || []).length;
  assert.ok(stellen >= 3,
    `nur ${stellen} Stellen multiplizieren mit der Setanzahl — erwartet werden ` +
    'mindestens Teileliste, Kennzahlen und Minifigurenliste');

  // Die Zusammenfassung hält vorberechnete Mengen. Ihre Zähler müssen auch bei
  // einer Änderung an `sets` hochgehen, sonst bleibt die Teilezahl stehen.
  const ps = ohneKommentare(fs.readFileSync(path.join(ROOT, 'utils/partsSummary.ts'), 'utf8'));
  assert.match(ps, /for \(const tbl of \['parts', 'sets'\]\)/,
    'Die Versionszähler hängen nicht mehr an `sets` — nach einer Mengenänderung ' +
    'bliebe die vorberechnete Teilezahl stehen');
});

test('Löschen und Mengenänderung gegen die Datenbank', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `dl-${process.pid}`;
  const SN = `76${process.pid % 900 + 100}-1`;

  const aufraeumen = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'parts', 'minifigs', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await aufraeumen();
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                VALUES ($1,'N','EUR',20,20,3)`, [SN]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price,pieces,minifigs)
                VALUES ($1,$2,'T',1,'N',15,100,2)`, [uid, SN]);
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,15,'N',1)`, [uid, SN]);
  // Ein Exemplar enthält 10 Teile und 1 Minifigur.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source,set_number)
                VALUES ($1,'3001',4,'Stein',10,'set',$2)`, [uid, SN]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source,set_number)
                VALUES ($1,'cty0001','Polizist',1,'set',$2)`, [uid, SN]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid };
    req.apiUser = { user_id: uid, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  const H = require('./helpers/sources').handlerModul(_req);
  const setzen = (n) => fetch(`${base}/api/v1/sets/${SN}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quantity: n }),
  });

  try {
    await t.test('mehr Sets = mehr Teile und Minifiguren', async () => {
      let st = await H.getStats([uid]);
      assert.equal(st.total_parts, 10, 'Vorbedingung');
      assert.equal(st.total_minifigs, 1, 'Vorbedingung');

      await setzen(3);
      st = await H.getStats([uid]);
      assert.equal(st.total_parts, 30, `Teile ${st.total_parts} statt 30`);
      assert.equal(st.total_minifigs, 3, `Minifiguren ${st.total_minifigs} statt 3`);

      // Auch die LISTEN, nicht nur die Kennzahlen — sie fragen anders ab.
      const p = await H.getParts([uid], {});
      const teil = (p.parts || []).find(x => x.part_number === '3001');
      assert.equal(Number(teil?.quantity ?? teil?.total_quantity), 30,
        'die Teileliste multipliziert nicht mit');
      const m = await H.getMinifigs([uid], {});
      assert.equal(Number(m.figs[0]?.total_quantity ?? m.figs[0]?.quantity), 3,
        'die Minifigurenliste multipliziert nicht mit');
      assert.equal((await H.getMinifigStats([uid])).total_quantity, 3,
        'die Minifiguren-Kennzahl multipliziert nicht mit');
    });

    await t.test('weniger Sets = weniger Teile und Minifiguren', async () => {
      // Die Gegenrichtung: Ohne sie wäre der Test auch grün, wenn die Zahl nur
      // jemals wüchse.
      await setzen(1);
      const st = await H.getStats([uid]);
      assert.equal(st.total_parts, 10, `Teile ${st.total_parts} statt 10`);
      assert.equal(st.total_minifigs, 1, `Minifiguren ${st.total_minifigs} statt 1`);
      // Die Teile-Zeile selbst bleibt bei 10 je Exemplar — multipliziert wird
      // beim Lesen, nicht beim Schreiben. Stünde hier 30, hätte jemand die
      // Menge in die Tabelle geschrieben, und das nächste Ändern rechnete auf
      // einem schon multiplizierten Wert weiter.
      const roh = await db.get(
        `SELECT quantity FROM parts WHERE user_id=$1 AND set_number=$2`, [uid, SN]);
      assert.equal(roh.quantity, 10,
        'die gespeicherte Teilemenge muss die JE EXEMPLAR sein');
    });

    await t.test('Löschen nimmt Teile, Minifiguren und Kaufpreise mit', async () => {
      const r = await fetch(`${base}/api/v1/sets/${SN}`, { method: 'DELETE' });
      assert.equal(r.status, 200);
      for (const tab of ['sets', 'parts', 'minifigs', 'set_acquisitions']) {
        const n = (await db.get(`SELECT COUNT(*)::int c FROM ${tab} WHERE set_number=$1`, [SN])).c;
        assert.equal(n, 0, `${tab}: ${n} Zeile(n) übrig`);
      }
      const st = await H.getStats([uid]);
      assert.equal(st.total_sets, 0);
      assert.equal(st.total_parts, 0, 'die Teile des Sets zählen weiter mit');
      assert.equal(st.total_minifigs, 0, 'die Minifiguren des Sets zählen weiter mit');
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
