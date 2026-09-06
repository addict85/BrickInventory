/**
 * Vorschaubilder: 200×200 JPEG, neben dem Original mit der Endung _thumb.jpg.
 *
 * ── Warum sharp und nicht mehr Jimp (Nachtrag 118) ──────────────────────────
 * Jimp ist reines JavaScript. Jede Verkleinerung läuft damit im selben Thread
 * wie alles andere — auf Marcos Raspberry Pi war das die teuerste Einzelarbeit
 * im ganzen Server. Fünf Nachträge lang habe ich sie gedrosselt, und am Ende
 * blieb: dreissig Läufe je Minute sind immer noch zu viel, weil jeder einzelne
 * teuer ist.
 *
 * sharp setzt auf libvips auf. Es rechnet in nativem Code UND ausserhalb des
 * Event-Loops (libuv-Threadpool) — der Server bleibt währenddessen ansprechbar.
 * Das ist der eigentliche Gewinn: nicht nur schneller, sondern nicht mehr im
 * Weg.
 *
 * Nebenbei fällt ein Dauerärgernis weg: Jimp kann webp nicht entpacken. Genau
 * daran scheiterten in Marcos Log immer dieselben Sets („Mime type image/webp
 * does not support decoding"). sharp kann es.
 *
 * ── Warum die Datei in utils/ liegt und nicht in routes/ ────────────────────
 * Sie lag in routes/, obwohl sie KEINE Route enthaelt — kein `router.get`,
 * kein `app.get`, nur drei Funktionen und einen Export. Der Ordnername sagte
 * damit etwas Falsches ueber ihren Inhalt.
 *
 * Das blieb nicht folgenlos: generateThumb() wird an NEUN Stellen gebraucht,
 * verteilt auf jobs/catalogSync, jobs/imageQueue, jobs/partsCatalogEnrich,
 * jobs/startNachlaeufe, utils/partsImport, utils/setService und server.ts.
 * Alle sechs Nicht-Route-Dateien mussten also aus der aeussersten Schicht
 * importieren, um an eine Bildfunktion zu kommen. Die Abhaengigkeit zeigte
 * nach aussen statt nach innen, und zwar oefter als jede andere im Baum
 * (nachgemessen: der zweithaeufigste Fall hat zwei Nutzer).
 *
 * Verschoben, nicht umgeschrieben: Der Inhalt ist derselbe.
 *
 * ── Jimp bleibt als Rückfall ────────────────────────────────────────────────
 * sharp bringt eine native Bibliothek mit. Lässt sie sich auf einer Plattform
 * nicht laden, wäre der Ausfall sonst total — keine Vorschau mehr, nirgends.
 * Deshalb der Rückfall auf den alten Weg. Er ist langsam, aber er funktioniert
 * seit Jahren.
 */

import path from 'path';
import fs from 'fs';
import { resolveWebPath } from './appPaths';
import { isDecodable } from './imageGuard';

const THUMB_SIZE = 200;

/**
 * Generate thumbnail for a local image file.
 * Returns the relative web path of the thumbnail, or null on failure.
 */
/**
 * Das Bild auf THUMB_SIZE bringen und als JPEG schreiben.
 *
 * Erst sharp, bei einem Ladefehler Jimp. „Ladefehler" heisst: Die native
 * Bibliothek fehlt oder passt nicht zur Plattform — NICHT, dass ein einzelnes
 * Bild kaputt ist. Ein defektes Bild soll scheitern und gemerkt werden
 * (utils/imageMisses), nicht zweimal gerechnet werden.
 */
async function verkleinern(quelle: string, ziel: string): Promise<void> {
  let sharp: any = null;
  try { sharp = require('sharp'); }
  catch (e: any) {
    console.warn(`[thumb] sharp nicht verfügbar (${e?.message || e}) — nutze Jimp`);
  }

  if (sharp) {
    // `fit: 'cover'` schneidet mittig zu, wie zuvor .cover().
    // Der weisse Grund ersetzt die frühere Kopie auf eine weisse Fläche: Ohne
    // ihn würden transparente PNGs beim Umwandeln nach JPEG schwarz.
    await sharp(quelle)
      .flatten({ background: '#ffffff' })
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(ziel);
    return;
  }

  // ── Rückfall: Jimp ────────────────────────────────────────────────────────
  const { Jimp } = require('jimp');
  const image = await Jimp.read(quelle);
  const bg = new Jimp({ width: image.bitmap.width, height: image.bitmap.height, color: 0xffffffff });
  bg.composite(image, 0, 0);
  bg.cover({ w: THUMB_SIZE, h: THUMB_SIZE });
  await bg.write(ziel as `${string}.${string}`, { quality: 80 });
}

