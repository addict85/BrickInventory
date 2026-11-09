import { fehlertext } from '../../infra/fehler';
import { konfig } from '../../infra/konfig';
import path from 'path';
import fs from 'fs';
import { AbrufFehler } from '../../infra/abruf';
import { holeBild, BILD_KOPFZEILEN } from '../quellen';
import { SET_IMAGES_DIR } from '../../infra/appPaths';
import { appVersion } from '../../infra/appVersion';
import { mitVersion } from '../../infra/setNummer';

// Set-Bilder vom CDN holen; hier statt im Router, damit die Aufrufer echt importieren.
// Ausführlich: docs/begruendungen/src/katalog/bilder/setImages.ts.md#abschnitt

// Wie im Bild-Proxy; mit 5 MB blieben grosse Set-Bilder ohne lokale Datei.
// Ausführlich: docs/begruendungen/src/katalog/bilder/setImages.ts.md#set-img-max-bytes
export const SET_IMG_MAX_BYTES = 20 * 1024 * 1024;

/** Sauber und eindeutig: Sieht er nach einem Standard-Scraper aus, sperrt Cloudflare.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/setImages.ts.md#bilduseragent */
export function bildUserAgent(): string {
  const eigener = konfig().bildUserAgent;
  if (eigener) return eigener;
  return `BrickInventoryManager/${appVersion()} (self-hosted; +https://github.com/brickinventory)`;
}

/** Nur Rebrickable-Bilder legt der Proxy samt Vorschau unter images/sets ab. */
export function rebrickableSetBild(setNumber: string): string {
  return `https://cdn.rebrickable.com/media/sets/${encodeURIComponent(mitVersion(setNumber))}.jpg`;
}

/** Liegen Bild und Vorschau schon in images/sets, braucht der Bild-Job nichts mehr. */
export async function setBildVollstaendig(setNumber: string): Promise<boolean> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  const da = (datei: string) => fs.promises.access(path.join(SET_IMAGES_DIR, datei)).then(() => true, () => false);
  return (await da(`${safe}.jpg`)) && (await da(`${safe}_thumb.jpg`));
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
      else console.error(`[set-img] ${setNumber}: Abruf fehlgeschlagen (${e instanceof Error ? e.message : e}): ${url}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return null;
    });
    if (!buf) return null;   // Grund wurde oben bereits genannt
    if (buf.length < 100) {
      // Zu klein für ein Bild — fast immer eine Fehlerseite.
      console.error(`[set-img] ${setNumber}: Antwort zu klein (${buf.length} Bytes) — kein Bild: ${url}`);
      return null;
    }
    // Erst fertig, dann sichtbar: Der Bild-Proxy liefert sonst eine halbe Datei aus.
    const teil = `${localPath}.${process.pid}.teil`;
    await fs.promises.writeFile(teil, buf);
    await fs.promises.rename(teil, localPath);
    return relPath;
  } catch (e) {
    // Letzte Auffanglinie, aber mit Spur: Stille hat die Fehlersuche bei Bildern
    // zuvor über Tage gestreckt.
    console.error(`[set-img] ${setNumber}: Download fehlgeschlagen: ${fehlertext(e)}`);
    return null;
  }
}

