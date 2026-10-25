import path from 'path';
import fs from 'fs';
import https from 'https';
import { SET_IMAGES_DIR } from './appPaths';

/**
 * Set-Bilder vom CDN holen und lokal ablegen.
 * Ausführlich: docs/begruendungen/utils/setImages.ts.md#abschnitt
 */

/**
 * Obergrenze für das LOKAL gespeicherte Set-Bild.
 * Ausführlich: docs/begruendungen/utils/setImages.ts.md#set-img-max-bytes
 */
const SET_IMG_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Der Ausweis, mit dem wir uns beim Bildserver melden.
 * Ausführlich: docs/begruendungen/utils/setImages.ts.md#bilduseragent
 */
function bildUserAgent(): string {
  const { appVersion } = require('../utils/appVersion');
  if (process.env.IMG_USER_AGENT) return process.env.IMG_USER_AGENT;
  return `BrickInventoryManager/${appVersion()} (self-hosted; +https://github.com/brickinventory)`;
}

async function downloadSetImage(url: string, setNumber: string, info?: { status?: number }) {
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
            // Statuscode nennen: „404 vom CDN" und „403 wegen
            // Bot-Erkennung" verlangen völlig verschiedene Massnahmen —
            // vorher waren beide dasselbe schweigende null.
            // Ausführlich: docs/begruendungen/utils/setImages.ts.md#downloadsetimage-nichtvorhanden
            const nichtVorhanden = res.statusCode === 404 || res.statusCode === 410;
            (nichtVorhanden ? console.warn : console.error)(
              `[set-img] ${setNumber}: HTTP ${res.statusCode} vom Bildserver: ${url}`);
            // Nur zuweisen, wenn es wirklich einen Code gibt: jobs/imageQueue.ts
            // unterscheidet „HTTP 404" von „kein Statuscode — voruebergehend?"
            // (Zeile 573). Ein zugewiesenes undefined machte beide gleich.
            if (info && res.statusCode != null) info.status = res.statusCode;
            res.resume(); return resolve(null);
          }
          const chunks: any[] = []; let gelesen = 0;
          res.on('data', d => {
            gelesen += d.length;
            if (gelesen > SET_IMG_MAX_BYTES) {
              // Nicht mehr STILL abbrechen (Nachtrag 47): Vorher verschwand ein
              // übergrosses Bild spurlos — kein Log, keine Spur, und niemand
              // konnte erklären, warum ausgerechnet dieses Set kein lokales
              // Bild bekam.
              console.error(`[set-img] ${setNumber}: Bild grösser als ${Math.round(SET_IMG_MAX_BYTES / 1024 / 1024)} MB — nicht lokal gespeichert: ${url}`);
              res.destroy(); return resolve(null);
            }
            chunks.push(d);
          });
          res.on('end',()=>resolve(Buffer.concat(chunks)));
        }).on('error', (e: any) => {
          // Netzwerkfehler waren bisher komplett unsichtbar: Zeitüberschreitung,
          // DNS, abgebrochene Verbindung — alles endete in einem stummen null,
          // und das Set stand ohne Bild da, ohne dass irgendetwas davon
          // berichtete.
          console.error(`[set-img] ${setNumber}: Netzwerkfehler (${e?.code || e?.message}): ${url}`);
          resolve(null);
        });
      };
      tryGet(url, 5);
    });
    if (!buf) return null;   // Grund wurde oben bereits genannt
    if (buf.length < 100) {
      // Eine so kleine Antwort ist kein Bild, sondern fast immer eine
      // Fehlerseite. Ohne Meldung sah es aus wie „Download lief, Bild fehlt
      // trotzdem".
      console.error(`[set-img] ${setNumber}: Antwort zu klein (${buf.length} Bytes) — kein Bild: ${url}`);
      return null;
    }
    await fs.promises.writeFile(localPath, buf);
    return relPath;
  } catch (e: any) {
    // Letzte Auffanglinie — bis Nachtrag 50 verschluckte sie JEDEN Fehler
    // (Schreibfehler, volle Platte, Rechteproblem) ohne eine Spur. Genau diese
    // Sorte Stille hat die Bild-Fehlersuche dieser Woche über fünf Nachträge
    // gestreckt.
    console.error(`[set-img] ${setNumber}: Download fehlgeschlagen: ${e?.message || e}`);
    return null;
  }
}

export { downloadSetImage, bildUserAgent, SET_IMG_MAX_BYTES };
