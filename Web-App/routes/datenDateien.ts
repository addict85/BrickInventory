/**
 * Eigene Anleitungen (data/uploads/<benutzer-id>/) und geteilte
 * (data/instructions/). Eigene Datei, damit ein Test die echten Handler
 * einhängen kann.
 */
import { fehlerAntwort } from '../src/infra/httpError';
import express, { Request, Response } from 'express';
import { liefereDatei } from '../src/infra/dateiAusliefern';
import { safeDataPath } from '../src/infra/datenPfad';

import { requireLoginOrToken, angemeldeteNutzerId } from '../src/konto/auth';
import { scopeIds } from '../src/haushalt/haushalt';

type WildcardRequest = Request<{ pfad: string[] }>;
const router = express.Router();

// Wer lesen darf, entscheidet scopeIds(): Das Hauptkonto sieht die Uploads
// seiner Unterkonten, nicht umgekehrt. Ein erstes Segment, das keine
// Benutzer-ID ist, gibt es in uploads/ nicht — es wird abgewiesen statt
// durchgewinkt. Ausführlich: docs/begruendungen/server.ts.md#servedatafile
router.get('/data/uploads/*pfad', requireLoginOrToken, async (req: WildcardRequest, res: Response) => {
  const userId = angemeldeteNutzerId(req);
  const segments = req.params.pfad.filter(Boolean);
  const filePath = safeDataPath('uploads', segments);
  if (!filePath || !/^\d+$/.test(segments[0] ?? '')) return res.status(404).send('Datei nicht gefunden');
  const besitzer = Number(segments[0]);
  // Auch Verwalter lesen fremde Uploads (Rechnungen, Gutscheine) nicht: Die
  // Verwaltung der Konten braucht deren Inhalt nicht.
  if (besitzer !== userId) {
    const erlaubt = await scopeIds(userId).catch(() => [userId]);
    if (!erlaubt.includes(besitzer)) return res.status(403).send('Kein Zugriff');
  }
  liefereDatei(res, filePath);
});

// Geteilte Anleitungen gehören niemandem; angemeldet genügt.
router.get('/data/instructions/*pfad', requireLoginOrToken, async (req: WildcardRequest, res: Response) => {
  const filePath = safeDataPath('instructions', req.params.pfad.filter(Boolean));
  if (!filePath) return res.status(404).send('Datei nicht gefunden');
  liefereDatei(res, filePath);
});

router.use(fehlerAntwort);

export = router;
