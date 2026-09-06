/**
 * Ordnung unter data/ — Bilder nach Art getrennt, Anleitungen ohne "shared".
 *
 * ── Was sich geändert hat ───────────────────────────────────────────────────
 *   data/part_images/          → data/images/parts/  +  data/images/minifigs/
 *   data/instructions/shared/  → data/instructions/
 *
 * "part_images" enthielt auch die Minifiguren-Bilder (server.ts rief dieselbe
 * downloadImage()-Funktion auf) — der Name war für die Hälfte des Inhalts
 * falsch. "shared" war der einzige Unterordner von instructions/ und grenzte
 * gegen benutzereigene Anleitungen ab, die dort gar nicht liegen (sondern unter
 * data/uploads/<id>/).
 *
 * Der einmalige Umzug (db/migrations/0002 plus utils/migrateLayout.ts) ist
 * entfernt, nachdem er auf der Installation durchgelaufen war. Was hier bleibt,
 * sind die Zusicherungen über den ZIELZUSTAND: dass keine Quelle mehr die alten
 * Pfade schreibt, dass Teile und Figuren getrennt landen und dass die
 * Bildroute Anmeldepflicht und Heilung behält.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Alle Quelldateien, die Pfade schreiben könnten. */
const SOURCES = ['server.ts', 'routes/parts.ts', 'routes/sets.ts', 'utils/thumbs.ts',
                 'routes/api_v1/pdf.ts', 'jobs/partsCatalogEnrich.ts', 'jobs/catalogSync.ts'];

test('keine Quelle schreibt mehr die alten Pfade', () => {
  for (const f of SOURCES) {
    const src = strip(read(f));
    // In server.ts sind die Alt-Pfade als Weiterleitung noch erlaubt — dort
    // stehen sie in app.get(...) und in lookupCdnForMissingImage, nicht als
    // Ziel eines Schreibvorgangs.
    const writes = [...src.matchAll(/=\s*[`'"]\/data\/(part_images|instructions\/shared)\//g)];
    assert.deepEqual(writes.map(m => m[0]), [],
      `${f}: schreibt noch einen alten Pfad`);
  }
});

test('Teile- und Figurenbilder landen in getrennten Ordnern', () => {
  const enrich = read('jobs/partsCatalogEnrich.ts');
  assert.match(enrich, /kind === 'minifig' \? MINIFIG_IMAGES_DIR : PART_IMAGES_DIR/,
    'downloadImage muss die Art unterscheiden');
  assert.match(enrich, /kind === 'minifig' \? '\/images\/minifigs\/' : '\/images\/parts\/'/,
    'Auch der Web-Pfad muss der Art folgen');
  // Der einzige Aufruf für Figuren sitzt im Bild-Hintergrundlauf.
  assert.match(read('server.ts'), /downloadImage\(f\.image_url, f\.fig_number, 0, 'minifig'\)/,
    'Der Figuren-Download muss die Art mitgeben — sonst landen Figuren wieder bei den Teilen');
});

test('die Bildroute behält Anmeldepflicht und CDN-Heilung', () => {
  // Seit der Vereinheitlichung gibt es EINE Route für den ganzen Baum unter
  // data/images/ — vorher war sie zweigeteilt: Teile und Figuren
  // authentifiziert, Sets über express.static ohne Prüfung. Dass gar kein
  // statischer Mount mehr auf das Datenverzeichnis zeigt, prüft
  // test/media-auth.test.js.
  // Kommentare ausblenden, BEVOR das Fenster geschnitten wird: Ein längerer
  // Erklärtext in der Route (Nachtrag 37 begründet dort die Cache-Kopfzeile)
  // schob die geprüfte Zeile sonst aus den 2000 Zeichen — die Regel galt
  // weiter, nur der Ausschnitt war zu kurz. strip() gibt es in dieser Datei
  // bereits.
  const src = strip(read('server.ts'));
  const start = src.indexOf("app.get('/images/*'");
  assert.ok(start > 0, 'Bildroute nicht gefunden');
  const route = src.slice(start, start + 2000);
  assert.match(route, /resolveUserId\(req\)/,
    'Ohne Anmeldeprüfung wären die Bilder öffentlich');
  assert.match(route, /lookupCdnForMissingImage/,
    'Fehlt die lokale Datei, muss weiterhin auf den Bild-Proxy umgeleitet werden');
});

test('es gibt keine Abwärtskompatibilität für die alten Pfade mehr', () => {
  // ── Bewusste Entscheidung ────────────────────────────────────────────────
  // Kurzzeitig gab es hier Weiterleitungen: /data/part_images/* per 301 auf den
  // neuen Ort, und /data/instructions/shared/* wurde transparent aufgelöst.
  // Gedacht waren sie für eine Android-App, die noch eine zwischengespeicherte
  // Liste mit alten Adressen hält.
  //
  // Sie sind entfallen, weil beide Clients aus derselben Hand kommen und
  // gemeinsam aktualisiert werden. Eine Weiterleitung, die niemand braucht,
  // ist kein Netz, sondern eine zweite Wahrheit: Sie hält den alten Pfad am
  // Leben, verdeckt beim Testen, wenn irgendwo doch noch der alte Wert
  // entsteht, und muss bei jeder weiteren Umsortierung mitgepflegt werden.
  //
  // Der einmalige Umzug hat Datenbank und Dateien längst umgestellt; die alten
  // Pfade gibt es schlicht nicht mehr. Ein Client mit veraltetem
  // Zwischenspeicher bekommt 404 und lädt neu — das gewollte Verhalten.
  const src = read('server.ts');
  assert.doesNotMatch(src, /app\.get\([^)]*['"`]\/data\/part_images/,
    'Weiterleitung für den alten Bildpfad ist wieder da');
  assert.doesNotMatch(src, /app\.get\([^)]*instructions\/shared/,
    'Weiterleitung für den alten Anleitungspfad ist wieder da');

  const paths = read('utils/appPaths.ts');
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
