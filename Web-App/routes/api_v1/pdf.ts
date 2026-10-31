/**
 * /api/v1/sets/partslist-pdf — asynchrone PDF-Erzeugung. Die Route stellt
 * einen Auftrag ein (src/auftraege/auftraege.ts); Bilder holt und zeichnet der
 * Job-Prozess (jobs/pdfErzeugung.ts) in einem eigenen Faden.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#abschnitt
 */
import express from 'express';
import { fehlerAntwort, streamFileToResponse, meldeUndWeiter, meldeUndLiefere, ohneFehlendeDatei, pfadParam } from '../../src/infra/httpError';
import { requireToken } from './middleware';
import { registerSse } from '../../src/infra/sseRegistry';
import _pdfFs from 'fs/promises';
import _fsSync from 'fs';
import { liesAuftrag, loescheAuftrag, pdfSchluessel, gueltigeAuftragsKennung, pdfDateiPfad, pdfAuftragStarten } from '../../src/auftraege/pdfAuftraege';
import { AUFTRAG_STAND_KANAL } from '../../src/auftraege/dienst';
import { listen, unlisten } from '../../db/pgNotify';
import { sendeFehler, fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
const router = express.Router();

// Eigenes Body-Limit: Der Export schickt die ganze Teileliste als JSON; die
// Ausnahme vom serverweiten Limit gilt nur hier.
router.use(express.json({ limit: '10mb' }));

/**
 * Ein Auftragszustand, wie ihn der Ereignisstrom weiterreicht.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#pdfjobstatus
 */
type PdfJobStatus = { status?: string | undefined; error?: string | null; etaSeconds?: number | null; missingImages?: number | null };

const validJobId = gueltigeAuftragsKennung;

async function pdfJobRead(id: string) {
  return liesAuftrag(id).catch(meldeUndLiefere('pdf:auftrag-lesen', null));
}

/**
 * Auftrag lesen UND die Zugehörigkeit prüfen — der einzige Weg, auf dem die
 * drei Abrufrouten an einen Auftrag kommen.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#pdfjobreadfor
 */
async function pdfJobReadFor(id: string, userId: number) {
  const job = await pdfJobRead(id);
  if (!job) return null;
  if (job.user_id !== userId) return null;
  return job;
}
// ── POST /api/v1/sets/partslist-pdf — start async PDF job ─────────────────────
router.post('/sets/partslist-pdf', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const { sets = [], parts = [] } = req.body;
  if (!parts.length) return sendeFehler(req, res, 400, 'keine_teile');

  const r = await pdfAuftragStarten(uid, sets, parts);
  if ('laufend' in r) {
    const laufend = r.laufend;
    // Die Beugung steht als Platzhalter in der Tabelle, nicht hier.
    const eins = laufend === 1;
    return sendeFehler(req, res, 429, 'pdf_auftrag_laeuft', {
      anzahl: laufend,
      laufenVerb:  eins ? (antwortSprache(req) === 'en' ? 'is'  : 'läuft')  : (antwortSprache(req) === 'en' ? 'are' : 'laufen'),
      auftragWort: eins ? (antwortSprache(req) === 'en' ? 'job' : 'Auftrag') : (antwortSprache(req) === 'en' ? 'jobs' : 'Aufträge'),
    });
  }

  res.json({ success: true, jobId: r.jobId });
});

// ── GET /api/v1/sets/partslist-pdf/status/:jobId ──────────────────────────────
router.get('/sets/partslist-pdf/status/:jobId', requireToken, async (req: AuthedRequest, res) => {
  if (!validJobId(String(req.params.jobId))) return sendeFehler(req, res, 400, 'job_id_ungueltig');
  const job = await pdfJobReadFor(pfadParam(req, 'jobId'), req.apiUser.user_id);
  if (!job) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
  res.json({ success: true, status: job.status, error: job.error || null, etaSeconds: job.etaSeconds ?? null, missingImages: job.missingImages ?? null });
});

