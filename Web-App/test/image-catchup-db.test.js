/**
 * Der Bilder-Nachlauf deckt ALLE Bildarten ab — und zieht fehlende Vorschauen
 * nach, nicht nur fehlende Dateien.
 *
 * ── Woher dieser Test kommt (Nachtrag 49) ───────────────────────────────────
 * Beim Aufräumen nach dem .tmp-Fehler (Nachtrag 48) fielen zwei Lücken auf,
 * die zusammen erklären, warum ein einmal verpasstes Vorschaubild NIE mehr
 * entstand:
 *
 * 1. `_fsPathFromLocal()` liess alles ausser `/images/parts/` fallen und gab
 *    null zurück. Der Lauf war damit faktisch auf Teilebilder beschränkt —
 *    Set- und Minifiguren-Bilder wurden schon beim Auflösen des Pfades
 *    verworfen, noch bevor irgendetwas geprüft werden konnte. Er meldete
 *    trotzdem „fertig".
 * 2. Repariert wurden ausschliesslich fehlende DATEIEN. Lag die Datei vor und
 *    fehlte nur die Verkleinerung, tat der Lauf nichts.
 *
 * Beides zusammen hiess: Wer im Monitoring „fehlende Bilder neu laden" drückt,
 * bekam für Set-Bilder gar nichts — obwohl genau die in der Galerie am
 * sichtbarsten sind.
 *
 * Geprüft wird VERHALTEN gegen echte Dateien und echte Datenbank: Bild liegt
 * da, Vorschau fehlt, Lauf anstossen, Vorschau muss existieren.
 *
 * Gegenprobe (durchgeführt): `/images/sets/` aus _fsPathFromLocal entfernt →
 * thumbs bleibt 0 und die Datei entsteht nicht.
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

test('der Nachlauf erzeugt fehlende Vorschauen — auch für Set-Bilder',
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

  const name = `zz-redl-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`);
  const vorschau = path.join(ordner, `${name}_thumb.jpg`);
  await new Jimp({ width: 600, height: 400, color: 0x00ff00ff }).write(original);
  fs.rmSync(vorschau, { force: true });

  const USER = `redltest-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await db.run(`DELETE FROM sets WHERE set_number=$1`, [name]);
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,image_local)
                VALUES ($1,$2,'Test',1,$3)`, [uid, name, `/images/sets/${name}.jpg`]);

  try {
    const { redownloadMissingImages } = _req('jobs/partsCatalogEnrich.js');
    const r = await redownloadMissingImages();

    assert.ok(r && typeof r.thumbs === 'number',
      'der Lauf muss melden, wie viele Vorschauen er erzeugt hat');
    assert.ok(r.thumbs >= 1,
      'die fehlende Vorschau des SET-Bildes wurde nicht erzeugt — vermutlich lässt ' +
      '_fsPathFromLocal() wieder alles ausser /images/parts/ fallen');
    assert.ok(fs.existsSync(vorschau), 'die Vorschau-Datei fehlt');
    assert.ok(fs.statSync(vorschau).size < fs.statSync(original).size,
      'die Vorschau muss kleiner sein als das Original');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [name]).catch(() => {});
    fs.rmSync(original, { force: true });
    fs.rmSync(vorschau, { force: true });
    await db.pool.end().catch(() => {});
  }
});

test('der Pfad-Auflöser kennt alle drei Bildarten', () => {
  const src = fs.readFileSync(path.join(ROOT, 'jobs/partsCatalogEnrich.ts'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const fn = src.slice(src.indexOf('function _fsPathFromLocal'));
  for (const art of ['/images/parts/', '/images/minifigs/', '/images/sets/']) {
    assert.ok(fn.includes(art), `_fsPathFromLocal kennt ${art} nicht — diese Bilder fallen still aus dem Lauf`);
  }
  // Der Schutz gegen Pfadtricks muss bleiben: Der Wert kommt aus der Datenbank.
  assert.ok(/includes\('\.\.'\)/.test(fn), 'die Prüfung auf .. fehlt');
});

test('beide Vorschau-Erzeuger melden Fehlschläge', () => {
  for (const [datei, muster] of [['utils/thumbs.ts', /\[thumb\]/], ['utils/proxyThumbs.ts', /\[img-proxy\] Vorschau fehlgeschlagen/]]) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.ok(muster.test(src),
      `${datei}: ein Fehlschlag der Vorschau-Erzeugung bleibt still. Genau das hat den ` +
      '.tmp-Fehler aus Nachtrag 41 sieben Nachträge lang verdeckt');
  }
});
