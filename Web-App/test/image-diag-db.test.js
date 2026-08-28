/**
 * Bild-Diagnose: „Warum fehlt das Bild für Set X?" in EINER Antwort.
 *
 * ── Woher das kommt (Nachtrag 50) ───────────────────────────────────────────
 * Dieser Endpunkt ist die Lehre aus einer Fehlersuche, die fünf Anläufe
 * gebraucht hat (Nachträge 36, 37, 40, 41, 43, 47, 48). Dasselbe Symptom —
 * „die Kachel bleibt leer" — hatte nacheinander verschiedene Ursachen, und
 * jede Runde begann damit, dieselben Fragen einzeln von Hand zu beantworten:
 * Kennt die Datenbank eine Adresse? Liegt die Datei da? Die Vorschau? Ist sie
 * plausibel gross? Was sagt der Proxy-Cache? Die Antworten lagen an drei
 * verschiedenen Orten.
 *
 * Geprüft wird VERHALTEN gegen echte Dateien und echte Datenbank, in den drei
 * Lagen, die im Betrieb tatsächlich vorkommen. Besonders wichtig ist der
 * Klartext-Hinweis: Er ist der eigentliche Nutzen — Zahlen allein hätte man
 * auch vorher zusammensuchen können.
 *
 * Gegenprobe (durchgeführt): den Hinweis-Block für „Vorschau fehlt" entfernt →
 * Teilschritt A wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('die Bild-Diagnose beschreibt jede Lage im Klartext',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('utils/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const USER = `diag-${process.pid}`;
  const MIT  = `9000-${process.pid}`;   // Datei vorhanden
  const OHNE = `9001-${process.pid}`;   // nichts vorhanden
  const original = path.join(ordner, `${MIT}.jpg`);
  const vorschau = path.join(ordner, `${MIT}_thumb.jpg`);

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',1)`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[MIT, OHNE]]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,image_local)
                VALUES ($1,$2,'Mit Bild',1,$3)`, [uid, MIT, `/images/sets/${MIT}.jpg`]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity)
                VALUES ($1,$2,'Ohne alles',1)`, [uid, OHNE]);
  await new Jimp({ width: 500, height: 400, color: 0x0000ffff }).write(original);
  fs.rmSync(vorschau, { force: true });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid, isAdmin: true };
    req.apiUser = { user_id: uid, is_admin: 1 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const frag = async (sn) => {
    const r = await fetch(`${base}/api/v1/admin/image-diag/${sn}`);
    assert.equal(r.status, 200, 'die Diagnose muss antworten');
    return r.json();
  };

  try {
    // A) Genau Marcos Lage: Original da, Vorschau fehlt.
    let d = await frag(MIT);
    assert.equal(d.lokal.original.vorhanden, true, 'das Original muss gefunden werden');
    assert.equal(d.lokal.vorschau.vorhanden, false);
    assert.ok(d.hinweise.some(h => /Vorschau fehlt/.test(h)),
      `die Diagnose muss die fehlende Vorschau benennen, bekam: ${d.hinweise.join(' | ')}`);

    // B) Nichts bekannt — weder Datei noch Adresse.
    d = await frag(OHNE);
    assert.ok(d.hinweise.some(h => /Weder lokale Datei noch CDN-Adresse/.test(h)),
      `die Diagnose muss „nichts anzeigbar" benennen, bekam: ${d.hinweise.join(' | ')}`);

    // C) Nach der Erzeugung ist alles beisammen — und die Grössen stimmen.
    await _req('routes/thumbs.js').generateThumb(`/images/sets/${MIT}.jpg`);
    d = await frag(MIT);
    assert.ok(d.hinweise.some(h => /Alles vorhanden/.test(h)),
      `nach der Erzeugung darf nichts mehr bemängelt werden, bekam: ${d.hinweise.join(' | ')}`);
    assert.ok(d.lokal.vorschau.bytes < d.lokal.original.bytes,
      'die gemeldete Vorschau muss kleiner sein als das Original');

    // Die Diagnose darf NICHTS reparieren — sonst verändert das Werkzeug den
    // Zustand, den es beschreiben soll.
    fs.rmSync(vorschau, { force: true });
    await frag(MIT);
    assert.equal(fs.existsSync(vorschau), false,
      'die Diagnose hat die Vorschau erzeugt — sie soll nur beobachten');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[MIT, OHNE]]).catch(() => {});
    fs.rmSync(original, { force: true });
    fs.rmSync(vorschau, { force: true });
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('der Set-Bild-Download meldet jeden Fehlschlag', () => {
  // Bis Nachtrag 50 gab es genau EINE Logzeile (die Grössengrenze aus 47);
  // Statuscode, Netzwerkfehler, Zwergantwort und der umschliessende catch
  // endeten alle in einem stummen `return null`. Genau diese Stille hat die
  // Bild-Fehlersuche über fünf Nachträge gestreckt.
  const src = fs.readFileSync(path.join(ROOT, 'utils/setImages.ts'), 'utf8');
  const start = src.indexOf('async function downloadSetImage');
  const fn = src.slice(start, src.indexOf('\n}\n', start))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const meldungen = (fn.match(/console\.(error|log)/g) || []).length;
  assert.ok(meldungen >= 4,
    `downloadSetImage meldet nur ${meldungen} Fehlerwege — Statuscode, Netzwerkfehler, ` +
    'zu kleine Antwort und der umschliessende catch müssen alle eine Spur hinterlassen');
});
