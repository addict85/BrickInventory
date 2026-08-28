import path from 'path';
import fs from 'fs';
import https from 'https';
import { SET_IMAGES_DIR } from './appPaths';
import { appVersion } from './appVersion';

/**
 * Set-Bilder vom CDN holen und lokal ablegen.
 *
 * ── Warum diese Funktion nicht mehr in routes/sets.ts steht (Nachtrag 125) ──
 *
 * Sie hat zwanzig Aufrufer — Routen, Jobs, den Katalog — und KEINER davon
 * konnte sie importieren: `routes/sets.ts` ist ein Router, und wer ihn
 * importiert, schliesst einen Kreis (sets → parts → sets, sets → minifigs →
 * sets, imageQueue → sets → …). Alle zwanzig holten sie deshalb per spätem
 * `require()` aus dem Funktionsrumpf.
 *
 * Der Preis dafür war nicht theoretisch: `require()` liefert `any`, also prüft
 * TypeScript den NAMEN nicht. Genau daran hingen die beiden 500er aus Nachtrag
 * 131 — ein `require()` holte einen Namen, den es nicht gab, und der TypeError
 * flog synchron an jedem `.catch()` vorbei.
 *
 * Als eigenes Modul ohne Rückbezug ist sie ein Blatt im Abhängigkeitsbaum:
 * `import` funktioniert, tsc prüft mit.
 */

/**
 * Obergrenze für das LOKAL gespeicherte Set-Bild.
 *
 * ── Warum 20 statt 5 MB (Nachtrag 47, Marcos Fund) ─────────────────────────
 * Dieselbe Zahl wie im Bild-Proxy (PROXY_CACHE_MAX_BYTES, routes/imgProxy.ts)
 * — und aus demselben Grund. Nachtrag 43 hatte nur die PROXY-Grenze angehoben;
 * DIESE hier blieb bei 5 MB stehen, und damit blieb Marcos Set weiter ohne
 * lokales Bild:
 *
 *   • downloadSetImage() bricht über der Grenze ab und liefert null
 *   • damit bleibt sets.image_local leer
 *   • generateThumb() arbeitet auf der lokalen Datei — ohne sie keine Vorschau
 *   • also holen beide Clients das Bild weiterhin über /api/img-proxy
 *
 * Genau das war zu beobachten: „Das Bild wird nach wie vor nicht auf dem
 * Server gespeichert und auch kein Thumbs-Image erstellt." Rebrickable liefert
 * für neuere Sets hochauflösende Bilder (das gemeldete wog 5'243 kB).
 *
 * Beide Grenzen zusammen anheben — sonst repariert man den einen Weg und der
 * andere fällt weiterhin heraus.
 */
const SET_IMG_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Der Ausweis, mit dem wir uns beim Bildserver melden.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Nutze einen sauberen, eindeutigen User-Agent-Header. Fehlt der Header oder
 * sieht er nach Standard-Scrapern aus, schlägt die Cloudflare-Heuristik
 * deutlich schneller an."
 *
 * Hier stand bisher eine vorgetäuschte Chrome-Kennung. Das ist die schlechteste
 * aller Möglichkeiten: Sie sagt nicht, wer wir sind, und ein Browser, der
 * tausende Bilder ohne die üblichen Begleitanfragen holt, fällt einer Heuristik
 * gerade dadurch auf. Eine ehrliche Produktkennung mit Version ist üblich, gut
 * erkennbar — und wenn jemand beim Betreiber nachfragen will, weiss er wen.
 *
 * ── Warum über eine Umgebungsvariable ───────────────────────────────────────
 * Ich kann von hier aus nicht ausprobieren, wie der echte Bildserver auf die
 * neue Kennung reagiert. Sollte er ausgerechnet Produktkennungen abweisen,
 * lässt sich mit IMG_USER_AGENT umschalten, ohne neu zu bauen.
 */
function bildUserAgent(): string {
  const { appVersion } = require('../utils/appVersion');
  if (process.env.IMG_USER_AGENT) return process.env.IMG_USER_AGENT;
  return `BrickInventoryManager/${appVersion()} (self-hosted; +https://github.com/brickinventory)`;
}

async function downloadSetImage(url, setNumber, info?: { status?: number }) {
  if (!url) return null;
  try {
    const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
    const localPath = path.join(SET_IMAGES_DIR, `${safe}.jpg`);
    const relPath = `/images/sets/${safe}.jpg`;
    if (await fs.promises.access(localPath).then(() => true, () => false)) return relPath;
    const buf = await new Promise<Buffer | null>(resolve => {
      const tryGet = (u, rest) => {
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
            // Statuscode nennen (Nachtrag 50): „404 vom CDN" und „403 wegen
            // Bot-Erkennung" verlangen völlig verschiedene Massnahmen —
            // vorher waren beide dasselbe schweigende null.
            console.error(`[set-img] ${setNumber}: HTTP ${res.statusCode} vom Bildserver: ${url}`);
            if (info) info.status = res.statusCode;
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
