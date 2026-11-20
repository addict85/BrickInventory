/** Eigene Datei, damit ein Test die echten Handler einhängen kann. */
import { guardFor } from './api_v1/middleware';
import { pathSegments } from '../src/http/httpAntwort';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { deliverFile, FOREIGN_FILE_CSP } from '../src/http/dateiAusliefern';
import { safeDataPath } from '../src/infra/datenPfad';

import { signedInUserId } from '../src/konto/http/anmeldung';
import type { Dienste } from '../src/dienste';

type WildcardRequest = Request<{ pfad: string[] }>;

/** Fremd Hochgeladenes (nur die ersten Bytes geprüft) läuft so nie unter der Herkunft
 * der App; der eigene Betrachter lädt per fetch und braucht keine Inline-Anzeige. */
function asAttachment(res: Response, datei: string): void {
  res.setHeader('Content-Security-Policy', FOREIGN_FILE_CSP);
  res.attachment(path.basename(datei));
}

export function buildDataFilesRouter(d: Pick<Dienste, 'household' | 'konto' | 'bilder'>) {
  const { inboundLock, requireLoginOrToken } = guardFor(d.konto);
  const router = express.Router();

  // Das Hauptkonto sieht die Uploads seiner Unterkonten, nicht umgekehrt. Ein
  // erstes Segment ohne Benutzer-ID wird abgewiesen.
  router.get('/data/uploads/*pfad', requireLoginOrToken, inboundLock, async (req: WildcardRequest, res: Response) => {
    const userId = signedInUserId(req);
    // Rechnungen und Gutscheine: nie in einen Zwischenspeicher, auch keine Absage.
    res.setHeader('Cache-Control', 'private, no-store');
    const segments = pathSegments(req, 'pfad');
    const filePath = safeDataPath('uploads', segments);
    if (!filePath || !/^\d+$/.test(segments[0] ?? '')) return res.status(404).send('Datei nicht gefunden');
    const besitzer = Number(segments[0]);
    // Auch Verwalter lesen fremde Uploads (Rechnungen, Gutscheine) nicht. Fremd
    // antwortet wie fehlend, damit sich nicht ablesen lässt, welche Konten Dateien haben.
    if (!(await d.household.seesAccount(userId, besitzer))) return res.status(404).send('Datei nicht gefunden');
    asAttachment(res, filePath);
    deliverFile(res, filePath);
  });

  // Geteilt abgelegt, aber unter der Setnummer: nur zu Sets im eigenen Blickfeld,
  // sonst dieselbe 404 wie für eine fehlende Datei.
  router.get(
    '/data/instructions/*pfad',
    requireLoginOrToken,
    inboundLock,
    async (req: WildcardRequest, res: Response) => {
      const segmente = pathSegments(req, 'pfad');
      const filePath = safeDataPath('instructions', segmente);
      if (!filePath || !(await d.bilder.instructionReleased(signedInUserId(req), segmente)))
        return res.status(404).send('Datei nicht gefunden');
      asAttachment(res, filePath);
      deliverFile(res, filePath);
    },
  );
  return router;
}
