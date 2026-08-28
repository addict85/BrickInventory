/**
 * ALLE Erfassungs-Wege im Haushalt — Sets, Teile, Minifiguren, je Ändern und
 * Löschen.
 *
 * ── Woher dieser Test kommt (Marcos Bericht, Nachtrag 55) ───────────────────
 * „Wenn ich in den Kaufpreisen einen Kaufpreis löschen will (für ein
 * Unterkonto), erscheint 404 Nicht gefunden — die Zeile wird nicht gelöscht."
 *
 * Beim Nachsehen war der gemeldete Fall nur einer von SECHS. Nachtrag 45 hatte
 * dieselbe Lücke geschlossen, aber nur an zwei Stellen: der v1-Fabrik und der
 * Webapp-Route zum ÄNDERN einer Set-Erfassung. Offen blieben:
 *   • Set-Erfassung löschen (Marcos Fall)
 *   • Teil-Erfassung ändern und löschen
 *   • Minifiguren-Erfassung ändern und löschen
 *
 * Alle suchten mit `WHERE id=$1 AND user_id=$2` und der eigenen Betrachter-ID.
 * Zwei der Löschwege waren dabei besonders unangenehm: Sie prüften gar nicht,
 * ob eine Zeile getroffen wurde — das DELETE lief ins Leere und die Antwort
 * meldete trotzdem Erfolg. Der Nutzer sah „gelöscht", die Zeile blieb stehen.
 *
 * Deshalb prüft dieser Test bewusst ALLE sechs Wege statt nur den gemeldeten:
 * Die Lehre aus Nachtrag 53 lautete, nach zwei Funden derselben Klasse sofort
 * die ganze Familie durchzugehen. Genau das ist hier der Fall.
 *
 * Gegenprobe (durchgeführt): writableIds in routes/sets.ts durch die eigene ID
 * ersetzt → „Set-Erfassung löschen" endet wieder in 404.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
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

test('Erfassungen des Unterkontos: ändern und löschen auf allen drei Elementarten',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `acq6-h-${process.pid}`, SUB = `acq6-s-${process.pid}`;
  const SN = `77001-${process.pid}`, PN = `3001x${process.pid}`, FN = `sw${process.pid}`;

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: hauptId };
    req.apiUser = { user_id: hauptId, is_admin: 0 };
    next();
  });
  app.use('/api/sets', _req('routes/sets.js'));
  app.use('/api/parts', _req('routes/parts.js'));
  app.use('/api/minifigs', _req('routes/minifigs.js'));
  // Die Erfassungs-Routen liegen seit Nachtrag 70 nur noch hier — eine
  // Adresse für Webapp UND App.
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Alles gehört dem UNTERKONTO — wie im gemeldeten Fall.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM part_acquisitions WHERE part_number=$1`, [PN]);
    await db.run(`DELETE FROM parts WHERE part_number=$1`, [PN]);
    await db.run(`DELETE FROM minifig_acquisitions WHERE fig_number=$1`, [FN]);
    await db.run(`DELETE FROM minifigs WHERE fig_number=$1`, [FN]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                  VALUES ($1,$2,'T',1,'N',10)`, [subId, SN]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`, [subId, SN]);
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,quantity,source)
                  VALUES ($1,$2,4,1,'manual')`, [subId, PN]);
    await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,unit_price,condition,quantity)
                  VALUES ($1,$2,4,5,'N',1)`, [subId, PN]);
    await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source)
                  VALUES ($1,$2,'F',1,'manual')`, [subId, FN]);
    await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,unit_price,condition,quantity)
                  VALUES ($1,$2,7,'N',1)`, [subId, FN]);
  };
  const acqId = async (tabelle, spalte, wert) =>
    (await db.get(`SELECT id FROM ${tabelle} WHERE user_id=$1 AND ${spalte}=$2`, [subId, wert])).id;

  const faelle = [
    ['Set-Erfassung ändern',      'PUT',    async () => `/api/v1/sets/${SN}/acquisitions/${await acqId('set_acquisitions','set_number',SN)}`,        { purchase_price: 20 }],
    ['Set-Erfassung löschen',     'DELETE', async () => `/api/v1/sets/${SN}/acquisitions/${await acqId('set_acquisitions','set_number',SN)}`,        null],
    ['Teil-Erfassung ändern',     'PUT',    async () => `/api/v1/parts/${PN}/4/acquisitions/${await acqId('part_acquisitions','part_number',PN)}`,   { unit_price: 9 }],
    ['Teil-Erfassung löschen',    'DELETE', async () => `/api/v1/parts/${PN}/4/acquisitions/${await acqId('part_acquisitions','part_number',PN)}`,   null],
    ['Figur-Erfassung ändern',    'PUT',    async () => `/api/v1/minifigs/${FN}/acquisitions/${await acqId('minifig_acquisitions','fig_number',FN)}`, { unit_price: 9 }],
    ['Figur-Erfassung löschen',   'DELETE', async () => `/api/v1/minifigs/${FN}/acquisitions/${await acqId('minifig_acquisitions','fig_number',FN)}`, null],
  ];

  try {
    for (const [name, methode, pfadFn, body] of faelle) {
      await aufbauen();
      const pfad = await pfadFn();
      const r = await fetch(`${base}${pfad}`, {
        method: methode,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(r.status, 200,
        `${name}: darf nicht in 404 enden — die Zeile gehört dem Unterkonto, ` +
        'das Hauptkonto darf sie verwalten');
    }

    // Löschen muss WIRKLICH löschen. Zwei der Wege prüften früher gar nicht,
    // ob eine Zeile getroffen wurde: Das DELETE lief ins Leere, die Antwort
    // meldete trotzdem Erfolg — der Nutzer sah „gelöscht", die Zeile blieb.
    await aufbauen();
    const figId = await acqId('minifig_acquisitions', 'fig_number', FN);
    await fetch(`${base}/api/v1/minifigs/${FN}/acquisitions/${figId}`, { method: 'DELETE' });
    const rest = await db.get(
      `SELECT COUNT(*)::int AS c FROM minifig_acquisitions WHERE id=$1`, [figId]);
    assert.equal(rest.c, 0, 'die Erfassung muss nach dem Löschen wirklich weg sein');
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    for (const [tab, sp, wert] of [
      ['set_acquisitions', 'set_number', SN], ['sets', 'set_number', SN],
      ['part_acquisitions', 'part_number', PN], ['parts', 'part_number', PN],
      ['minifig_acquisitions', 'fig_number', FN], ['minifigs', 'fig_number', FN],
    ]) await db.run(`DELETE FROM ${tab} WHERE ${sp}=$1`, [wert]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
