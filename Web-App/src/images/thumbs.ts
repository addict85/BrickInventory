// sharp computes outside the event loop.

import { reportError, errorMessage, withoutMissingFile } from '../infra/error';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { resolveWebPath } from '../infra/appPaths';
import { readableImage } from './imageGuard';

const THUMB_SIZE = 200;

/** At most THUMB_SIZE per side, aspect ratio preserved: cropped, wide images lost their edges,
 * enlarged, small ones became blurry. The tile fits the image itself (object-fit). */
export function fitJimp(
  image: { bitmap: { width: number; height: number }; scaleToFit(o: { w: number; h: number }): unknown },
  size: number,
) {
  if (image.bitmap.width > size || image.bitmap.height > size) image.scaleToFit({ w: size, h: size });
}

/** Transparent images become PNG under the same name (_thumb.jpg, which many places know): set on white
 * they appeared as a white area in dark mode. Delivered with the type from the first bytes. */
export async function previewType(file: string): Promise<'image/png' | 'image/jpeg'> {
  const header = Buffer.alloc(4);
  const fd = await fs.promises.open(file, 'r').catch(withoutMissingFile('vorschau:typ', null));
  if (!fd) return 'image/jpeg';
  try {
    await fd.read(header, 0, 4, 0);
  } finally {
    await fd.close();
  }
  return header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : 'image/jpeg';
}

/** Jimp fallback for both preview kinds: PNG with real transparency, otherwise JPEG on white. */
export async function jimpPreview(source: string, target: string, size: number): Promise<void> {
  const { Jimp } = require('jimp');
  const image = await Jimp.read(source);
  const d = image.bitmap.data as Buffer;
  let transparent = false;
  for (let i = 3; i < d.length && !transparent; i += 4) transparent = d[i]! < 255;
  if (transparent) {
    fitJimp(image, size);
    await fs.promises.writeFile(target, await image.getBuffer('image/png'));
    return;
  }
  const bg = new Jimp({ width: image.bitmap.width, height: image.bitmap.height, color: 0xffffffff });
  bg.composite(image, 0, 0);
  fitJimp(bg, size);
  await fs.promises.writeFile(target, await bg.getBuffer('image/jpeg', { quality: 80 }));
}

/** sharp first, Jimp only on a LOAD error (native library missing). A
 * broken image should fail and be remembered, not be computed twice. */
async function shrink(source: string, target: string): Promise<void> {
  let sharp: typeof import('sharp') | null = null;
  try {
    sharp = require('sharp');
  } catch (e) {
    // Exception: without the native library Jimp computes; the image is created anyway.
    reportError('vorschau:sharp nicht verfügbar, nutze Jimp', e);
  }

  if (sharp) {
    const fitted = () => sharp(source).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true });
    // An alpha channel alone means nothing (many PNGs are fully opaque); only real transparency stays PNG.
    if (!(await sharp(source).stats()).isOpaque) {
      await fitted().png({ compressionLevel: 9 }).toFile(target);
      return;
    }
    // White background: an alpha channel would otherwise turn black as JPEG.
    await fitted().flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(target);
    return;
  }

  // Only loaded here: Jimp is the fallback and mostly never needed.
  await jimpPreview(source, target, THUMB_SIZE);
}

export async function previewFrom(localPath: string) {
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
      `[thumb] Vorschau fehlgeschlagen für ${localPath}: ${errorMessage(e)}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    try {
      const rest = fs
        .readdirSync(path.dirname(fsPath))
        .filter(f => f.startsWith(path.basename(thumbFs)) && f.endsWith('.tmp.jpg'));
      for (const r of rest) fs.unlinkSync(path.join(path.dirname(fsPath), r));
    } catch (e) {
      reportError('vorschau:reste', e);
    }
    return null;
  }
}
