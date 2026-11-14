import type { Konfig } from '../infra/konfig';
import path from 'node:path';
import fs from 'node:fs';
import { AbrufFehler } from '../infra/abruf';
import { holeBild, BILD_KOPFZEILEN } from '../fremdquellen';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { mitVersion } from '../infra/setNummer';

// Set-Bilder vom CDN holen; hier statt im Router, damit die Aufrufer echt importieren.

// Wie im Bild-Proxy; mit 5 MB blieben grosse Set-Bilder ohne lokale Datei.
export const SET_IMG_MAX_BYTES = 20 * 1024 * 1024;

/** Dieselbe Browser-Kennung wie der Bild-Proxy: Eine eigene weist das CDN mit 403 ab,
 * und der Bild-Auftrag pausierte dann endlos. IMG_USER_AGENT bleibt als Ausweg. */
export function bildUserAgent(k: Pick<Konfig, 'bildUserAgent'>): string {
  return k.bildUserAgent || String(BILD_KOPFZEILEN['User-Agent']);
}

/** Nur Rebrickable-Bilder legt der Proxy samt Vorschau unter images/sets ab. */
export function rebrickableSetBild(setNumber: string): string {
  return `https://cdn.rebrickable.com/media/sets/${encodeURIComponent(mitVersion(setNumber))}.jpg`;
}

/** Liegen Bild und Vorschau schon in images/sets, braucht der Bild-Job nichts mehr. */
export async function setBildVollstaendig(setNumber: string): Promise<boolean> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  const da = (datei: string) =>
    fs.promises.access(path.join(SET_IMAGES_DIR, datei)).then(
      () => true,
      () => false,
    );
  return (await da(`${safe}.jpg`)) && (await da(`${safe}_thumb.jpg`));
}

export async function setBildHerunterladen(
  url: string,
  setNumber: string,
  info?: { status?: number },
  userAgent = String(BILD_KOPFZEILEN['User-Agent']),
) {
  if (!url) return null;
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  const localPath = path.join(SET_IMAGES_DIR, `${safe}.jpg`);
  const relPath = `/images/sets/${safe}.jpg`;
  if (
    await fs.promises.access(localPath).then(
      () => true,
      () => false,
    )
  )
    return relPath;
  const buf = await holeBild(url, {
    maxBytes: SET_IMG_MAX_BYTES,
    zeitlimitMs: 30_000,
    kopfzeilen: { ...BILD_KOPFZEILEN, 'User-Agent': userAgent },
  }).then(
    r => {
      if (r.status === 200) return r.koerper;
      // „404" und „403 Bot-Erkennung" verlangen verschiedene Massnahmen; ohne
      // echten Code gilt es in src/bilder/bildbedarfLauf.ts als vorübergehend.
      const nichtVorhanden = r.status === 404 || r.status === 410;
      (nichtVorhanden ? console.warn : console.error)(
        `[set-img] ${setNumber}: HTTP ${r.status} vom Bildserver: ${url}`,
      );
      if (info && r.status) info.status = r.status;
      return null;
    },
    (e: unknown) => {
      if (e instanceof AbrufFehler && e.grund === 'zu-gross')
        console.error(
          `[set-img] ${setNumber}: Bild grösser als ${Math.round(SET_IMG_MAX_BYTES / 1024 / 1024)} MB — nicht lokal gespeichert: ${url}`,
        );
      else
        console.error(
          `[set-img] ${setNumber}: Abruf fehlgeschlagen (${e instanceof Error ? e.message : e}): ${url}`
            .replace(/\r?\n/g, ' ⏎ ')
            .replace(/\n|\r/g, ''),
        );
      return null;
    },
  );
  if (!buf) return null; // Grund wurde oben bereits genannt
  if (buf.length < 100) {
    // Zu klein für ein Bild — fast immer eine Fehlerseite.
    console.error(`[set-img] ${setNumber}: Antwort zu klein (${buf.length} Bytes) — kein Bild: ${url}`);
    return null;
  }
  // Erst fertig, dann sichtbar: Der Bild-Proxy liefert sonst eine halbe Datei aus.
  const teil = `${localPath}.${process.pid}.teil`;
  // Auf einer frischen Installation fehlt der Ordner noch.
  await fs.promises.mkdir(SET_IMAGES_DIR, { recursive: true });
  await fs.promises.writeFile(teil, buf);
  await fs.promises.rename(teil, localPath);
  return relPath;
}
