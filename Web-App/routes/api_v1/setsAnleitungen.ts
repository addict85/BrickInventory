/** Anleitungen eines Sets: neu laden, hochladen, löschen. */
import type express from 'express';
import path from 'node:path';
import { fehlerAntwort, pfadParam, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, waechterFuer } from './middleware';
import {
  uploadKontingentBytes,
  privaterOrdner,
  privaterEmpfang,
  kontingentReichtFuer,
  pruefeEmpfangeneDatei,
} from '../../src/http/dateiEmpfang';
import { ANLEITUNGS_WURZEL } from '../../src/sets';
import { angemeldeteNutzerId, istVerwalter } from '../../src/konto/http/anmeldung';
import { freigegeben } from '../../src/konto/http/schrittschutz';
import { vertragsRouter, type Anfrage, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

const uploadKontingentMb = () => Math.round(uploadKontingentBytes() / 1024 / 1024);

/** Besitz und Kontingent VOR dem Schreiben, sonst lägen bis zu 50 MB auf der Platte. */
const vorDemUpload =
  (d: Pick<Dienste, 'konto' | 'sets'>) =>
  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const uid = angemeldeteNutzerId(req);
    if (!(await d.sets.setGehoertKonto(uid, pfadParam(req, 'setNumber'))))
      return sendeFehler(req, res, 404, 'nicht_gefunden');
    if (
      !(await kontingentReichtFuer(
        path.join(ANLEITUNGS_WURZEL, String(uid)),
        Number(req.headers['content-length']) || 0,
      ))
    )
      return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: uploadKontingentMb() });
    next();
  };

export function baueSetsAnleitungenRouter(d: Pick<Dienste, 'konto' | 'sets'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  router.post(
    '/sets/:setNumber/instructions',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/sets/:setNumber/instructions'>,
      res: Antwort<'POST /api/v1/sets/:setNumber/instructions'>,
    ) => {
      // Der Verwalter löscht geteilte Anleitungen: derselbe Schrittschutz wie jede Verwalter-Route.
      const verwalter = istVerwalter(req);
      if (verwalter && !(await freigegeben(d.konto, req, res, 'verwaltung'))) return;
      const { instructions, auftrag } = await d.sets.anleitungenNeuLaden(
        req.apiUser.user_id,
        req.pfad.setNumber,
        verwalter,
      );
      res.status(202).json({ success: true, instructions, count: instructions.length, auftrag_id: auftrag });
    },
  );

  const uploadInstr = privaterEmpfang({
    ordner: req => privaterOrdner(ANLEITUNGS_WURZEL, String(angemeldeteNutzerId(req))),
    praefix: req => pfadParam(req, 'setNumber'),
    typen: { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' },
    maxBytes: 50 * 1024 * 1024,
  });

  router.post(
    '/sets/:setNumber/instructions/upload',
    requireToken,
    kontoSchranke('upload'),
    vorDemUpload(d),
    uploadInstr.single('file'),
    async (
      req: OffeneAnfrage<'POST /api/v1/sets/:setNumber/instructions/upload'>,
      res: Antwort<'POST /api/v1/sets/:setNumber/instructions/upload'>,
    ) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      const grund = await pruefeEmpfangeneDatei(ANLEITUNGS_WURZEL, req.file.path, req.file.mimetype);
      if (grund === 'upload_kontingent_voll') return sendeFehler(req, res, 413, grund, { mb: uploadKontingentMb() });
      if (grund) return sendeFehler(req, res, 400, grund);
      const uid = angemeldeteNutzerId(req),
        sn = req.pfad.setNumber;
      const desc = (req.eingabe.description || req.file.originalname).substring(0, 200);
      const relPath = `/data/uploads/${uid}/${req.file.filename}`;
      await d.sets.anleitungMerken(uid, sn, relPath, desc);
      res.json({ success: true, instruction: { url: relPath, description: desc, local_path: relPath } });
    },
  );

  router.delete(
    '/sets/:setNumber/instructions/:instrId',
    requireToken,
    async (
      req: OffeneAnfrage<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>,
      res: Antwort<'DELETE /api/v1/sets/:setNumber/instructions/:instrId'>,
    ) => {
      if (!(await d.sets.anleitungLoeschen(angemeldeteNutzerId(req), String(req.pfad.instrId))))
        return sendeFehler(req, res, 404, 'nicht_gefunden');
      res.json({ success: true });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
