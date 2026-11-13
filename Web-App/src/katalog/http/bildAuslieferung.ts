/** EINE angemeldete Route für alle Bilder unter /images/: Eigene Uploads dürfen
 * nicht ohne Anmeldung hinaus, ein fremdes Set-Bild antwortet wie ein fehlendes. */
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { resolveUserId } from '../../konto/http/anmeldung';
import { safeDataPath } from '../../infra/datenPfad';
import { pfadSegmente } from '../../http/httpAntwort';
import { antwortAufDateiFehler, liefereDatei, sendeDatei } from '../../http/dateiAusliefern';
import { logAndContinue } from '../../infra/fehler';
import { bildFreigegeben } from '../bilder/bildBlickfeld';
import { generateThumb } from '../bilder/thumbs';
import { IMG_PROXY_PFAD } from '../bilder/images';
import { katalog } from '../prozess';
import { cdnFuerFehlendesBild } from '../bilder/bildNachschlagen';

/** Fehlt die Vorschau, geht sofort das Original hinaus und die Vorschau entsteht
 * nebenher; scheiterte sie beim Erfassen, gäbe es sonst keinen zweiten Anlauf. */
async function originalStattVorschau(res: Response, segmente: string[]): Promise<boolean> {
  const rohPfad = segmente.join('/');
  if (!/_thumb(\.[^.]+)$/.test(rohPfad)) return false;
  const originalSegs = rohPfad
    .replace(/_thumb(\.[^.]+)$/, '$1')
    .split('/')
    .filter(Boolean);
  const originalPfad = safeDataPath('images', originalSegs);
  if (
    !originalPfad ||
    !(await fs.promises.access(originalPfad).then(
      () => true,
      () => false,
    ))
  )
    return false;
  setImmediate(() => {
    void generateThumb('/images/' + originalSegs.join('/')).catch(logAndContinue('bilder:vorschau'));
  });
  liefereDatei(res, originalPfad);
  return true;
}

export async function liefereBild(req: Request, res: Response) {
  const imgUserId = await resolveUserId(req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');
  const segmente = pfadSegmente(req, 'pfad');
  const filePath = safeDataPath('images', segmente);
  if (!filePath || !(await bildFreigegeben(imgUserId, segmente))) return res.status(404).send('Datei nicht gefunden');
  // private: Die Antwort hängt an einer Anmeldung. max-age=0, damit ein ersetztes Bild sofort gilt.
  res.setHeader('Cache-Control', 'private, max-age=0');
  sendeDatei(res, filePath, async err => {
    if (!err || res.headersSent) return;
    // Ein Fehler MIT eigener Zahl (416, 403) ist keine fehlende Datei.
    const status = (err as { status?: number }).status;
    if (status && status !== 404) return antwortAufDateiFehler(res, err);
    if (await originalStattVorschau(res, segmente)) return;
    // Fehlt die Datei, über den Bild-Proxy zur CDN-Adresse: heilt ohne Aufräumen in der DB.
    const cdn = await cdnFuerFehlendesBild(katalog(), '/images/' + segmente.join('/'));
    if (cdn && !res.headersSent) return res.redirect(302, IMG_PROXY_PFAD + '?url=' + encodeURIComponent(cdn));
    antwortAufDateiFehler(res, err);
  });
}
