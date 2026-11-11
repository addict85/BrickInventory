/** Jimp dekodiert ohne Grenze; ein kleines Bild mit riesigen Abmessungen wäre
 * eine Dekompressionsbombe. */
import { logAndContinue } from '../../infra/fehler';
import fs from 'fs';

/** Obergrenze in Pixeln (Breite × Höhe). 40 MP ≈ 160 MB Bitmap. */
export const MAX_PIXELS = 40_000_000;

const HEADER_BYTES = 65536;

/** Ohne die Bilddaten zu dekodieren — genau das soll ja verhindert werden. */
export function readDimensions(buf: Buffer) {
  // PNG: Breite/Höhe als 32-Bit-Big-Endian an Offset 16 bzw. 20.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF: danach Breite/Höhe als 16-Bit-Little-Endian.
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // JPEG: Die Abmessungen stehen im SOF-Marker (0xFFC0–0xFFCF ohne C4/C8/CC,
  // die anderes bedeuten); entlang der Segmentlängen bis dorthin.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }          // Füllbytes überspringen
      // Die Schleifenbedingung sichert den Zugriff; 0x00 ist kein gültiger Marker
      // und ändert nichts am Ablauf.
      const marker = buf[off + 1] ?? 0x00;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      const len = buf.readUInt16BE(off + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      if (len < 2) break;                                   // defekter Header
      off += 2 + len;
    }
  }

  return null;
}

/** @returns false, wenn das Bild zu gross ist */
export async function isDecodable(filePath: string) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    // Eine leere oder abgeschnittene Datei ist kein Bild: Sonst liesse der Rückfall
    // „unbekanntes Format" sie durch.
    if (bytesRead < 10) {
      console.warn(`[image-guard] ${bytesRead} Byte gelesen — keine Bilddatei: ${filePath}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return false;
    }
    const dim = readDimensions(buf.subarray(0, bytesRead));
    // Unbekanntes Format: durchlassen. Jimp wirft bei allem, was es nicht kennt —
    // der harmlose Ausgang.
    if (!dim) return true;
    if (!dim.width || !dim.height) return true;
    const pixels = dim.width * dim.height;
    if (pixels > MAX_PIXELS) {
      console.error(`[image-guard] abgelehnt: ${dim.width}×${dim.height} = ${Math.round(pixels / 1e6)} MP > ${MAX_PIXELS / 1e6} MP — ${filePath}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return false;
    }
    return true;
  } catch (_) {
    return false;   // nicht lesbar → nicht dekodieren
  } finally {
    await fh?.close().catch(logAndContinue('bild-wache:close'));
  }
}

