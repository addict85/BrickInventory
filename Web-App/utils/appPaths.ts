/**
 * Zentrale Auflösung der Anwendungspfade.
 *
 * ── Warum das nötig wurde ───────────────────────────────────────────────────
 * Die Codebasis berechnete Pfade zu data/ und public/ überall aus __dirname:
 * in server.ts als `path.join(__dirname, 'data')`, in den Modulen unter
 * routes/ und utils/ als `path.join(__dirname, '..', 'data')`. Das funktionierte,
 * solange die transpilierten .js NEBEN ihren Quellen lagen — server.js in der
 * Wurzel, routes/*.js eine Ebene darunter.
 *
 * Seit der Build nach dist/ schreibt, stimmt das nicht mehr: dist/server.js
 * sieht als __dirname das Verzeichnis dist/, nicht die Wurzel. Jeder dieser
 * Pfade hätte auf dist/data bzw. dist/public gezeigt — also NEBEN das
 * gemountete Volume. Der Effekt wäre besonders unangenehm gewesen, weil nichts
 * abstürzt: Verzeichnisse werden bei Bedarf angelegt, Uploads landen dort
 * brav — und sind nach dem nächsten Container-Neustart weg.
 *
 * Deshalb wird die Wurzel EINMAL bestimmt und überall von hier bezogen.
 *
 * ── Wie die Wurzel gefunden wird ────────────────────────────────────────────
 * Ausgangspunkt ist das Verzeichnis dieser Datei. Von dort aus wird nach oben
 * gegangen, bis eine package.json auftaucht — das ist die Wurzel, unabhängig
 * davon, ob der Code aus den Quellen (utils/) oder aus dem Build (dist/utils/)
 * läuft. APP_ROOT lässt sich zusätzlich per Umgebungsvariable überschreiben.
 */
import path from 'path';
import fs from 'fs';

function findRoot(): string {
  if (process.env.APP_ROOT) return path.resolve(process.env.APP_ROOT);
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Rückfallebene: zwei Ebenen über dieser Datei (utils/ → Wurzel).
  return path.resolve(__dirname, '..');
}

/** Wurzelverzeichnis der Anwendung (enthält package.json, data/, public/). */
const APP_ROOT = findRoot();

/** Laufzeitdaten — gemountetes Volume. Bilder, Uploads, Anleitungen, Caches. */
const DATA_DIR = path.join(APP_ROOT, 'data');

/** Ausgelieferte Frontend-Dateien. Im Image aus dem Build-Stage, read-only. */
const PUBLIC_DIR = path.join(APP_ROOT, 'public');

/**
 * Heruntergeladene Set-, Teile- und Minifiguren-Bilder.
 *
 * ── Warum das aus public/ herausgezogen wurde ───────────────────────────────
 * Set-Bilder landeten bisher unter public/images/sets/ — also im Verzeichnis
 * der ausgelieferten Repo-Assets, das im Docker-Image aus dem Build-Stage
 * kommt und NICHT im gemounteten Volume liegt. Drei Folgen:
 *
 *   1. Nach jedem Container-Rebuild waren alle Bilder weg und mussten einzeln
 *      neu vom CDN geholt werden — bei ein paar tausend Sets stundenlang, mit
 *      entsprechendem Verbrauch am API-Tageskontingent.
 *   2. Eine Sicherung von data/ erfasste sie nicht. Wer data/ zurückspielte,
 *      hatte die Datenbank, aber keine Bilder.
 *   3. public/ war nicht mehr "nur Code": Laufzeitdaten und Build-Ergebnis
 *      lagen im selben Baum — dieselbe Vermischung wie vorher bei .ts/.js.
 *
 * Jetzt liegen sie unter data/images/ und damit im Volume. Der WEB-PFAD bleibt
 * absichtlich unverändert bei "/images/…": In der Datenbank stehen tausende
 * image_local-Werte mit diesem Präfix, und die Android-App baut ihre Bild-URLs
 * daraus. Eine Änderung des Pfads hätte eine Datenmigration UND ein
 * gleichzeitiges App-Update erzwungen — ohne jeden Gegenwert, denn welches
 * Verzeichnis dahinter liegt, geht den Client nichts an.
 */
const IMAGES_DIR = path.join(DATA_DIR, 'images');

/**
 * Bilder nach Art getrennt.
 *
 * ── Wie es vorher aussah ────────────────────────────────────────────────────
 * Set-Bilder lagen unter data/images/sets/, Teile- UND Minifiguren-Bilder
 * dagegen zusammen in data/part_images/. Der Name war damit doppelt irreführend:
 * Er stand auf derselben Ebene wie data/images (statt darin), und er nannte nur
 * eine der beiden Sorten, die er enthielt — die Figuren-Bilder landeten dort
 * über denselben downloadImage()-Aufruf.
 *
 * Jetzt eine Ebene, drei sprechende Ordner:
 *
 *   data/images/sets/       75192-1.jpg
 *   data/images/parts/      3001_4.png
 *   data/images/minifigs/   fig-001234_0.jpg
 *
 * Vorschaubilder liegen wie bisher als <name>_thumb.jpg DANEBEN, nicht in einem
 * eigenen Unterordner — die Zuordnung ergibt sich aus dem Dateinamen.
 */
const SET_IMAGES_DIR     = path.join(IMAGES_DIR, 'sets');
const PART_IMAGES_DIR    = path.join(IMAGES_DIR, 'parts');
const MINIFIG_IMAGES_DIR = path.join(IMAGES_DIR, 'minifigs');

/**
 * Geteilte Bauanleitungen (PDFs).
 *
 * ── Warum der Unterordner "shared" entfallen ist ────────────────────────────
 * Die Dateien lagen unter data/instructions/shared/. Der Unterordner sollte sie
 * von benutzereigenen Anleitungen abgrenzen — die liegen aber gar nicht hier,
 * sondern unter data/uploads/<benutzer-id>/. data/instructions/ enthielt also
 * ausschliesslich "shared" und bestand aus genau einem Unterordner.
 *
 * Dass die Trennung trotzdem nötig schien, lag an der Auslieferung: Die
 * generische /data/instructions/-Route prüft das erste Pfadsegment gegen die
 * Benutzer-ID. Diese Route gibt es für Anleitungen nicht mehr — sie sind
 * benutzerübergreifend und werden als solche ausgeliefert (siehe server.ts).
 */
const INSTRUCTIONS_DIR = path.join(DATA_DIR, 'instructions');

/**
 * Web-Pfad ("/data/…" oder "/images/…") in einen Dateisystempfad übersetzen.
 * Liefert null für alles andere — der Aufrufer entscheidet, was das heisst.
 *
 * @param {string} webPath z. B. "/data/part_images/3001_4.png"
 * @returns {string|null}
 */
function resolveWebPath(webPath: string): string | null {
  if (!webPath) return null;
  if (webPath.startsWith('/data/'))   return path.join(APP_ROOT, webPath.slice(1));
  // "/images/sets/x.jpg" → <data>/images/sets/x.jpg (siehe IMAGES_DIR oben).
  if (webPath.startsWith('/images/')) return path.join(IMAGES_DIR, webPath.slice('/images/'.length));
  return null;
}


export {
  APP_ROOT, DATA_DIR, PUBLIC_DIR, IMAGES_DIR,
  SET_IMAGES_DIR, PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, INSTRUCTIONS_DIR,
  resolveWebPath,
};
