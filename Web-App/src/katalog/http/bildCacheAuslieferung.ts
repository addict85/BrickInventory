import type { ServerResponse } from 'http';
import { cacheTreffer } from '../bilder/imgCacheServe';

type BildAntwort = ServerResponse & { status(c: number): { end(): unknown } };
interface BildAnfrage { fresh: boolean; headers?: Record<string, unknown> }

/** Aus dem Platten-Cache, falls vorhanden; true heisst beantwortet. */
export async function liefereAusCache(opts: {
  res: BildAntwort;
  req: BildAnfrage;
  cacheFile: string;
  thumbFile: string;
  wantThumb: boolean;
  darfErzeugen: boolean;
  notiere: () => void;
  streamFileToResponse(res: BildAntwort, datei: string, onEnd?: () => void, req?: BildAnfrage): unknown;
}): Promise<boolean> {
  const { res, req, streamFileToResponse } = opts;
  const treffer = await cacheTreffer(opts);
  if (!treffer) return false;
  res.setHeader('Content-Type', treffer.typ);
  // Länge mitgeben: Eine chunked-Antwort kann ein Reverse-Proxy puffern.
  if (treffer.groesse !== null) res.setHeader('Content-Length', String(treffer.groesse));
  if (treffer.etag) res.setHeader('ETag', treffer.etag);
  res.setHeader('Cache-Control', 'private, max-age=86400, must-revalidate');
  // Kennt der Browser die Datei schon, reicht ein leeres 304.
  if (req.fresh) { res.status(304).end(); return true; }
  // Kein rohes pipe(): Die Cache-Pflege kann die Datei zwischen Prüfung und
  // Öffnen entfernen, und ein Lesestrom-Fehler ohne Zuhörer beendet den Prozess.
  streamFileToResponse(res, treffer.datei, undefined, req);
  return true;
}
