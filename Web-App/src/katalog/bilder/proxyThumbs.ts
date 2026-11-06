import { logAndContinue, fehlertext } from '../../infra/fehler';
import fs from 'fs';
import { merkeFehlend, istBekanntFehlend } from './imageMisses';
import { imgProxyFailures } from './imgProxyStats';
import { isDecodable } from './imageGuard';
import * as db from '../../../db/database';
import { LOCKS } from '../../infra/lockNamespaces';
import * as sperre from '../repository/sitzungsSperre';

// Ausführlich: docs/begruendungen/src/katalog/bilder/proxyThumbs.ts.md#proxy-thumb-size

export const PROXY_THUMB_SIZE = 200;

/** Vorschaubilder sind die teuerste Arbeit im Server und belegen den
 * Event-Loop; nie wartet eine Anfrage darauf, sie entstehen im Hintergrund.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/proxyThumbs.ts.md#thumb-max-parallel */
const THUMB_MAX_PARALLEL = 1;
/** Wer schnell durchscrollt, will diese Vorschauen nicht; ohne Deckel rechnete
 * der Server den halben Katalog stur ab. */
const THUMB_MAX_QUEUE = 40;
let _thumbRunning = 0;
const _thumbQueue: [string, string][] = [];

export function queueThumb(srcFile: string, thumbFile: string) {
  if (_thumbInFlight.has(thumbFile)) return;
  // Gescheiterte Verkleinerungen (webp) nicht bei jedem Ansehen wiederholen.
  if (istBekanntFehlend('thumb:' + thumbFile)) return;
  // Voll? Verwerfen statt aufschieben: Das Bild geht in voller Grösse hinaus,
  // die Vorschau kommt beim nächsten Aufruf.
  if (_thumbQueue.length >= THUMB_MAX_QUEUE) return;
  _thumbInFlight.set(thumbFile, true);
  _thumbQueue.push([srcFile, thumbFile]);
  drainThumbQueue();
}

export function drainThumbQueue() {
  while (_thumbRunning < THUMB_MAX_PARALLEL && _thumbQueue.length) {
    const [src, dst] = _thumbQueue.shift()!;
    _thumbRunning++;
    makeProxyThumb(src, dst)
      .catch(logAndContinue('proxy-vorschau:erzeugen'))
      .finally(() => { _thumbRunning--; _thumbInFlight.delete(dst); drainThumbQueue(); });
  }
}
let _thumbInFlight = new Map<string, boolean>();
/** EIN Vorschau-Lauf für den ganzen Server, nicht je Arbeitsprozess.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/proxyThumbs.ts.md#abschnitt */
const THUMB_LOCK_KEY = LOCKS.PROXY_THUMBS;

/** EINMAL aufgebaut, dann wiederverwendet. */
let _sperrClient: Awaited<ReturnType<typeof db.eigeneVerbindung>> | null = null;

export async function mitVorschauSperre<T>(arbeit: () => Promise<T>): Promise<T | false> {
    // NICHT aus dem Pool: Eine dort gehaltene Sperre nahm gewöhnlichen Anfragen
    // die Verbindung.
  if (!_sperrClient) {
    try { _sperrClient = await db.eigeneVerbindung(); }
    catch (_) { return false; }
    _sperrClient.on('error', () => { _sperrClient = null; });
  }
  const client = _sperrClient;
  try {
    if (!await sperre.versucheSperre(client, THUMB_LOCK_KEY)) return false;   // ein anderer Prozess rechnet gerade
    try { return await arbeit(); }
    finally { await sperre.gibSperreFrei(client, THUMB_LOCK_KEY).catch(logAndContinue('proxy-vorschau:pg_advisory_unlock')); }
  } catch (_) {
    _sperrClient = null;   // Verbindung hin — beim nächsten Mal neu aufbauen
    return false;
  }
}

export async function makeProxyThumb(srcFile: string, thumbFile: string) {
  const p = mitVorschauSperre(async () => {
    try {
      // Abmessungen zuerst (imageGuard.ts): Die 5-MB-Grenze misst die KOMPRIMIERTE
      // Grösse und fängt eine Dekompressionsbombe nicht ab.
      if (!(await isDecodable(srcFile))) {
        // Gar nicht erst versuchen — und das merken, siehe queueThumb().
        merkeFehlend('thumb:' + thumbFile);
        return false;
      }
      // Erst hier geladen: Jimp ist schwer und nur der Rückfall ohne sharp.
      const { Jimp } = require('jimp');
      const img  = await Jimp.read(srcFile);
      const bg   = new Jimp({ width: img.bitmap.width, height: img.bitmap.height, color: 0xffffffff });
      bg.composite(img, 0, 0);
      bg.cover({ w: PROXY_THUMB_SIZE, h: PROXY_THUMB_SIZE });
      // ATOMAR schreiben: erst daneben, dann umbenennen.
  const tmpThumb = `${thumbFile}.${process.pid}.${Date.now()}.tmp.jpg`;
      await bg.write(tmpThumb as `${string}.${string}`, { quality: 80 });
      await fs.promises.rename(tmpThumb, thumbFile);
      return true;
    } catch (e) {
      // Kein stilles false: Ein dauerhaft scheiternder Erzeuger bliebe unsichtbar.
      console.error(`[img-proxy] Vorschau fehlgeschlagen für ${srcFile}: ${fehlertext(e)}`);
      merkeFehlend('thumb:' + thumbFile);
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Vorschau fehlgeschlagen: ${fehlertext(e)}`;
      return false;
    }

  });
  return p;
}

