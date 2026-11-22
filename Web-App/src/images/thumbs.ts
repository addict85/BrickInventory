// sharp computes outside the event loop.

import { reportError, fehlertext, withoutMissingFile } from '../infra/error';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { resolveWebPath } from '../infra/appPaths';
import { readableImage } from './imageGuard';

const THUMB_SIZE = 200;

/** At most THUMB_SIZE per side, aspect ratio preserved: cropped, wide images lost their edges,
 * enlarged, small ones became blurry. The tile fits the image itself (object-fit). */
export function fitJimp(
  bild: { bitmap: { width: number; height: number }; scaleToFit(o: { w: number; h: number }): unknown },
  groesse: number,
) {
  if (bild.bitmap.width > groesse || bild.bitmap.height > groesse) bild.scaleToFit({ w: groesse, h: groesse });
}

/** Transparent images become PNG under the same name (_thumb.jpg, which many places know): set on white
 * they appeared as a white area in dark mode. Delivered with the type from the first bytes. */
export async function previewType(datei: string): Promise<'image/png' | 'image/jpeg'> {
  const kopf = Buffer.alloc(4);
  const fd = await fs.promises.open(datei, 'r').catch(withoutMissingFile('vorschau:typ', null));
  if (!fd) return 'image/jpeg';
  try {
    await fd.read(kopf, 0, 4, 0);
  } finally {
    await fd.close();
  }
  return kopf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : 'image/jpeg';
}

/** Jimp fallback for both preview kinds: PNG with real transparency, otherwise JPEG on white. */
export async function jimpPreview(quelle: string, ziel: string, groesse: number): Promise<void> {
  const { Jimp } = require('jimp');
  const bild = await Jimp.read(quelle);
  const d = bild.bitmap.data as Buffer;
  let transparent = false;
  for (let i = 3; i < d.length && !transparent; i += 4) transparent = d[i]! < 255;
  if (transparent) {
    fitJimp(bild, groesse);
    await fs.promises.writeFile(ziel, await bild.getBuffer('image/png'));
    return;
  }
  const bg = new Jimp({ width: bild.bitmap.width, height: bild.bitmap.height, color: 0xffffffff });
  bg.composite(bild, 0, 0);
  fitJimp(bg, groesse);
  await fs.promises.writeFile(ziel, await bg.getBuffer('image/jpeg', { quality: 80 }));
}

/** sharp first, Jimp only on a LOAD error (native library missing). A
 * broken image should fail and be remembered, not be computed twice. */
async function shrink(quelle: string, ziel: string): Promise<void> {
  let sharp: typeof import('sharp') | null = null;
  try {
    sharp = require('sharp');
  } catch (e) {
    // Exception: without the native library Jimp computes; the image is created anyway.
    reportError('vorschau:sharp nicht verfügbar, nutze Jimp', e);
  }

  if (sharp) {
    const fitted = () => sharp(quelle).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true });
    // An alpha channel alone means nothing (many PNGs are fully opaque); only real transparency stays PNG.
    if (!(await sharp(quelle).stats()).isOpaque) {
      await fitted().png({ compressionLevel: 9 }).toFile(ziel);
      return;
    }
    // White background: an alpha channel would otherwise turn black as JPEG.
    await fitted().flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(ziel);
    return;
  }

  // Only loaded here: Jimp is the fallback and mostly never needed.
  await jimpPreview(quelle, ziel, THUMB_SIZE);
}

export async function vorschauErzeugenAus(localPath: string) {
  if (!localPath) return null;

  // /images/… points to data/images/ (volume), not to public/.
  const fsPath = resolveWebPath(localPath);
  if (!fsPath) return null;

  if (!fs.existsSync(fsPath)) return null;

  const ext = path.extname(fsPath);
  const thumbFs = fsPath.replace(ext, '_thumb.jpg');
  const thumbWeb = localPath.replace(ext, '_thumb.jpg');

  if (fs.existsSync(thumbFs)) return thumbWeb;

  // Check dimensions before decoding: a small file with huge resolution
  // would paralyze the worker with a gigabyte bitmap.
  if (!(await readableImage(fsPath))) return null;

  try {
    // Write ATOMICALLY: a write to the final name is visible to
    // parallel requests before it is finished.
    const tmpThumb = `${thumbFs}.${process.pid}.${randomUUID()}.tmp.jpg`;
    await shrink(fsPath, tmpThumb);
    await fs.promises.rename(tmpThumb, thumbFs);
    return thumbWeb;
  } catch (e) {
    // Do NOT fail silently.
    console.error(
      `[thumb] Vorschau fehlgeschlagen für ${localPath}: ${fehlertext(e)}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    try {
      const reste = fs
        .readdirSync(path.dirname(fsPath))
        .filter(f => f.startsWith(path.basename(thumbFs)) && f.endsWith('.tmp.jpg'));
      for (const r of reste) fs.unlinkSync(path.join(path.dirname(fsPath), r));
    } catch (e) {
      reportError('vorschau:reste', e);
    }
    return null;
  }
}
