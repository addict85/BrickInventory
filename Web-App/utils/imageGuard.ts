/**
 * Schutzgrenzen für die Bildverarbeitung mit Jimp.
 *
 * ── Das Problem ─────────────────────────────────────────────────────────────
 * Jimp ist reines JavaScript und dekodiert im Haupt-Thread. Der Speicherbedarf
 * hängt nicht von der DATEIGRÖSSE ab, sondern von der Pixelzahl: Ein Bitmap
 * belegt Breite × Höhe × 4 Bytes. Eine PNG-Datei mit 20'000 × 20'000 Pixeln ist
 * als Datei nur wenige Kilobyte gross (eine einfarbige Fläche komprimiert
 * hervorragend), belegt beim Dekodieren aber rund 1,6 GB und blockiert dabei
 * den Event-Loop des Workers für Sekunden. Man nennt das eine Dekompressions-
 * bombe; die 5-MB-Grenze des Bild-Proxys greift dagegen nicht, weil sie die
 * komprimierte Grösse misst.
 *
 * ── Die Lösung ──────────────────────────────────────────────────────────────
 * Vor dem Dekodieren nur den Dateikopf lesen und die Abmessungen bestimmen.
 * Bild-Header sind klein und stehen am Anfang der Datei — 64 KB reichen für
 * PNG, JPEG und GIF sicher aus. Erst wenn Breite × Höhe unter der Grenze
 * liegt, wird Jimp überhaupt aufgerufen.
 *
 * Die Grenze von 40 Megapixeln ist grosszügig: Set-Bilder der CDNs liegen bei
 * unter 1 MP, eine 50-Megapixel-Kamera erzeugt 50 MP. Es geht nicht darum,
 * grosse Fotos abzulehnen, sondern absurde Werte abzufangen.
 */
import fs from 'fs';

/** Obergrenze in Pixeln (Breite × Höhe). 40 MP ≈ 160 MB Bitmap. */
const MAX_PIXELS = 40_000_000;

/** So viele Bytes vom Dateianfang reichen für jeden hier unterstützten Header. */
const HEADER_BYTES = 65536;

/**
 * Abmessungen aus einem Bild-Header lesen — ohne die Bilddaten zu dekodieren.
 *
 * Unterstützt PNG, JPEG und GIF; das sind die Formate, die über den Bild-Proxy
 * und die Anleitungs-Uploads hereinkommen. Bei einem unbekannten Format wird
 * null geliefert, und der Aufrufer entscheidet (siehe assertDecodable: im
 * Zweifel durchlassen, damit ein exotisches, aber harmloses Format nicht
 * grundlos scheitert).
 *
 * @param {Buffer} buf Die ersten Bytes der Datei
 * @returns {{width: number, height: number} | null}
 */
function readDimensions(buf) {
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
      const marker = buf[off + 1];
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
async function isDecodable(filePath) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
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
