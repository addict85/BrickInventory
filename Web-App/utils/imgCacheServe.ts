import fs from 'fs';
import { queueThumb } from './proxyThumbs';
import { vorDem } from '../utils/httpError';

/**
 * Ein Bild aus dem Platten-Cache ausliefern, falls es dort liegt.
 * Ausführlich: docs/begruendungen/utils/imgCacheServe.ts.md#liefereauscache
 */
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
      const tst0 = await fs.promises.stat(thumbFile).catch(() => null);
      // Zweite Verteidigungslinie: Eine leere oder viel zu
      // kleine Vorschau ist kein Bild. Seit der Erzeugung atomar läuft, darf
      // das nicht mehr entstehen — Altbestände aus der Zeit davor liegen
      // aber weiterhin auf der Platte, und ein abgebrochener Lauf könnte
      // wieder einen Rumpf hinterlassen. Statt ihn auszuliefern, fällt die
      // Anfrage auf das Original zurück (weiter unten) und die Verkleinerung
      // wird neu angestossen.
      if (!tst0 || tst0.size < 200) {
        await fs.promises.unlink(thumbFile).catch(() => {});
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
      // Ausführlich: docs/begruendungen/utils/imgCacheServe.ts.md#liefereauscache-2
      if (req.fresh) { res.status(304).end(); return true; }
      // Kein rohes pipe(): Die Cache-Pflege kann die Datei zwischen Prüfung
      // und Öffnen entfernen, und ein Lesestrom-Fehler ohne Zuhörer beendet
      // den Prozess (siehe utils/httpError.ts).
      streamFileToResponse(res, thumbFile, undefined, req); return true;
    } catch (_) { /* noch nicht erzeugt */ }
  }

  try {
    // Async statt existsSync/readFileSync — der Cache-Hit ist der heisseste
    // Pfad dieser Route und soll den Event-Loop nicht blockieren.
    await fs.promises.access(cacheFile);

    if (wantThumb) {
      // Original liegt vor, Verkleinerung fehlt noch. NICHT darauf warten:
      // Das Original geht sofort raus, die Verkleinerung entsteht in der
      // Warteschlange und steht ab dem nächsten Aufruf bereit. Vorher hing
      // hier jede Anfrage an rund 150 ms Jimp — bei einer vollen Kachelwand
      // reihte sich das zu Sekunden.
      if (darfErzeugen) queueThumb(cacheFile, thumbFile); else notiere();
    }

    // Auch aus dem Cache nur Bilder: Ein vor dieser Prüfung angelegter
    // Eintrag könnte einen fremden Typ tragen (siehe die Prüfung weiter
    // unten beim Abruf). Im Zweifel als JPEG ausliefern — zusammen mit
    // nosniff ist das die harmlose Auslegung.
    const ctRaw = await fs.promises.readFile(cacheFile + '.ct', 'utf8').catch(() => 'image/jpeg');
    const ctMime = vorDem(ctRaw, ';').trim().toLowerCase();
    const ct = (ctMime.startsWith('image/') && ctMime !== 'image/svg+xml') ? ctRaw : 'image/jpeg';
    res.setHeader('Content-Type', ct);
    // Länge mitgeben: Ohne sie geht die Antwort als chunked raus, und ein
    // Reverse-Proxy davor kann sie puffern statt durchzureichen.
    const cst = await fs.promises.stat(cacheFile).catch(() => null);
    if (cst) {
      res.setHeader('Content-Length', String(cst.size));
      res.setHeader('ETag', `"c-${cst.size}-${Math.floor(cst.mtimeMs)}"`);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    // Wie oben beim Vorschaubild: bekannter Stand → 304 statt Bild.
    if (req.fresh) { res.status(304).end(); return true; }
    streamFileToResponse(res, cacheFile, undefined, req); return true;
  } catch (_) { /* Cache-Miss oder Fehler — normal weiterladen */ }

  return false;
}
