/** Anleitungen eines Sets: neu laden, hochladen, löschen. */
import type express from 'express';
import path from 'node:path';
import { pathParam } from '../../src/http/httpAntwort';
import { fachfehler, notFound } from '../../src/infra/fehlerTexte';
import { kontoSchranke, guardFor } from './middleware';
import {
  uploadQuotaBytes,
  privaterFolder,
  privaterReceive,
  quotaSufficesFor,
  totalSufficesFor,
  uploadTotalMb,
  checkReceivedFile,
} from '../../src/http/dateiEmpfang';
import { ANLEITUNGS_WURZEL } from '../../src/sets';
import { signedInUserId, istVerwalter } from '../../src/account/http/login';
import { released } from '../../src/account/http/stepGuard';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

const uploadQuotaMb = () => Math.round(uploadQuotaBytes() / 1024 / 1024);

/** Besitz und Kontingent VOR dem Schreiben, sonst lägen bis zu 50 MB auf der Platte. */
const beforeTheUpload =
  (d: Pick<Dienste, 'account' | 'sets'>) =>
  async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const uid = signedInUserId(req);
    if (!(await d.sets.setBelongsAccount(uid, pathParam(req, 'setNumber')))) notFound();
    const laenge = Number(req.headers['content-length']) || 0;
    if (!(await quotaSufficesFor(path.join(ANLEITUNGS_WURZEL, String(uid)), laenge)))
      fachfehler('zu_gross', 'upload_kontingent_voll', { mb: uploadQuotaMb() });
    if (!(await totalSufficesFor(laenge))) fachfehler('speicher_voll', 'upload_gesamt_voll', { mb: uploadTotalMb() });
    next();
  };

export function buildSetsInstructionsRouter(d: Pick<Dienste, 'account' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('POST /api/v1/sets/:setNumber/instructions', requireToken, async (req, res) => {
    // Der Verwalter löscht geteilte Anleitungen: derselbe Schrittschutz wie jede Verwalter-Route.
    const verwalter = istVerwalter(req);
    if (verwalter && !(await released(d.account, req, res, 'verwaltung'))) return;
    const { instructions, auftrag } = await d.sets.loadInstructionsNew(
      req.apiUser.user_id,
      req.pfad.setNumber,
      verwalter,
    );
    res.status(202);
    return { instructions, count: instructions.length, auftrag_id: auftrag };
  });

  const uploadInstr = privaterReceive({
    ordner: req => privaterFolder(ANLEITUNGS_WURZEL, String(signedInUserId(req))),
    praefix: req => pathParam(req, 'setNumber'),
    typen: { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' },
    maxBytes: 50 * 1024 * 1024,
  });

  router.endpunkt(
    'POST /api/v1/sets/:setNumber/instructions/upload',
    requireToken,
    kontoSchranke('upload'),
    beforeTheUpload(d),
    uploadInstr.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      await checkReceivedFile(ANLEITUNGS_WURZEL, req.file.path, req.file.mimetype);
      const uid = signedInUserId(req),
        sn = req.pfad.setNumber;
      const desc = (req.eingabe.description || req.file.originalname).substring(0, 200);
      const relPath = `/data/uploads/${uid}/${req.file.filename}`;
      await d.sets.rememberInstruction(uid, sn, relPath, desc);
      return { instruction: { url: relPath, description: desc, local_path: relPath } };
    },
  );

  router.endpunkt('DELETE /api/v1/sets/:setNumber/instructions/:instrId', requireToken, async req => {
    await d.sets.anleitungLoeschen(signedInUserId(req), req.pfad.instrId);
    return {};
  });
  return router;
}
