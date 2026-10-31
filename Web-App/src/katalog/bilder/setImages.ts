import { konfig } from '../../infra/konfig';
import path from 'path';
import fs from 'fs';
import https from 'https';
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
    const buf = await new Promise<Buffer | null>(resolve => {
      const tryGet = (u: string, rest: number) => {
        https.get(u, { timeout:10000, family: 4, headers:{
          'User-Agent': bildUserAgent(),
          'Referer':    'https://rebrickable.com/',
          'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        } }, res => {
          if ((res.statusCode===301||res.statusCode===302) && res.headers.location) {
            res.resume();  // Antwortstrom verwerfen, sonst bleibt die Verbindung offen
            if (rest <= 0) { console.log(`[set-img] ${setNumber}: zu viele Weiterleitungen`); return resolve(null); }
            return tryGet(res.headers.location, rest - 1);
          }
          if (res.statusCode !== 200) {
            // Den Statuscode nennen: „404" und „403 Bot-Erkennung" verlangen völlig
            // verschiedene Massnahmen.
            const nichtVorhanden = res.statusCode === 404 || res.statusCode === 410;
            (nichtVorhanden ? console.warn : console.error)(
              `[set-img] ${setNumber}: HTTP ${res.statusCode} vom Bildserver: ${url}`);
            // Nur mit echtem Code zuweisen: jobs/imageQueue.ts unterscheidet „404" von
            // „kein Statuscode — vorübergehend".
            if (info && res.statusCode != null) info.status = res.statusCode;
            res.resume(); return resolve(null);
          }
          const chunks: any[] = []; let gelesen = 0;
          res.on('data', d => {
            gelesen += d.length;
            if (gelesen > SET_IMG_MAX_BYTES) {
              // Nicht still: Ein übergrosses Bild verschwände sonst spurlos.
              console.error(`[set-img] ${setNumber}: Bild grösser als ${Math.round(SET_IMG_MAX_BYTES / 1024 / 1024)} MB — nicht lokal gespeichert: ${url}`);
              res.destroy(); return resolve(null);
            }
            chunks.push(d);
          });
          res.on('end',()=>resolve(Buffer.concat(chunks)));
        }).on('error', (e: any) => {
          // Netzwerkfehler melden, sonst stünde das Set ohne Bild da und niemand wüsste,
          // warum.
          console.error(`[set-img] ${setNumber}: Netzwerkfehler (${e?.code || e?.message}): ${url}`);
          resolve(null);
        });
      };
      tryGet(url, 5);
    });
    if (!buf) return null;   // Grund wurde oben bereits genannt
    if (buf.length < 100) {
      // Zu klein für ein Bild — fast immer eine Fehlerseite.
      console.error(`[set-img] ${setNumber}: Antwort zu klein (${buf.length} Bytes) — kein Bild: ${url}`);
      return null;
    }
    await fs.promises.writeFile(localPath, buf);
    return relPath;
  } catch (e: any) {
    // Letzte Auffanglinie, aber mit Spur: Stille hat die Fehlersuche bei Bildern
    // zuvor über Tage gestreckt.
    console.error(`[set-img] ${setNumber}: Download fehlgeschlagen: ${e?.message || e}`);
    return null;
  }
}