async function generateThumb(localPath: string) {
  if (!localPath) return null;

  // localPath ist z. B. /images/sets/75192-1.jpg oder /images/parts/3001_4.png.
  // Die Auflösung liegt zentral in utils/appPaths.ts — /images/… zeigt seit der
  // Umstellung nach data/images/ (Volume) statt nach public/ (Image-Inhalt).
  const fsPath = resolveWebPath(localPath);
  if (!fsPath) return null;

  if (!fs.existsSync(fsPath)) return null;

  // Thumb path: same dir, filename + _thumb.jpg
  const ext      = path.extname(fsPath);
  const thumbFs  = fsPath.replace(ext, '_thumb.jpg');
  const thumbWeb = localPath.replace(ext, '_thumb.jpg');

  // Already exists?
  if (fs.existsSync(thumbFs)) return thumbWeb;

  // Vor dem Dekodieren die Abmessungen prüfen — siehe utils/imageGuard.ts.
  // Ohne das kann eine kleine, aber riesig aufgelöste Datei den Worker mit
  // einem Bitmap im Gigabyte-Bereich lahmlegen.
  if (!(await isDecodable(fsPath))) return null;

  try {
    // ATOMAR schreiben (Nachtrag 41) — dieselbe Begründung wie in
    // routes/imgProxy.ts: Ein Schreibvorgang auf den ENDGÜLTIGEN Namen ist für
    // parallele Anfragen sichtbar, bevor er fertig ist. Die Bildroute liefert
    // dann eine Teilgrösse als Content-Length aus, der Browser zeigt nichts,
    // und weil das kaputte Bild mit ETag im Zwischenspeicher landet, bleibt es
    // dabei. rename() innerhalb desselben Dateisystems ist unteilbar.
    //
    // Die Endung .jpg im temporären Namen stammt aus Nachtrag 48: Jimp leitete
    // das Zielformat aus ihr ab. sharp tut das nicht (das Format steht im
    // Aufruf), aber der Rückfall unten benutzt weiterhin Jimp — die Endung
    // bleibt deshalb.
    const tmpThumb = `${thumbFs}.${process.pid}.${Date.now()}.tmp.jpg`;
    await verkleinern(fsPath, tmpThumb);
    await fs.promises.rename(tmpThumb, thumbFs);
    return thumbWeb;
  } catch (e: any) {
    // NICHT still scheitern (Nachtrag 49).
    //
    // Hier stand `catch (e) { return null; }`. Genau das hat den .tmp-Fehler
    // aus Nachtrag 41 SIEBEN Nachträge lang verdeckt: Die Erzeugung scheiterte
    // bei jedem einzelnen Aufruf, und weder Log noch Zähler sagten ein Wort.
    // Gefunden wurde es erst, weil einem Nutzer auffiel, dass neue Sets keine
    // Vorschau bekommen — der teuerste denkbare Weg.
    //
    // Aufräumen inbegriffen: Eine liegengebliebene .tmp.jpg würde sonst den
    // Ordner zumüllen, ohne je verwendet zu werden.
    console.error(`[thumb] Vorschau fehlgeschlagen für ${localPath}: ${e?.message || e}`);
    try {
      const reste = fs.readdirSync(path.dirname(fsPath))
        .filter(f => f.startsWith(path.basename(thumbFs)) && f.endsWith('.tmp.jpg'));
      for (const r of reste) fs.unlinkSync(path.join(path.dirname(fsPath), r));
    } catch (_) {}
    return null;
  }
}

/**
 * Generate thumbnails for a batch of local paths (background, non-blocking).
 */

export { generateThumb };
