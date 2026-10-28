import fs from 'fs';
import { merkeFehlend } from './imageMisses';
import { imgProxyFailures } from './imgProxyStats';
import { istBekanntFehlend } from '../utils/imageMisses';
import { isDecodable } from '../utils/imageGuard';

/**
 * Die Vorschau-Maschinerie des Bild-Proxys.
 * Ausführlich: docs/begruendungen/utils/proxyThumbs.ts.md#proxy-thumb-size
 */

/** Grösse der erzeugten Vorschau in Pixeln (Kantenlänge). */
const PROXY_THUMB_SIZE = 200;

// Jimp braucht gemessen rund 150 ms je Bild und belegt dabei den Event-Loop.
// Eine Kachelwand mit 60 Minifiguren ergäbe neun Sekunden, in denen der Server
// für ALLE Anfragen steht. Deshalb: höchstens zwei gleichzeitig, und niemals
// wartet eine Anfrage darauf — die Verkleinerung entsteht im Hintergrund und
// steht ab dem nächsten Aufruf bereit.
/**
 * Vorschaubilder sind die teuerste Arbeit im ganzen Server
 * Jimp ist reines JavaScript: Ein JPEG zu entpacken und zu verkleinern kostet
 * auf schwacher Hardware
 * spürbar Zeit. Der Server läuft ausserdem im CLUSTER — die Grenze unten gilt …
 * Ausführlich: docs/begruendungen/utils/proxyThumbs.ts.md#thumb-max-parallel
 */
const THUMB_MAX_PARALLEL = 1;
/**
 * Und eine Obergrenze für die Warteschlange — dieselbe Überlegung wie bei den
 * Katalog-Bildern: Wer schnell durchscrollt, WILL diese
 * Vorschauen nicht, er kommt nur vorbei. Ohne Deckel staute sich der halbe
 * Katalog auf, und der Server rechnete ihn stur ab.
 */
const THUMB_MAX_QUEUE = 40;
let _thumbRunning = 0;
const _thumbQueue: any[] = [];

function queueThumb(srcFile: string, thumbFile: string) {
  if (_thumbInFlight.has(thumbFile)) return;
  // Gescheiterte Verkleinerungen nicht endlos wiederholen
  // Jimp kann webp nicht entpacken. Scheitert der Versuch, entsteht keine
  // Datei — und beim nächsten Aufruf desselben Bildes wurde er wiederholt.
  // Für jedes webp-Bild also bei JEDEM Ansehen ein vergeblicher Anlauf, der …
  // Ausführlich: docs/begruendungen/utils/proxyThumbs.ts.md#queuethumb
  if (istBekanntFehlend('thumb:' + thumbFile)) return;
  // Voll? Dann verwerfen statt aufschieben. Das Bild wird trotzdem
  // ausgeliefert (in voller Grösse), und wer wirklich stehen bleibt, bekommt
  // die Vorschau beim nächsten Aufruf.
  if (_thumbQueue.length >= THUMB_MAX_QUEUE) return;
  _thumbInFlight.set(thumbFile, true);
  _thumbQueue.push([srcFile, thumbFile]);
  drainThumbQueue();
}

function drainThumbQueue() {
  while (_thumbRunning < THUMB_MAX_PARALLEL && _thumbQueue.length) {
    const [src, dst] = _thumbQueue.shift();
    _thumbRunning++;
    makeProxyThumb(src, dst)
      .catch(() => {})
      .finally(() => { _thumbRunning--; _thumbInFlight.delete(dst); drainThumbQueue(); });
  }
}
let _thumbInFlight = new Map();
/**
 * EIN Vorschau-Lauf für den GANZEN Server — nicht je Arbeitsprozess.
 * Ausführlich: docs/begruendungen/utils/proxyThumbs.ts.md#abschnitt
 */
const { LOCKS } = require('./lockNamespaces');
const THUMB_LOCK_KEY = LOCKS.PROXY_THUMBS;

/** Die Sperr-Verbindung. EINMAL aufgebaut, dann wiederverwendet. */
let _sperrClient: any = null;

async function mitVorschauSperre(arbeit: () => Promise<any>) {
  const db = require('../db/database');
  // NICHT aus dem Pool
  // Nicht die Bildarbeit scheiterte, sondern eine gewöhnliche Anfrage bekam
  // keine Verbindung mehr. Dasselbe Muster — nur dass
  // ich es diesmal selbst hineingebaut habe, bei einer früheren Behebung.
  // Ausführlich: docs/begruendungen/utils/proxyThumbs.ts.md#mitvorschausperre
  if (!_sperrClient) {
    try { _sperrClient = await db.eigeneVerbindung(); }
    catch (_) { return false; }
    _sperrClient.on('error', () => { _sperrClient = null; });
  }
  const client = _sperrClient;
  try {
    const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [THUMB_LOCK_KEY]);
    if (!r.rows[0]?.ok) return false;   // ein anderer Prozess rechnet gerade
    try { return await arbeit(); }
    finally { await client.query('SELECT pg_advisory_unlock($1)', [THUMB_LOCK_KEY]).catch(() => {}); }
  } catch (_) {
    _sperrClient = null;   // Verbindung hin — beim nächsten Mal neu aufbauen
    return false;
  }
}

async function makeProxyThumb(srcFile: string, thumbFile: string) {
  // Die Entdopplung liegt jetzt in queueThumb(); hier nur noch die Arbeit.
  const p = mitVorschauSperre(async () => {
    try {
      // Abmessungen zuerst — siehe utils/imageGuard.ts. Der Proxy holt Dateien
      // von fremden Servern; die 5-MB-Grenze weiter unten misst die
      // KOMPRIMIERTE Grösse und fängt eine Dekompressionsbombe nicht ab.
      if (!(await isDecodable(srcFile))) {
        // Gar nicht erst versuchen — und das merken, siehe queueThumb().
        merkeFehlend('thumb:' + thumbFile);
        return false;
      }
      // Jimp 1.x — geänderte API, siehe ausführlichen Hinweis in utils/thumbs.ts.
      const { Jimp } = require('jimp');
      const img  = await Jimp.read(srcFile);
      const bg   = new Jimp({ width: img.bitmap.width, height: img.bitmap.height, color: 0xffffffff });
      bg.composite(img, 0, 0);
      bg.cover({ w: PROXY_THUMB_SIZE, h: PROXY_THUMB_SIZE });
      // ATOMAR schreiben: erst daneben, dann umbenennen.
      // Ausführlich: docs/begruendungen/utils/proxyThumbs.ts.md#makeproxythumb-tmpthumb
  const tmpThumb = `${thumbFile}.${process.pid}.${Date.now()}.tmp.jpg`;
      await bg.write(tmpThumb as `${string}.${string}`, { quality: 80 });
      await fs.promises.rename(tmpThumb, thumbFile);
      return true;
    } catch (e: any) {
      // Wie in utils/thumbs.ts: kein stilles false mehr — ein
      // dauerhaft scheiternder Erzeuger blieb sonst unsichtbar.
      console.error(`[img-proxy] Vorschau fehlgeschlagen für ${srcFile}: ${e?.message || e}`);
      merkeFehlend('thumb:' + thumbFile);
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Vorschau fehlgeschlagen: ${e?.message || e}`;
      return false;
    }

  });
  return p;
}

export { queueThumb, drainThumbQueue, mitVorschauSperre, makeProxyThumb, PROXY_THUMB_SIZE };
