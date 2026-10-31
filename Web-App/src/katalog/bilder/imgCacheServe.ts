import fs from 'fs';
import { queueThumb } from './proxyThumbs';
import { vorDem, ohneFehlendeDatei } from '../../infra/httpError';
import path from 'path';
import { APP_ROOT } from '../../infra/appPaths';

// Ausführlich: docs/begruendungen/src/katalog/bilder/imgCacheServe.ts.md#liefereauscache
export async function liefereAusCache(opts: {
  res: any;
  req: any;
  cacheFile: string;
  thumbFile: string;
  wantThumb: boolean;
  darfErzeugen: boolean;
  notiere: () => void;
  streamFileToResponse: (res: any, datei: string, onEnd?: () => void, req?: any) => any;
}): Promise<boolean> {
  const { res, req, cacheFile, thumbFile, wantThumb, darfErzeugen, notiere, streamFileToResponse } = opts;

  if (wantThumb) {
    try {
      await fs.promises.access(thumbFile);
      const tst0 = await fs.promises.stat(thumbFile).catch(ohneFehlendeDatei('bild-cache:stat', null));
      // Eine leere oder zu kleine Vorschau ist kein Bild (Altbestand, abgebrochener
      // Lauf): aufs Original zurückfallen und neu verkleinern.
      if (!tst0 || tst0.size < 200) {
        await fs.promises.unlink(thumbFile).catch(ohneFehlendeDatei('bild-cache:unlink'));
        throw new Error('unbrauchbare Vorschau verworfen');
      }
      res.setHeader('Content-Type', 'image/jpeg');
      const tst = tst0;
      if (tst) {
        res.setHeader('Content-Length', String(tst.size));
        res.setHeader('ETag', `"t-${tst.size}-${Math.floor(tst.mtimeMs)}"`);
      }
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
      // Kennt der Browser die Datei schon, reicht ein leeres 304.
      if (req.fresh) { res.status(304).end(); return true; }
      // Kein rohes pipe(): Die Cache-Pflege kann die Datei zwischen Prüfung und
      // Öffnen entfernen, und ein Lesestrom-Fehler ohne Zuhörer beendet den Prozess.
      streamFileToResponse(res, thumbFile, undefined, req); return true;
    } catch (_) { /* noch nicht erzeugt */ }
  }

  try {
    // Async: Der Cache-Treffer ist der heisseste Pfad und soll den Event-Loop
    // nicht blockieren.
    await fs.promises.access(cacheFile);

    if (wantThumb) {
      // NICHT auf die Verkleinerung warten: Das Original geht sofort hinaus, sonst
      // reihten sich bei einer Kachelwand Sekunden Jimp aneinander.
      if (darfErzeugen) queueThumb(cacheFile, thumbFile); else notiere();
    }

    // Auch aus dem Cache nur Bilder; im Zweifel JPEG — mit nosniff die harmlose
    // Auslegung.
    const ctRaw = await fs.promises.readFile(cacheFile + '.ct', 'utf8').catch(() => 'image/jpeg');
    const ctMime = vorDem(ctRaw, ';').trim().toLowerCase();
    const ct = (ctMime.startsWith('image/') && ctMime !== 'image/svg+xml') ? ctRaw : 'image/jpeg';
    res.setHeader('Content-Type', ct);
    // Länge mitgeben: Eine chunked-Antwort kann ein Reverse-Proxy puffern.
    const cst = await fs.promises.stat(cacheFile).catch(ohneFehlendeDatei('bild-cache:stat', null));
    if (cst) {
      res.setHeader('Content-Length', String(cst.size));
      res.setHeader('ETag', `"c-${cst.size}-${Math.floor(cst.mtimeMs)}"`);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    if (req.fresh) { res.status(304).end(); return true; }
    streamFileToResponse(res, cacheFile, undefined, req); return true;
  } catch (_) { /* Cache-Miss oder Fehler — normal weiterladen */ }

  return false;
}

/** 30 Tage nicht angefasst → löschen, sonst wächst der Cache unbegrenzt.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#startimgcachecleanup */
export async function raeumeBildCacheAuf(): Promise<number> {
  const cacheDir = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const files = await fs.promises.readdir(cacheDir).catch(() => [] as string[]);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let weg = 0;
  for (const f of files) {
    const p = path.join(cacheDir, f);
    const st = await fs.promises.stat(p).catch(ohneFehlendeDatei('img-cache:stat', null));
    // atime UND mtime: Unter noatime bleibt atime auf dem Erstellungszeitpunkt.
    if (st?.isFile() && st.atimeMs < cutoff && st.mtimeMs < cutoff && await fs.promises.unlink(p).then(() => true, () => false)) weg++;
  }
  return weg;
}
