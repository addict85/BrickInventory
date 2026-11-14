// sharp rechnet ausserhalb des Event-Loops.

import { meldeFehler, fehlertext, ohneFehlendeDatei } from '../infra/fehler';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { resolveWebPath } from '../infra/appPaths';
import { isDecodable } from './imageGuard';

const THUMB_SIZE = 200;

/** Höchstens THUMB_SIZE je Seite, Seitenverhältnis bleibt: Zugeschnitten fehlten breiten Bildern die Ränder,
 * vergrössert wurden kleine unscharf. Die Kachel passt das Bild selbst ein (object-fit). */
export function jimpEinpassen(
  bild: { bitmap: { width: number; height: number }; scaleToFit(o: { w: number; h: number }): unknown },
  groesse: number,
) {
  if (bild.bitmap.width > groesse || bild.bitmap.height > groesse) bild.scaleToFit({ w: groesse, h: groesse });
}

/** Durchsichtige Bilder werden PNG unter demselben Namen (_thumb.jpg, den viele Stellen kennen): Auf Weiss
 * gesetzt standen sie im Dunkelmodus als weisse Fläche da. Ausgeliefert mit dem Typ aus den ersten Bytes. */
export async function vorschauTyp(datei: string): Promise<'image/png' | 'image/jpeg'> {
  const kopf = Buffer.alloc(4);
  const fd = await fs.promises.open(datei, 'r').catch(ohneFehlendeDatei('vorschau:typ', null));
  if (!fd) return 'image/jpeg';
  try {
    await fd.read(kopf, 0, 4, 0);
  } finally {
    await fd.close();
  }
  return kopf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : 'image/jpeg';
}

/** Jimp-Rückfall für beide Vorschauarten: mit echter Transparenz PNG, sonst JPEG auf Weiss. */
export async function jimpVorschau(quelle: string, ziel: string, groesse: number): Promise<void> {
  const { Jimp } = require('jimp');
  const bild = await Jimp.read(quelle);
  const d = bild.bitmap.data as Buffer;
  let durchsichtig = false;
  for (let i = 3; i < d.length && !durchsichtig; i += 4) durchsichtig = d[i]! < 255;
  if (durchsichtig) {
    jimpEinpassen(bild, groesse);
    await fs.promises.writeFile(ziel, await bild.getBuffer('image/png'));
    return;
  }
  const bg = new Jimp({ width: bild.bitmap.width, height: bild.bitmap.height, color: 0xffffffff });
  bg.composite(bild, 0, 0);
  jimpEinpassen(bg, groesse);
  await fs.promises.writeFile(ziel, await bg.getBuffer('image/jpeg', { quality: 80 }));
}

/** Erst sharp, Jimp nur bei einem LADEfehler (native Bibliothek fehlt). Ein
 * defektes Bild soll scheitern und gemerkt werden, nicht zweimal gerechnet. */
async function verkleinern(quelle: string, ziel: string): Promise<void> {
  let sharp: typeof import('sharp') | null = null;
  try {
    sharp = require('sharp');
  } catch (e) {
    // Ausnahme: Ohne native Bibliothek rechnet Jimp; das Bild entsteht trotzdem.
    meldeFehler('vorschau:sharp nicht verfügbar, nutze Jimp', e);
  }

  if (sharp) {
    const eingepasst = () => sharp(quelle).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true });
    // Ein Alphakanal allein heisst nichts (viele PNG sind ganz deckend); erst echte Transparenz bleibt PNG.
    if (!(await sharp(quelle).stats()).isOpaque) {
      await eingepasst().png({ compressionLevel: 9 }).toFile(ziel);
      return;
    }
    // Weisser Grund: Ein Alphakanal würde als JPEG sonst schwarz.
    await eingepasst().flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(ziel);
    return;
  }

  // Erst hier geladen: Jimp ist der Rückfall und wird meist nie gebraucht.
  await jimpVorschau(quelle, ziel, THUMB_SIZE);
}

export async function generateThumb(localPath: string) {
  if (!localPath) return null;

  // /images/… zeigt nach data/images/ (Volume), nicht nach public/.
  const fsPath = resolveWebPath(localPath);
  if (!fsPath) return null;

  if (!fs.existsSync(fsPath)) return null;

  const ext = path.extname(fsPath);
  const thumbFs = fsPath.replace(ext, '_thumb.jpg');
  const thumbWeb = localPath.replace(ext, '_thumb.jpg');

  if (fs.existsSync(thumbFs)) return thumbWeb;

  // Abmessungen vor dem Dekodieren prüfen: Eine kleine, riesig aufgelöste Datei
  // legte den Worker mit einem Gigabyte-Bitmap lahm.
  if (!(await isDecodable(fsPath))) return null;

  try {
    // ATOMAR schreiben: Ein Schreibvorgang auf den endgültigen Namen ist für
    // parallele Anfragen sichtbar, bevor er fertig ist.
    const tmpThumb = `${thumbFs}.${process.pid}.${randomUUID()}.tmp.jpg`;
    await verkleinern(fsPath, tmpThumb);
    await fs.promises.rename(tmpThumb, thumbFs);
    return thumbWeb;
  } catch (e) {
    // NICHT still scheitern.
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
      meldeFehler('vorschau:reste', e);
    }
    return null;
  }
}
