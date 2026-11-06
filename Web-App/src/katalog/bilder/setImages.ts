import { fehlertext } from '../../infra/fehler';
import { konfig } from '../../infra/konfig';
import path from 'path';
import fs from 'fs';
import { AbrufFehler } from '../../infra/abruf';
import { holeBild, BILD_KOPFZEILEN } from '../quellen';
import { SET_IMAGES_DIR } from '../../infra/appPaths';
import { appVersion } from '../../infra/appVersion';

// Ausführlich: docs/begruendungen/src/katalog/bilder/setImages.ts.md#abschnitt

// Ausführlich: docs/begruendungen/src/katalog/bilder/setImages.ts.md#set-img-max-bytes
export const SET_IMG_MAX_BYTES = 20 * 1024 * 1024;

/** Sauber und eindeutig: Sieht er nach einem Standard-Scraper aus, sperrt Cloudflare.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/setImages.ts.md#bilduseragent */
export function bildUserAgent(): string {
  const eigener = konfig().bildUserAgent;
  if (eigener) return eigener;
  return `BrickInventoryManager/${appVersion()} (self-hosted; +https://github.com/brickinventory)`;
}

export async function downloadSetImage(url: string, setNumber: string, info?: { status?: number }) {
  if (!url) return null;
  try {
    const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
    const localPath = path.join(SET_IMAGES_DIR, `${safe}.jpg`);
    const relPath = `/images/sets/${safe}.jpg`;
    if (await fs.promises.access(localPath).then(() => true, () => false)) return relPath;
    const buf = await holeBild(url, {
      maxBytes: SET_IMG_MAX_BYTES, zeitlimitMs: 30_000,
      kopfzeilen: { ...BILD_KOPFZEILEN, 'User-Agent': bildUserAgent() },
    }).then(r => {
      if (r.status === 200) return r.koerper;
      // „404" und „403 Bot-Erkennung" verlangen verschiedene Massnahmen; ohne
      // echten Code gilt es in jobs/imageQueue.ts als vorübergehend.
      const nichtVorhanden = r.status === 404 || r.status === 410;
      (nichtVorhanden ? console.warn : console.error)(`[set-img] ${setNumber}: HTTP ${r.status} vom Bildserver: ${url}`);
      if (info && r.status) info.status = r.status;
      return null;
    }, (e: unknown) => {
      if (e instanceof AbrufFehler && e.grund === 'zu-gross')
        console.error(`[set-img] ${setNumber}: Bild grösser als ${Math.round(SET_IMG_MAX_BYTES / 1024 / 1024)} MB — nicht lokal gespeichert: ${url}`);
      else console.error(`[set-img] ${setNumber}: Abruf fehlgeschlagen (${e instanceof Error ? e.message : e}): ${url}`);
      return null;
    });
    if (!buf) return null;   // Grund wurde oben bereits genannt
    if (buf.length < 100) {
      // Zu klein für ein Bild — fast immer eine Fehlerseite.
      console.error(`[set-img] ${setNumber}: Antwort zu klein (${buf.length} Bytes) — kein Bild: ${url}`);
      return null;
    }
    await fs.promises.writeFile(localPath, buf);
    return relPath;
  } catch (e) {
    // Letzte Auffanglinie, aber mit Spur: Stille hat die Fehlersuche bei Bildern
    // zuvor über Tage gestreckt.
    console.error(`[set-img] ${setNumber}: Download fehlgeschlagen: ${fehlertext(e)}`);
    return null;
  }
}

