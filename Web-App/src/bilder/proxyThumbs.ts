import type { Client } from 'pg';
import { fehlertext, meldeFehler } from '../infra/fehler';
import fs from 'node:fs';
import { merkeFehlend, istBekanntFehlend } from './imageMisses';
import { imgProxyFailures, zaehleProxyFehler } from './imgProxyStats';
import { isDecodable } from './imageGuard';
import { LOCKS } from '../infra/lockNamespaces';
import * as sperre from './repository/sitzungsSperre';
import type { BilderKontext } from './kontext';

// Warteschlange, Sperre und Verkleinern gehören zusammen.

export const PROXY_THUMB_SIZE = 200;

/** Vorschaubilder sind die teuerste Arbeit im Server und belegen den
 * Event-Loop; nie wartet eine Anfrage darauf, sie entstehen im Hintergrund. */
const THUMB_MAX_PARALLEL = 1;
/** Wer schnell durchscrollt, will diese Vorschauen nicht; ohne Deckel rechnete
 * der Server den halben Katalog stur ab. */
const THUMB_MAX_QUEUE = 40;
/** Warteschlange und Sperrverbindung je Satz Dienste; die Sperre selbst gilt dem Server. */
const stand = (k: BilderKontext) =>
  k.faecher.fach('vorschauen', () => ({
    laufend: 0,
    _thumbQueue: [] as [string, string][],
    _thumbInFlight: new Set<string>(),
    sperrClient: null as Client | null,
  }));

export function queueThumb(k: BilderKontext, srcFile: string, thumbFile: string) {
  const { _thumbQueue, _thumbInFlight } = stand(k);
  if (_thumbInFlight.has(thumbFile)) return;
  // Gescheiterte Verkleinerungen (webp) nicht bei jedem Ansehen wiederholen.
  if (istBekanntFehlend(k, 'thumb:' + thumbFile)) return;
  // Voll? Verwerfen statt aufschieben: Das Bild geht in voller Grösse hinaus,
  // die Vorschau kommt beim nächsten Aufruf.
  if (_thumbQueue.length >= THUMB_MAX_QUEUE) return;
  _thumbInFlight.add(thumbFile);
  _thumbQueue.push([srcFile, thumbFile]);
  drainThumbQueue(k);
}

export function drainThumbQueue(k: BilderKontext) {
  const st = stand(k);
  const { _thumbQueue, _thumbInFlight } = st;
  while (st.laufend < THUMB_MAX_PARALLEL && _thumbQueue.length) {
    const [src, dst] = _thumbQueue.shift()!;
    st.laufend++;
    makeProxyThumb(k, src, dst)
      .catch(e => zaehleProxyFehler('proxy-vorschau:erzeugen', e))
      .finally(() => {
        st.laufend--;
        _thumbInFlight.delete(dst);
        drainThumbQueue(k);
      });
  }
}
/** EIN Vorschau-Lauf für den ganzen Server, nicht je Arbeitsprozess. */
const THUMB_LOCK_KEY = LOCKS.PROXY_THUMBS;

export async function mitVorschauSperre<T>(k: BilderKontext, arbeit: () => Promise<T>): Promise<T | false> {
  // NICHT aus dem Pool: Eine dort gehaltene Sperre nahm gewöhnlichen Anfragen
  // die Verbindung. EINMAL aufgebaut, dann wiederverwendet.
  const st = stand(k);
  if (!st.sperrClient) {
    try {
      st.sperrClient = await k.db.eigeneVerbindung();
    } catch (_) {
      return false;
    }
    st.sperrClient.on('error', () => {
      st.sperrClient = null;
    });
  }
  const client = st.sperrClient;
  try {
    if (!(await sperre.versucheSperre(client, THUMB_LOCK_KEY))) return false; // ein anderer Prozess rechnet gerade
    try {
      return await arbeit();
    } finally {
      // Bleibt die Sperre hängen, rechnete keiner mehr: Die Verbindung geht zu und gibt sie frei.
      await sperre.gibSperreFrei(client, THUMB_LOCK_KEY).catch(e => {
        meldeFehler('proxy-vorschau:pg_advisory_unlock', e);
        st.sperrClient = null;
        void client.end().catch(f => meldeFehler('proxy-vorschau:verbindung schliessen', f));
      });
    }
  } catch (_) {
    st.sperrClient = null; // Verbindung hin — beim nächsten Mal neu aufbauen
    return false;
  }
}

export async function makeProxyThumb(k: BilderKontext, srcFile: string, thumbFile: string) {
  const p = mitVorschauSperre(k, async () => {
    try {
      // Abmessungen zuerst (imageGuard.ts): Die 5-MB-Grenze misst die KOMPRIMIERTE
      // Grösse und fängt eine Dekompressionsbombe nicht ab.
      if (!(await isDecodable(srcFile))) {
        // Gar nicht erst versuchen — und das merken, siehe queueThumb().
        merkeFehlend(k, 'thumb:' + thumbFile);
        return false;
      }
      // Erst hier geladen: Jimp ist schwer und nur der Rückfall ohne sharp.
      const { Jimp } = require('jimp');
      const img = await Jimp.read(srcFile);
      const bg = new Jimp({ width: img.bitmap.width, height: img.bitmap.height, color: 0xffffffff });
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
      merkeFehlend(k, 'thumb:' + thumbFile);
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Vorschau fehlgeschlagen: ${fehlertext(e)}`;
      return false;
    }
  });
  return p;
}
