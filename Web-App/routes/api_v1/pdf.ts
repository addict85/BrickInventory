/** Asynchron: Die Route stellt nur einen Auftrag ein; Bilder holt und zeichnet
 * der Job-Prozess in einem eigenen Faden, damit der Web-Prozess frei bleibt. */
import { reportError, withoutMissingFile } from '../../src/infra/error';
import { streamFileToResponse } from '../../src/http/httpResponse';
import { kontoSchranke, guardFor } from './middleware';
import { openStream, type Strom } from '../../src/account/http/stream';
import _pdfFs from 'node:fs/promises';
import { pdfKey } from '../../src/catalog';
import { responseLanguage, fachfehler, notFound } from '../../src/infra/errorTexts';
import type { Request, Response } from 'express';
import { inShell, vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';

function streamStatus(job: {
  status: string;
  error?: string | null;
  etaSeconds?: number | null;
  missingImages?: unknown;
}) {
  return inShell({
    status: job.status,
    error: job.error || null,
    etaSeconds: job.etaSeconds ?? null,
    missingImages: job.missingImages ?? null,
  });
}

/** Der einzige Weg der drei Abrufrouten an einen Auftrag: nur der eigene; ein Lesefehler geht weiter. */
function pdfJobReadFor(d: Pick<Dienste, 'jobQueue' | 'catalog' | 'account'>, id: string, userId: number) {
  return d.catalog.pdf.lies(id, userId);
}
/** Die Beugung steht als Platzhalter in der Tabelle, nicht hier. */
function runningInflection(anzahl: number, sprache: string) {
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
function sequenceJob(d: Pick<Dienste, 'jobQueue' | 'catalog' | 'account'>, strom: Strom, jobId: string, uid: number) {
  const pruefe = async () => {
    const job = await pdfJobReadFor(d, jobId, uid);
    if (strom.zu) return;
    if (job) strom.sende(streamStatus(job));
    if (!job || fertig(job.status)) strom.ende();
  };
  strom.atEnd(d.jobQueue.atJobStatus(nutzlast => (!nutzlast || nutzlast === pdfKey(jobId) ? pruefe() : undefined)));
  const rueckfall = setInterval(pruefe, 15000);
  strom.atEnd(() => clearInterval(rueckfall));
}

/** streamFileToResponse statt pipe(): Das Aufräumen kann die Datei zwischen Prüfung
 * und Öffnen entfernen, und ein Lesestrom-Fehler ohne Zuhörer beendet den Prozess.
 * Aufgeräumt wird nur nach vollständiger Auslieferung. */
function deliverAndCleanOn(
  d: Pick<Dienste, 'jobQueue' | 'catalog' | 'account'>,
  req: Request,
  res: Response,
  jobId: string,
  uid: number,
  pdfPath: string,
) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="teileliste.pdf"');
  const aufraeumen = () => {
    _pdfFs.unlink(pdfPath).catch(withoutMissingFile('pdf:datei loeschen'));
    d.catalog.pdf.loesche(jobId, uid).catch((e: unknown) => reportError('pdf:auftrag-loeschen', e));
  };
  streamFileToResponse(res, pdfPath, aufraeumen, req);
}

export function buildPdfRouter(d: Pick<Dienste, 'jobQueue' | 'catalog' | 'account'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('POST /api/v1/sets/partslist-pdf', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const { sets = [], parts = [] } = req.eingabe;
    if (!parts.length) fachfehler('ungueltig', 'keine_teile');

    const r = await d.catalog.pdf.starten(uid, sets, parts);
    if ('laufend' in r) {
      fachfehler('zu_viele', 'pdf_auftrag_laeuft', runningInflection(r.laufend, responseLanguage(req)));
    }

    return { jobId: r.jobId };
  });

  router.endpunkt('GET /api/v1/sets/partslist-pdf/status/:jobId', requireToken, async req => {
    const job = await pdfJobReadFor(d, req.pfad.jobId, req.apiUser.user_id);
    if (!job) notFound('job_nicht_gefunden');
    return {
      status: job.status,
      error: job.error || null,
      etaSeconds: job.etaSeconds ?? null,
      missingImages: job.missingImages ?? null,
    };
  });

  // SSE statt Polling; der Strom sendet nur bei Änderung.
  router.endpunkt(
    'GET /api/v1/sets/partslist-pdf/stream/:jobId',
    requireToken,
    kontoSchranke('strom'),
    async (req, res) => {
      const jobId = req.pfad.jobId;
      const initial = await pdfJobReadFor(d, jobId, req.apiUser.user_id);
      if (!initial) notFound('job_nicht_gefunden');
      const strom = openStream(d.account, req, res, { onlyChanges: true });
      strom.sende(streamStatus(initial));
      if (fertig(initial.status)) strom.ende();
      else sequenceJob(d, strom, jobId, req.apiUser.user_id);
    },
  );

  router.endpunkt('GET /api/v1/sets/partslist-pdf/download/:jobId', requireToken, async (req, res) => {
    const jobId = req.pfad.jobId;
    const pdfPath = await d.catalog.pdf.finishedFile(jobId, req.apiUser.user_id);
    deliverAndCleanOn(d, req, res, jobId, req.apiUser.user_id, pdfPath);
  });
  return router;
}
