// sharp rechnet ausserhalb des Event-Loops. Ausführlich: docs/begruendungen/src/katalog/bilder/thumbs.ts.md#abschnitt

import { meldeFehler, fehlertext, einzeilig } from '../../infra/fehler';
import path from 'path';
import fs from 'fs';
import { resolveWebPath } from '../../infra/appPaths';
import { isDecodable } from './imageGuard';

const THUMB_SIZE = 200;

/** Erst sharp, Jimp nur bei einem LADEfehler (native Bibliothek fehlt). Ein
 * defektes Bild soll scheitern und gemerkt werden, nicht zweimal gerechnet. */
async function verkleinern(quelle: string, ziel: string): Promise<void> {
  let sharp: typeof import('sharp') | null = null;
  try { sharp = require('sharp'); }
  catch (e) {
    console.warn(`[thumb] sharp nicht verfügbar (${fehlertext(e)}) — nutze Jimp`);
  }

  if (sharp) {
    // Weisser Grund: Transparente PNGs würden als JPEG sonst schwarz.
    await sharp(quelle)
      .flatten({ background: '#ffffff' })
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(ziel);
    return;
  }

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

  // /images/… zeigt nach data/images/ (Volume), nicht nach public/.
  const fsPath = resolveWebPath(localPath);
  if (!fsPath) return null;

  if (!fs.existsSync(fsPath)) return null;

  const ext      = path.extname(fsPath);
  const thumbFs  = fsPath.replace(ext, '_thumb.jpg');
  const thumbWeb = localPath.replace(ext, '_thumb.jpg');

  if (fs.existsSync(thumbFs)) return thumbWeb;

  // Abmessungen vor dem Dekodieren prüfen: Eine kleine, riesig aufgelöste Datei
  // legte den Worker mit einem Gigabyte-Bitmap lahm.
  if (!(await isDecodable(fsPath))) return null;

  try {
    // ATOMAR schreiben: Ein Schreibvorgang auf den endgültigen Namen ist für
    // parallele Anfragen sichtbar, bevor er fertig ist.
    const tmpThumb = `${thumbFs}.${process.pid}.${Date.now()}.tmp.jpg`;
    await verkleinern(fsPath, tmpThumb);
    await fs.promises.rename(tmpThumb, thumbFs);
    return thumbWeb;
  } catch (e) {
    // NICHT still scheitern.
    console.error(einzeilig(`[thumb] Vorschau fehlgeschlagen für ${localPath}: ${fehlertext(e)}`));
    try {
      const reste = fs.readdirSync(path.dirname(fsPath))
        .filter(f => f.startsWith(path.basename(thumbFs)) && f.endsWith('.tmp.jpg'));
      for (const r of reste) fs.unlinkSync(path.join(path.dirname(fsPath), r));
    } catch (e) { meldeFehler('vorschau:reste', e); }
    return null;
  }
}

