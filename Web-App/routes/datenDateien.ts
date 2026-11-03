/** Eigene Datei, damit ein Test die echten Handler einhängen kann. */
import { fehlerAntwort } from '../src/infra/httpError';
import express, { Request, Response } from 'express';
import { liefereDatei } from '../src/infra/dateiAusliefern';
import { safeDataPath } from '../src/infra/datenPfad';

import { requireLoginOrToken, angemeldeteNutzerId } from '../src/konto/http/anmeldung';
import { scopeIds } from '../src/haushalt/haushalt';
import { anleitungFreigegeben } from '../src/katalog/bilder/bildBlickfeld';

type WildcardRequest = Request<{ pfad: string[] }>;
const router = express.Router();

// scopeIds(): Das Hauptkonto sieht die Uploads seiner Unterkonten, nicht
// umgekehrt. Ein erstes Segment ohne Benutzer-ID wird abgewiesen.
// Ausführlich: docs/begruendungen/server.ts.md#servedatafile
router.get('/data/uploads/*pfad', requireLoginOrToken, async (req: WildcardRequest, res: Response) => {
  const userId = angemeldeteNutzerId(req);
  // Rechnungen und Gutscheine: nie in einen Zwischenspeicher, auch keine Absage.
  res.setHeader('Cache-Control', 'private, no-store');
  const segments = req.params.pfad.filter(Boolean);
  const filePath = safeDataPath('uploads', segments);
  if (!filePath || !/^\d+$/.test(segments[0] ?? '')) return res.status(404).send('Datei nicht gefunden');
  const besitzer = Number(segments[0]);
  // Auch Verwalter lesen fremde Uploads (Rechnungen, Gutscheine) nicht. Fremd
  // antwortet wie fehlend, damit sich nicht ablesen lässt, welche Konten Dateien haben.
  if (besitzer !== userId) {
    const erlaubt = await scopeIds(userId).catch(() => [userId]);
    if (!erlaubt.includes(besitzer)) return res.status(404).send('Datei nicht gefunden');
  }
  liefereDatei(res, filePath);
});

// Geteilt abgelegt, aber unter der Setnummer: nur zu Sets im eigenen Blickfeld,
// sonst dieselbe 404 wie für eine fehlende Datei.
router.get('/data/instructions/*pfad', requireLoginOrToken, async (req: WildcardRequest, res: Response) => {
  const segmente = req.params.pfad.filter(Boolean);
  const filePath = safeDataPath('instructions', segmente);
  if (!filePath || !await anleitungFreigegeben(angemeldeteNutzerId(req), segmente)) return res.status(404).send('Datei nicht gefunden');
  liefereDatei(res, filePath);
});

router.use(fehlerAntwort);

export = router;
