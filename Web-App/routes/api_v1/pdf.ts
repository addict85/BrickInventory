/** Asynchronous: the route only enqueues a job; images are fetched and drawn by
 * the job process in a thread of its own, so the web process stays free. */
import { reportError, withoutMissingFile } from '../../src/infra/error';
import { streamFileToResponse } from '../../src/http/httpResponse';
import { accountGate, guardFor } from './middleware';
import { openStream, type Stream } from '../../src/account/http/stream';
import _pdfFs from 'node:fs/promises';
import { pdfKey } from '../../src/catalog';
import { responseLanguage, failDomain, notFound } from '../../src/infra/errorTexts';
import type { Request, Response } from 'express';
import { inShell, contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

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

/** The only way of the three fetch routes to a job: only the own one; a read error goes on. */
function pdfJobReadFor(d: Pick<Services, 'jobQueue' | 'catalog' | 'account'>, id: string, userId: number) {
  return d.catalog.pdf.lies(id, userId);
}
/** The inflection is a placeholder in the table, not here. */
function runningInflection(anzahl: number, language: string) {
  const en = language === 'en',
    one = anzahl === 1;
  return {
    anzahl,
    laufenVerb: one ? (en ? 'is' : 'läuft') : en ? 'are' : 'laufen',
    auftragWort: one ? (en ? 'job' : 'Auftrag') : en ? 'jobs' : 'Aufträge',
  };
}

const finished = (s: string | undefined) => s === 'done' || s === 'error';

/** NOTIFY reports the state, no matter in which process the job runs; without a
 * payload (on reconnect) and in the fallback tick it also checks,
 * in case a signal got lost during a connection outage. */
function sequenceJob(
  d: Pick<Services, 'jobQueue' | 'catalog' | 'account'>,
  stream: Stream,
  jobId: string,
  uid: number,
) {
  const check = async () => {
    const job = await pdfJobReadFor(d, jobId, uid);
    if (stream.zu) return;
    if (job) stream.sende(streamStatus(job));
    if (!job || finished(job.status)) stream.ende();
  };
  stream.atEnd(d.jobQueue.atJobStatus(payload => (!payload || payload === pdfKey(jobId) ? check() : undefined)));
  const fallback = setInterval(check, 15000);
  stream.atEnd(() => clearInterval(fallback));
}

/** streamFileToResponse instead of pipe(): the cleanup can remove the file between check
 * and open, and a read stream error without a listener ends the process.
 * Cleanup only happens after complete delivery. */
function deliverAndCleanOn(
  d: Pick<Services, 'jobQueue' | 'catalog' | 'account'>,
  req: Request,
  res: Response,
  jobId: string,
  uid: number,
  pdfPath: string,
) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="teileliste.pdf"');
  const cleanUp = () => {
    _pdfFs.unlink(pdfPath).catch(withoutMissingFile('pdf:datei loeschen'));
    d.catalog.pdf.remove(jobId, uid).catch((e: unknown) => reportError('pdf:auftrag-loeschen', e));
  };
  streamFileToResponse(res, pdfPath, cleanUp, req);
}

export function buildPdfRouter(d: Pick<Services, 'jobQueue' | 'catalog' | 'account'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v1');

  router.endpoint('POST /api/v1/sets/partslist-pdf', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const { sets = [], parts = [] } = req.eingabe;
    if (!parts.length) failDomain('ungueltig', 'keine_teile');

    const r = await d.catalog.pdf.start(uid, sets, parts);
    if ('laufend' in r) {
      failDomain('zu_viele', 'pdf_auftrag_laeuft', runningInflection(r.laufend, responseLanguage(req)));
    }

    return { jobId: r.jobId };
  });

  router.endpoint('GET /api/v1/sets/partslist-pdf/status/:jobId', requireToken, async req => {
    const job = await pdfJobReadFor(d, req.pfad.jobId, req.apiUser.user_id);
    if (!job) notFound('job_nicht_gefunden');
    return {
      status: job.status,
      error: job.error || null,
      etaSeconds: job.etaSeconds ?? null,
      missingImages: job.missingImages ?? null,
    };
  });

  // SSE instead of polling; the stream only sends on change.
  router.endpoint(
    'GET /api/v1/sets/partslist-pdf/stream/:jobId',
    requireToken,
    accountGate('strom'),
    async (req, res) => {
      const jobId = req.pfad.jobId;
      const initial = await pdfJobReadFor(d, jobId, req.apiUser.user_id);
      if (!initial) notFound('job_nicht_gefunden');
      const stream = openStream(d.account, req, res, { onlyChanges: true });
      stream.sende(streamStatus(initial));
      if (finished(initial.status)) stream.ende();
      else sequenceJob(d, stream, jobId, req.apiUser.user_id);
    },
  );

  router.endpoint('GET /api/v1/sets/partslist-pdf/download/:jobId', requireToken, async (req, res) => {
    const jobId = req.pfad.jobId;
    const pdfPath = await d.catalog.pdf.finishedFile(jobId, req.apiUser.user_id);
    deliverAndCleanOn(d, req, res, jobId, req.apiUser.user_id, pdfPath);
  });
  return router;
}
