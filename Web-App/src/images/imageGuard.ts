/** Jimp decodes without a limit; a small image with huge dimensions would be
 * a decompression bomb. */
import { reportError } from '../infra/error';
import fs from 'node:fs';

/** Upper bound in pixels (width × height). 40 MP ≈ 160 MB bitmap. */
export const MAX_PIXELS = 40_000_000;

const HEADER_BYTES = 65536;

/** Without decoding the image data — that is exactly what is to be prevented. */
export function imageSize(buf: Buffer) {
  // PNG: width/height as 32-bit big-endian at offset 16 and 20.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF: then width/height as 16-bit little-endian.
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // JPEG: the dimensions are in the SOF marker (0xFFC0–0xFFCF without C4/C8/CC,
  // which mean something else); along the segment lengths up to there.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      } // skip fill bytes
      // The loop condition secures the access; 0x00 is not a valid marker
      // and changes nothing in the flow.
      const marker = buf[off + 1] ?? 0x00;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      const len = buf.readUInt16BE(off + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      if (len < 2) break; // broken header
      off += 2 + len;
    }
  }

  return null;
}

/** @returns false if the image is too large */
export async function readableImage(filePath: string) {
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    // An empty or truncated file is not an image: otherwise the fallback
    // "unknown format" would let it through.
    if (bytesRead < 10) {
      console.warn(`[image-guard] ${bytesRead} Byte gelesen — keine Bilddatei: ${filePath}`);
      return false;
    }
    const dim = imageSize(buf.subarray(0, bytesRead));
    // Unknown format: let it through. Jimp throws on everything it does not know —
    // the harmless outcome.
    if (!dim) return true;
    if (!dim.width || !dim.height) return true;
    const pixels = dim.width * dim.height;
    if (pixels > MAX_PIXELS) {
      console.error(
        `[image-guard] abgelehnt: ${dim.width}×${dim.height} = ${Math.round(pixels / 1e6)} MP > ${MAX_PIXELS / 1e6} MP — ${filePath}`,
      );
      return false;
    }
    return true;
  } catch (_) {
    return false; // not readable → do not decode
  } finally {
    await fh?.close().catch(e => reportError('bild-wache:close', e));
  }
}
