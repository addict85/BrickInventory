/**
 * Ordnung unter data/ — Bilder nach Art getrennt, Anleitungen ohne "shared".
 *
 * Gegenprobe (am 25.10. gemessen): in downloadImage() immer PART_IMAGES_DIR
 * → rot: „Figurenbild nicht im Figurenordner".
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Der Helfer statt eines naiven /\*…\*\/: `'/images/*pfad'` in server.ts
// eröffnete für diesen sonst einen Kommentar bis zum nächsten Kommentarende.
const strip = s => require('./helpers/sources').ohneKommentare(s).replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Alle Quelldateien, die Pfade schreiben könnten. */
const SOURCES = ['server.ts', 'routes/api_v1/parts.ts', 'routes/api_v1/sets.ts', 'src/sets/dienst.ts', 'src/katalog/bilder/thumbs.ts',
                 'routes/api_v1/pdf.ts', 'src/katalog/teileAnreicherung.ts', 'src/katalog/katalogAbgleich.ts'];

test('keine Quelle schreibt mehr die alten Pfade', () => {
  for (const f of SOURCES) {
    const src = strip(read(f));
    // In server.ts sind die Alt-Pfade als Weiterleitung noch erlaubt — dort
    // stehen sie in app.get(...) und in cdnFuerFehlendesBild, nicht als
    // Ziel eines Schreibvorgangs.
    const writes = [...src.matchAll(/=\s*[`'"]\/data\/(part_images|instructions\/shared)\//g)];
    assert.deepEqual(writes.map(m => m[0]), [],
      `${f}: schreibt noch einen alten Pfad`);
  }
});

test('Teile- und Figurenbilder landen in getrennten Ordnern', async (t) => {
  // Am Verhalten: downloadImage() mit nachgestelltem https.get (ohne Netz).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const { downloadImage } = _req('src/katalog/teileAnreicherung.js');
  const { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR } = _req('src/infra/appPaths.js');
  const https = require('node:https');
  const { Readable } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const echt = https.get;
  https.get = (_a, _o, cb) => {
    const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
    setImmediate(() => cb(Object.assign(Readable.from([Buffer.from('PNG')]), { statusCode: 200, headers: { 'content-type': 'image/png' } })));
    return req;
  };
  const NUM = `ordnertest${process.pid}`;
  t.after(() => {
    https.get = echt;
    for (const d of [PART_IMAGES_DIR, MINIFIG_IMAGES_DIR]) fs.rmSync(path.join(d, `${NUM}_0.png`), { force: true });
  });
  const cdn = 'https://cdn.rebrickable.com/media/x.png';
  assert.equal(await downloadImage(cdn, NUM, 0, 'minifig'), `/images/minifigs/${NUM}_0.png`, 'Web-Pfad folgt der Art nicht');
  assert.ok(fs.existsSync(path.join(MINIFIG_IMAGES_DIR, `${NUM}_0.png`)), 'Figurenbild nicht im Figurenordner');
  assert.equal(await downloadImage(cdn, NUM, 0, 'part'), `/images/parts/${NUM}_0.png`);
  assert.ok(fs.existsSync(path.join(PART_IMAGES_DIR, `${NUM}_0.png`)), 'Teilebild nicht im Teileordner');
  // Der einzige Aufruf für Figuren sitzt im Bild-Hintergrundlauf.
  assert.match(read('src/katalog/bildNachlauf.ts'), /downloadImage\(f\.image_url, f\.fig_number, 0, 'minifig'\)/,
    'Der Figuren-Download muss die Art mitgeben — sonst landen Figuren wieder bei den Teilen');
});

test('die Bildroute behält Anmeldepflicht und CDN-Heilung', () => {
  // EINE Route für den ganzen Baum unter data/images/, damit kein Teil ohne
  // Anmeldung ausgeliefert wird (kein statischer Mount: test/media-auth.test.js).
  // strip() vor dem Schneiden, sonst schiebt ein Erklärtext die Zeile hinaus.
  assert.match(strip(read('routes/seiten.ts')), /router\.get\('\/images\/\*pfad',[^)]*\bliefereBild\)/, 'Bildroute nicht gefunden');
  const src = strip(read('src/katalog/http/bildAuslieferung.ts'));
  const start = src.indexOf('function liefereBild(');
  assert.ok(start > 0, 'Bildroute nicht gefunden');
  const route = src.slice(start, start + 2000);
  assert.match(route, /resolveUserId\(req\)/,
    'Ohne Anmeldeprüfung wären die Bilder öffentlich');
  assert.match(route, /cdnFuerFehlendesBild/,
    'Fehlt die lokale Datei, muss weiterhin auf den Bild-Proxy umgeleitet werden');
});

test('es gibt keine Abwärtskompatibilität für die alten Pfade mehr', () => {
  // Bewusste Entscheidung
  const src = read('server.ts');
  assert.doesNotMatch(src, /app\.get\([^)]*['"`]\/data\/part_images/,
    'Weiterleitung für den alten Bildpfad ist wieder da');
  assert.doesNotMatch(src, /app\.get\([^)]*instructions\/shared/,
    'Weiterleitung für den alten Anleitungspfad ist wieder da');

  const paths = read('src/infra/appPaths.ts');
  assert.doesNotMatch(paths, /LEGACY_PART_IMAGES|LEGACY_SHARED_INSTR/,
    'resolveWebPath darf keine Alt-Präfixe mehr kennen');
});

test('der Entrypoint legt die neuen Verzeichnisse an', () => {
  // Kommentare weg: Der Erklärtext im Entrypoint nennt die alten Verzeichnisse
  // ("instructions/shared und part_images sind entfallen") und hätte die
  // Negativprüfung unten selbst ausgelöst.
  const ep = read('docker-entrypoint.sh').replace(/^\s*#[^\n]*$/gm, '');
  for (const d of ['images/sets', 'images/parts', 'images/minifigs', 'instructions']) {
    assert.match(ep, new RegExp(`/app/data/${d.replace('/', '\\/')}`), `${d} fehlt`);
  }
  assert.doesNotMatch(ep, /instructions\/shared|part_images/,
    'Die alten Verzeichnisse dürfen nicht neu angelegt werden');
});
