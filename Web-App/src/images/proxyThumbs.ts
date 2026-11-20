import type { Client } from 'pg';
import { fehlertext, reportError } from '../infra/error';
import fs from 'node:fs';
import { rememberMissing, isKnownMissing } from './imageMisses';
import { imgProxyFailures, countProxyError } from './imgProxyStats';
import { readableImage } from './imageGuard';
import { jimpPreview } from './thumbs';
import { LOCKS } from '../infra/lockNamespaces';
import * as sperre from './repository/sessionLock';
import type { ImagesContext } from './context';

// Queue, lock and resizing belong together.

export const PROXY_THUMB_SIZE = 200;

/** Preview images are the most expensive work in the server and occupy the
 * event loop; a request never waits for them, they are created in the background. */
const THUMB_MAX_PARALLEL = 1;
/** Whoever scrolls through quickly does not want these previews; without a cap
 * the server would stubbornly compute half the catalog. */
const THUMB_MAX_QUEUE = 40;
/** Queue and lock connection per set of services; the lock itself applies to the server. */
const stand = (k: ImagesContext) =>
  k.faecher.fach('vorschauen', () => ({
    laufend: 0,
    _thumbQueue: [] as [string, string][],
    _thumbInFlight: new Set<string>(),
    lockClient: null as Client | null,
  }));

export function queueThumb(k: ImagesContext, srcFile: string, thumbFile: string) {
  const { _thumbQueue, _thumbInFlight } = stand(k);
  if (_thumbInFlight.has(thumbFile)) return;
  // Do not repeat failed resizes (webp) on every view.
  if (isKnownMissing(k, 'thumb:' + thumbFile)) return;
  // Full? Discard instead of postponing: the image goes out in full size,
  // the preview comes on the next call.
  if (_thumbQueue.length >= THUMB_MAX_QUEUE) return;
  _thumbInFlight.add(thumbFile);
  _thumbQueue.push([srcFile, thumbFile]);
  drainThumbQueue(k);
}

export function drainThumbQueue(k: ImagesContext) {
  const st = stand(k);
  const { _thumbQueue, _thumbInFlight } = st;
  while (st.laufend < THUMB_MAX_PARALLEL && _thumbQueue.length) {
    const [src, dst] = _thumbQueue.shift()!;
    st.laufend++;
    createProxyPreview(k, src, dst)
      .catch(e => countProxyError('proxy-vorschau:erzeugen', e))
      .finally(() => {
        st.laufend--;
        _thumbInFlight.delete(dst);
        drainThumbQueue(k);
      });
  }
}
/** ONE preview run for the whole server, not per worker process. */
const THUMB_LOCK_KEY = LOCKS.PROXY_THUMBS;

export async function withPreviewLock<T>(k: ImagesContext, work: () => Promise<T>): Promise<T | false> {
  // NOT from the pool: a lock held there took the connection from ordinary
  // requests.
  const st = stand(k);
  if (!st.lockClient) {
    try {
      st.lockClient = await k.db.ownConnection();
    } catch (_) {
      return false;
    }
    st.lockClient.on('error', () => {
      st.lockClient = null;
    });
  }
  const client = st.lockClient;
  try {
    if (!(await sperre.attemptsLock(client, THUMB_LOCK_KEY))) return false; // another process is computing right now
    try {
      return await work();
    } finally {
      // If the lock gets stuck, nobody would compute any more: the connection closes and releases it.
      await sperre.giveLockFree(client, THUMB_LOCK_KEY).catch(e => {
        reportError('proxy-vorschau:pg_advisory_unlock', e);
        st.lockClient = null;
        void client.end().catch(f => reportError('proxy-vorschau:verbindung schliessen', f));
      });
    }
  } catch (_) {
    st.lockClient = null; // Connection broken — rebuild it next time
    return false;
  }
}

export async function createProxyPreview(k: ImagesContext, srcFile: string, thumbFile: string) {
  const p = withPreviewLock(k, async () => {
    try {
      // Dimensions first (imageGuard.ts): the 5 MB limit measures the COMPRESSED
      // size and does not catch a decompression bomb.
      if (!(await readableImage(srcFile))) {
        // Do not even try — and remember that, see queueThumb().
        rememberMissing(k, 'thumb:' + thumbFile);
        return false;
      }
      // Write ATOMICALLY: first next to it, then rename.
      const tmpThumb = `${thumbFile}.${process.pid}.${k.uhr.jetzt()}.tmp.jpg`;
      await jimpPreview(srcFile, tmpThumb, PROXY_THUMB_SIZE);
      await fs.promises.rename(tmpThumb, thumbFile);
      return true;
    } catch (e) {
      // No silent false: a permanently failing generator would stay invisible.
      console.error(`[img-proxy] Vorschau fehlgeschlagen für ${srcFile}: ${fehlertext(e)}`);
      rememberMissing(k, 'thumb:' + thumbFile);
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Vorschau fehlgeschlagen: ${fehlertext(e)}`;
      return false;
    }
  });
  return p;
}
