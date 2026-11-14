/** Asynchron: Die Route stellt nur einen Auftrag ein; Bilder holt und zeichnet
 * der Job-Prozess in einem eigenen Faden, damit der Web-Prozess frei bleibt. */
import { meldeFehler, ohneFehlendeDatei } from '../../src/infra/fehler';
import { fehlerAntwort, streamFileToResponse, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, waechterFuer } from './middleware';
import { oeffneStrom, type Strom } from '../../src/konto/http/strom';
import _pdfFs from 'node:fs/promises';
import _fsSync from 'node:fs';
import { pdfSchluessel, gueltigeAuftragsKennung, pdfDateiPfad } from '../../src/auftraege';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import type { Request, Response } from 'express';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

type PdfJobStatus = {
  status?: string | undefined;
  error?: string | null;
  etaSeconds?: number | null;
  missingImages?: number | null;
};

async function pdfJobRead(d: Dienste, id: string) {
  // Ein Lesefehler ist kein unbekannter Auftrag (404): Er geht weiter.
  return d.auftraege.liesAuftrag(id);
}

/** Der einzige Weg, auf dem die drei Abrufrouten an einen Auftrag kommen —
 * damit keine die Zugehörigkeit vergisst. */
async function pdfJobReadFor(d: Dienste, id: string, userId: number) {
  const job = await pdfJobRead(d, id);
  if (!job) return null;
  if (job.user_id !== userId) return null;
  return job;
}
/** Die Beugung steht als Platzhalter in der Tabelle, nicht hier. */
function laufendeBeugung(anzahl: number, sprache: string) {
  const en = sprache === 'en',
    eins = anzahl === 1;
  return {
    anzahl,
    laufenVerb: eins ? (en ? 'is' : 'läuft') : en ? 'are' : 'laufen',
    auftragWort: eins ? (en ? 'job' : 'Auftrag') : en ? 'jobs' : 'Aufträge',
  };
}

const fertig = (s: string | undefined) => s === 'done' || s === 'error';

/** NOTIFY meldet den Stand, gleich in welchem Prozess der Auftrag läuft; ohne
 * Nutzlast (beim Wiederverbinden) und im Rückfalltakt wird ebenfalls nachgesehen,
 * falls ein Signal während einer Verbindungsstörung verloren ging. */
function folgeAuftrag(d: Dienste, strom: Strom, jobId: string, uid: number) {
  const pruefe = async () => {
    const job = await pdfJobReadFor(d, jobId, uid);
    if (strom.zu) return;
    if (job) strom.sende({ status: job.status, error: job.error || null } satisfies PdfJobStatus);
    if (!job || fertig(job.status)) strom.ende();
  };
  strom.beiEnde(
    d.auftraege.beiAuftragsStand(nutzlast => (!nutzlast || nutzlast === pdfSchluessel(jobId) ? pruefe() : undefined)),
  );
  const rueckfall = setInterval(pruefe, 15000);
  strom.beiEnde(() => clearInterval(rueckfall));
}

/** streamFileToResponse statt pipe(): Das Aufräumen kann die Datei zwischen Prüfung
 * und Öffnen entfernen, und ein Lesestrom-Fehler ohne Zuhörer beendet den Prozess.
 * Aufgeräumt wird nur nach vollständiger Auslieferung. */
function liefereUndRaeumeAuf(d: Dienste, req: Request, res: Response, jobId: string, pdfPath: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="teileliste.pdf"');
  const aufraeumen = () => {
    _pdfFs.unlink(pdfPath).catch(ohneFehlendeDatei('pdf:datei loeschen'));
    d.auftraege.loescheAuftrag(jobId).catch((e: unknown) => meldeFehler('pdf:auftrag-loeschen', e));
  };
  streamFileToResponse(res, pdfPath, aufraeumen, req);
}

export function bauePdfRouter(d: Dienste) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  const validJobId = gueltigeAuftragsKennung;

  router.post(
    '/sets/partslist-pdf',
    requireToken,
    async (req: Anfrage<'POST /api/v1/sets/partslist-pdf'>, res: Antwort<'POST /api/v1/sets/partslist-pdf'>) => {
      const uid = req.apiUser.user_id;
      const { sets = [], parts = [] } = req.eingabe;
      if (!parts.length) return sendeFehler(req, res, 400, 'keine_teile');

      const r = await d.auftraege.pdfAuftragStarten(uid, sets, parts);
      if ('laufend' in r) {
        return sendeFehler(req, res, 429, 'pdf_auftrag_laeuft', laufendeBeugung(r.laufend, antwortSprache(req)));
      }

      res.json({ success: true, jobId: r.jobId });
    },
  );

  router.get(
    '/sets/partslist-pdf/status/:jobId',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/sets/partslist-pdf/status/:jobId'>,
      res: Antwort<'GET /api/v1/sets/partslist-pdf/status/:jobId'>,
    ) => {
      if (!validJobId(req.pfad.jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
      const job = await pdfJobReadFor(d, req.pfad.jobId, req.apiUser.user_id);
      if (!job) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
      res.json({
        success: true,
        status: job.status,
        error: job.error || null,
        etaSeconds: job.etaSeconds ?? null,
        missingImages: job.missingImages ?? null,
      });
    },
  );

  // SSE statt Polling; der Strom sendet nur bei Änderung.
  router.get(
    '/sets/partslist-pdf/stream/:jobId',
    requireToken,
    kontoSchranke('strom'),
    async (req: Anfrage<'GET /api/v1/sets/partslist-pdf/stream/:jobId'>, res) => {
      const jobId = req.pfad.jobId;
      if (!validJobId(jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
      const initial = await pdfJobReadFor(d, jobId, req.apiUser.user_id);
      if (!initial) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
      const strom = oeffneStrom(d.konto, req, res, { nurAenderungen: true });
      strom.sende({
        status: initial.status,
        error: initial.error || null,
        etaSeconds: initial.etaSeconds ?? null,
        missingImages: initial.missingImages ?? null,
      } satisfies PdfJobStatus);
      if (fertig(initial.status)) strom.ende();
      else folgeAuftrag(d, strom, jobId, req.apiUser.user_id);
    },
  );

  router.get(
    '/sets/partslist-pdf/download/:jobId',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/partslist-pdf/download/:jobId'>, res) => {
      const jobId = req.pfad.jobId;
      if (!validJobId(jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
      const job = await pdfJobReadFor(d, jobId, req.apiUser.user_id);
      if (!job) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
      if (job.status !== 'done') {
        // `status` zeigt der Oberfläche, wie weit der Auftrag ist; sendeFehler kennt das Feld nicht.
        return res.status(409).json({
          success: false,
          code: 'pdf_nicht_fertig',
          error: fehlerText('pdf_nicht_fertig', antwortSprache(req)),
          status: job.status,
        });
      }
      const pdfPath = pdfDateiPfad(jobId);
      if (!pdfPath || !_fsSync.existsSync(pdfPath)) return sendeFehler(req, res, 410, 'pdf_nicht_verfuegbar');
      liefereUndRaeumeAuf(d, req, res, jobId, pdfPath);
    },
  );

  router.use(fehlerAntwort);
  return router;
}
