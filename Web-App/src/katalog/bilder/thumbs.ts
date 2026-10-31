/**
 * Vorschaubilder: 200×200 JPEG, neben dem Original mit der Endung _thumb.jpg.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/thumbs.ts.md#abschnitt
 */

import { meldeUndWeiter } from '../../infra/httpError';
import path from 'path';
import fs from 'fs';
import { resolveWebPath } from '../../infra/appPaths';
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
 * (src/katalog/bilder/imageMisses), nicht zweimal gerechnet werden.
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
  // Erst hier geladen: Jimp ist der Rückfall und wird meist nie gebraucht.
  const { Jimp } = require('jimp');
  const image = await Jimp.read(quelle);
  const bg = new Jimp({ width: image.bitmap.width, height: image.bitmap.height, color: 0xffffffff });
  bg.composite(image, 0, 0);
  bg.cover({ w: THUMB_SIZE, h: THUMB_SIZE });
  await bg.write(ziel as `${string}.${string}`, { quality: 80 });
}

export async function generateThumb(localPath: string) {
  if (!localPath) return null;

  // localPath ist z. B. /images/sets/75192-1.jpg oder /images/parts/3001_4.png.
  // Die Auflösung liegt zentral in src/infra/appPaths.ts — /images/… zeigt seit der
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

  // Vor dem Dekodieren die Abmessungen prüfen — siehe src/katalog/bilder/imageGuard.ts.
  // Ohne das kann eine kleine, aber riesig aufgelöste Datei den Worker mit
  // einem Bitmap im Gigabyte-Bereich lahmlegen.
  if (!(await isDecodable(fsPath))) return null;

  try {
    // ATOMAR schreiben — dieselbe Begründung wie in
    // routes/imgProxy.ts: Ein Schreibvorgang auf den ENDGÜLTIGEN Namen ist für
    // parallele Anfragen sichtbar, bevor er fertig ist. Die Bildroute liefert
    // dann eine Teilgrösse als Content-Length aus, der Browser zeigt nichts, …
    // Ausführlich: docs/begruendungen/src/katalog/bilder/thumbs.ts.md#generatethumb-tmpthumb
    const tmpThumb = `${thumbFs}.${process.pid}.${Date.now()}.tmp.jpg`;
    await verkleinern(fsPath, tmpThumb);
    await fs.promises.rename(tmpThumb, thumbFs);
    return thumbWeb;
  } catch (e: any) {
    // NICHT still scheitern.
    // Ausführlich: docs/begruendungen/src/katalog/bilder/thumbs.ts.md#generatethumb
    console.error(`[thumb] Vorschau fehlgeschlagen für ${localPath}: ${e?.message || e}`);
    try {
      const reste = fs.readdirSync(path.dirname(fsPath))
        .filter(f => f.startsWith(path.basename(thumbFs)) && f.endsWith('.tmp.jpg'));
      for (const r of reste) fs.unlinkSync(path.join(path.dirname(fsPath), r));
    } catch (e) { meldeUndWeiter('vorschau:reste', e); }
    return null;
  }
}

/**
 * Generate thumbnails for a batch of local paths (background, non-blocking).
 */

