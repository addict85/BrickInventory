import fs from 'node:fs';
import { queueThumb } from './proxyThumbs';
import { previewType } from './thumbs';
import { beforeThe, withoutMissingFile, reportError } from '../infra/fehler';
import { prozessweit } from '../infra/prozessweit';
import path from 'node:path';
import { APP_ROOT, SET_IMAGES_DIR } from '../infra/appPaths';
import type { ImagesContext } from './kontext';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

/** Nur ein Typ aus der Liste, nie der rohe Kopf des CDN: „image/png, text/html“
 * läse ein Browser als HTML. Alles andere wird JPEG, mit nosniff harmlos. */
export function imageType(roh: string): string {
  const typ = beforeThe(roh, ';').trim().toLowerCase();
  return IMAGE_TYPES.has(typ) ? typ : 'image/jpeg';
}

/** Was aus dem Platten-Cache ausgeliefert werden kann; gesendet wird in
 * src/bilder/http/bildCacheAuslieferung.ts. */
export interface CacheHits {
  datei: string;
  typ: string;
  groesse: number | null;
  etag: string | null;
}

/** null heisst: nicht im Cache, der Aufrufer holt beim CDN. */
export async function cacheTreffer(
  k: ImagesContext,
  opts: {
    cacheFile: string;
    thumbFile: string;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
  },
): Promise<CacheHits | null> {
  const { cacheFile, thumbFile, wantThumb, createMay, note } = opts;

  if (wantThumb) {
    try {
      await fs.promises.access(thumbFile);
      const tst = await fs.promises.stat(thumbFile).catch(withoutMissingFile('bild-cache:stat', null));
      // Eine leere oder zu kleine Vorschau ist kein Bild (Altbestand, abgebrochener
      // Lauf): aufs Original zurückfallen und neu verkleinern.
      if (!tst || tst.size < 200) {
        await fs.promises.unlink(thumbFile).catch(withoutMissingFile('bild-cache:unlink'));
        throw new Error('unbrauchbare Vorschau verworfen');
      }
      return {
        datei: thumbFile,
        typ: await previewType(thumbFile),
        groesse: tst.size,
        etag: `"t-${tst.size}-${Math.floor(tst.mtimeMs)}"`,
      };
    } catch (_) {
      /* noch nicht erzeugt */
    }
  }

  try {
    // Async: Der Cache-Treffer ist der heisseste Pfad und soll den Event-Loop
    // nicht blockieren.
    await fs.promises.access(cacheFile);

    if (wantThumb) {
      // NICHT auf die Verkleinerung warten: Das Original geht sofort hinaus, sonst
      // reihten sich bei einer Kachelwand Sekunden Jimp aneinander.
      if (createMay) queueThumb(k, cacheFile, thumbFile);
      else note();
    }

    // Auch aus dem Cache nur Bilder; im Zweifel JPEG — mit nosniff die harmlose
    // Auslegung.
    const ctRaw = await fs.promises
      .readFile(cacheFile + '.ct', 'utf8')
      .catch(withoutMissingFile('bild-cache:typ', 'image/jpeg'));
    const cst = await fs.promises.stat(cacheFile).catch(withoutMissingFile('bild-cache:stat', null));
    // Der Deckel löscht nach letzter Nutzung; unter noatime merkt sich das
    // sonst niemand. mtime bleibt, sie steckt im ETag.
    if (cst && k.uhr.jetzt() - cst.atimeMs > 86_400_000)
      fs.promises.utimes(cacheFile, k.uhr.datum(), cst.mtime).catch(withoutMissingFile('bild-cache:utimes'));
    return {
      datei: cacheFile,
      typ: imageType(ctRaw),
      groesse: cst?.size ?? null,
      etag: cst ? `"c-${cst.size}-${Math.floor(cst.mtimeMs)}"` : null,
    };
  } catch (_) {
    /* Cache-Miss oder Fehler — normal weiterladen */
  }

  return null;
}

const CACHE_DIR = () => path.join(APP_ROOT, 'data', 'img_proxy_cache');

/** 30 Tage nicht angefasst → weg; danach, falls der Cache noch über der
 * Grenze liegt, die am längsten unbenutzten Bilder samt .ct und Vorschau. */
export async function cleanImageCacheOn(maxBytes: number, jetzt: number): Promise<number> {
  const cacheDir = CACHE_DIR();
  const files = await fs.promises.readdir(cacheDir).catch(withoutMissingFile('bildcache:lesen', [] as string[]));
  const cutoff = jetzt - 30 * 24 * 60 * 60 * 1000;
  const gruppen = new Map<string, { dateien: string[]; bytes: number; zuletzt: number }>();
  let weg = 0,
    summe = 0;
  for (const f of files) {
    const p = path.join(cacheDir, f);
    const st = await fs.promises.stat(p).catch(withoutMissingFile('img-cache:stat', null));
    if (!st?.isFile()) continue;
    // atime UND mtime: Unter noatime bleibt atime auf dem Erstellungszeitpunkt.
    if (
      st.atimeMs < cutoff &&
      st.mtimeMs < cutoff &&
      (await fs.promises.unlink(p).then(
        () => true,
        () => false,
      ))
    ) {
      weg++;
      continue;
    }
    const g = gruppen.get(f.slice(0, 40)) ?? { dateien: [], bytes: 0, zuletzt: 0 };
    g.dateien.push(p);
    g.bytes += st.size;
    g.zuletzt = Math.max(g.zuletzt, st.atimeMs, st.mtimeMs);
    gruppen.set(f.slice(0, 40), g);
    summe += st.size;
  }
  // images/sets zählt mit, wird aber nicht geräumt: Die Set-Bilder gelten auf Dauer, der Deckel
  // gilt für alles, was der Proxy auf die Platte legt.
  for (const f of await fs.promises
    .readdir(SET_IMAGES_DIR)
    .catch(withoutMissingFile('bildcache:sets', [] as string[]))) {
    const st = await fs.promises.stat(path.join(SET_IMAGES_DIR, f)).catch(withoutMissingFile('img-cache:stat', null));
    if (st?.isFile()) summe += st.size;
  }
  if (summe <= maxBytes) return weg;
  // Auf 90 % statt knapp unter die Grenze: sonst liefe das gleich wieder an.
  for (const g of [...gruppen.values()].sort((a, b) => a.zuletzt - b.zuletzt)) {
    if (summe <= maxBytes * 0.9) break;
    for (const d of g.dateien)
      if (
        await fs.promises.unlink(d).then(
          () => true,
          () => false,
        )
      )
        weg++;
    summe -= g.bytes;
  }
  return weg;
}

/** Zwischen zwei Tagesläufen kann der Cache schnell wachsen; nach je einem
 * Zehntel der Grenze an neuen Bytes wird deshalb sofort gedeckelt. */
export function rememberCacheGrowth(bytes: number, max: number): void {
  const z = prozessweit('bildCacheZuwachs', () => ({ bytes: 0, laeuft: false }));
  z.bytes += bytes;
  if (z.laeuft || z.bytes < max / 10) return;
  z.bytes = 0;
  z.laeuft = true;
  cleanImageCacheOn(max, Date.now())
    .catch(e => reportError('bild-cache:deckel', e))
    .finally(() => {
      z.laeuft = false;
    });
}
