/**
 * Schutzgrenzen für die Bildverarbeitung mit Jimp.
 * Ausführlich: docs/begruendungen/utils/imageGuard.ts.md#abschnitt
 */
import fs from 'fs';

/** Obergrenze in Pixeln (Breite × Höhe). 40 MP ≈ 160 MB Bitmap. */
const MAX_PIXELS = 40_000_000;

/** So viele Bytes vom Dateianfang reichen für jeden hier unterstützten Header. */
const HEADER_BYTES = 65536;

/**
 * Abmessungen aus einem Bild-Header lesen — ohne die Bilddaten zu dekodieren.
 * Ausführlich: docs/begruendungen/utils/imageGuard.ts.md#readdimensions
 * @param {Buffer} buf Die ersten Bytes der Datei
 * @returns {{width: number, height: number} | null}
 */
function readDimensions(buf: Buffer) {
  // ── PNG ───────────────────────────────────────────────────────────────────
  // Signatur (8 Byte) + IHDR-Chunk; Breite/Höhe stehen als 32-Bit-Big-Endian
  // an Offset 16 bzw. 20.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // ── GIF ───────────────────────────────────────────────────────────────────
  // "GIF87a"/"GIF89a", danach Breite/Höhe als 16-Bit-Little-Endian.
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // ── JPEG ──────────────────────────────────────────────────────────────────
  // Kette von Segmenten; die Abmessungen stehen im SOF-Marker (0xFFC0–0xFFCF,
  // ohne C4/C8/CC, die andere Bedeutung haben). Wir hangeln uns an den
  // Segmentlängen entlang, bis ein SOF auftaucht.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }          // Füllbytes überspringen
      // Die Schleifenbedingung (`off + 9 < buf.length`) sichert den Zugriff,
      // der Uebersetzer sieht das nicht. 0x00 ist kein gueltiger JPEG-Marker
      // und faellt durch alle Vergleiche darunter — der Rueckfall aendert also
      // nichts am Ablauf.
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

/**
 * Prüft, ob eine Datei gefahrlos an Jimp übergeben werden darf.
 *
 * @param {string} filePath Pfad zur Bilddatei
 * @returns {Promise<boolean>} false, wenn das Bild zu gross ist
 */
async function isDecodable(filePath: string) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    // Eine LEERE oder abgeschnittene Datei ist kein Bild
    // Ohne diese Schranke kam so eine Datei durch: `bytesRead` ist 0, damit
    // erkennt readDimensions() kein Format, und der Rueckfall „unbekanntes
    // Format: durchlassen" liess sie weiter — bis sharp daran scheiterte.
    // Ausführlich: docs/begruendungen/utils/imageGuard.ts.md#isdecodable
    if (bytesRead < 10) {
      console.warn(`[image-guard] ${bytesRead} Byte gelesen — keine Bilddatei: ${filePath}`);
      return false;
    }
    const dim = readDimensions(buf.subarray(0, bytesRead));
    // Unbekanntes Format: durchlassen. Jimp erkennt ohnehin nur eine Handvoll
    // Formate und wirft bei allem anderen — das ist der harmlose Ausgang.
    if (!dim) return true;
    if (!dim.width || !dim.height) return true;
    const pixels = dim.width * dim.height;
    if (pixels > MAX_PIXELS) {
      console.error(`[image-guard] abgelehnt: ${dim.width}×${dim.height} = ${Math.round(pixels / 1e6)} MP > ${MAX_PIXELS / 1e6} MP — ${filePath}`);
      return false;
    }
    return true;
  } catch (_) {
    return false;   // nicht lesbar → nicht dekodieren
  } finally {
    await fh?.close().catch(() => {});
  }
}

export { isDecodable, readDimensions, MAX_PIXELS };