// ── GET /api/v1/sets/partslist-pdf/stream/:jobId — SSE statt Polling ──────────
// Sendet den aktuellen Stand sofort und schließt sich, sobald der Job
// done/error ist. Der Fallback-Poll (Cluster: Job kann auf anderem Worker
// laufen) sendet nur noch bei *Änderung* — vorher bekam jeder Client alle
// 3s ein redundantes Event mit unverändertem Status.
router.get('/sets/partslist-pdf/stream/:jobId', requireToken, async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId);
  if (!validJobId(jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
  const initial = await pdfJobReadFor(jobId, req.apiUser.user_id);
  if (!initial) return sendeFehler(req, res, 404, 'job_nicht_gefunden');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Anmelden, damit das Herunterfahren diesen Strom beenden kann
  // (src/infra/sseRegistry.ts) — sonst wartet httpServer.close() auf ihn.
  const unregisterSse = registerSse(res);

  let closed = false;
  let lastSent = '';
  const send = (data: PdfJobStatus) => {
    if (closed) return;
    const payload = JSON.stringify(data);
    if (payload === lastSent) return;   // Duplikate unterdrücken
    lastSent = payload;
    res.write(`data: ${payload}\n\n`);
  };
  const isDone = (s: string | undefined) => s === 'done' || s === 'error';

  // 1) Sofort aktuellen Stand senden
  send({ status: initial.status, error: initial.error || null, etaSeconds: initial.etaSeconds ?? null, missingImages: initial.missingImages ?? null });
  if (isDone(initial.status)) { closed = true; unregisterSse(); return res.end(); }

  // 2) Auf das NOTIFY hören — gleich in welchem Prozess der Auftrag läuft.
  //    Ohne Nutzlast (beim Wiederverbinden) wird ebenfalls nachgesehen.
  const pruefe = async () => {
    const job = await pdfJobReadFor(jobId, req.apiUser.user_id);
    if (closed) return;
    if (!job) { cleanup(); return; }
    send({ status: job.status, error: job.error || null });
    if (isDone(job.status)) cleanup();
  };
  const onStatus = (nutzlast?: string) => { if (!nutzlast || nutzlast === pdfSchluessel(jobId)) return pruefe(); };
  listen(AUFTRAG_STAND_KANAL, onStatus);

  // 3) Rückfall, falls ein Signal während einer Verbindungsstörung verloren geht.
  const fallback = setInterval(pruefe, 15000);

  const heartbeat = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);

  function cleanup() {
    if (closed) return;
    closed = true;
    unlisten(AUFTRAG_STAND_KANAL, onStatus);
    clearInterval(fallback);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }

  req.on('close', cleanup);
});

// ── GET /api/v1/sets/partslist-pdf/download/:jobId ────────────────────────────
router.get('/sets/partslist-pdf/download/:jobId', requireToken, async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId);
  if (!validJobId(jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
  const job = await pdfJobReadFor(jobId, req.apiUser.user_id);
  if (!job) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
  if (job.status !== 'done') {
    // `status` haengt zusaetzlich dran — die Oberflaeche zeigt daran, WIE weit
    // der Auftrag ist. sendeFehler kennt das Feld nicht.
    return res.status(409).json({ success: false, code: 'pdf_nicht_fertig',
      error: fehlerText('pdf_nicht_fertig', antwortSprache(req)), status: job.status });
  }
  const pdfPath = pdfDateiPfad(jobId);
  if (!pdfPath || !_fsSync.existsSync(pdfPath)) return sendeFehler(req, res, 410, 'pdf_nicht_verfuegbar');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="teileliste.pdf"');
  // streamFileToResponse statt rohem pipe(): Zwischen existsSync oben und dem
  // Öffnen hier kann cleanOldPdfJobs (10-Minuten-TTL) die Datei entfernen —
  // ein Lesestrom-Fehler ohne Zuhörer beendet den Prozess (src/infra/httpError.ts).
  // Aufgeräumt wird nur bei VOLLSTÄNDIGER Auslieferung.
  streamFileToResponse(res, pdfPath, () => {
    _pdfFs.unlink(pdfPath).catch(ohneFehlendeDatei('pdf:datei loeschen'));
    loescheAuftrag(jobId).catch((e: unknown) => meldeUndWeiter('pdf:auftrag-loeschen', e));
  }, req);
});

router.use(fehlerAntwort);

export default router;
