/** Asynchron: Die Route stellt nur einen Auftrag ein; Bilder holt und zeichnet
 * der Job-Prozess in einem eigenen Faden, damit der Web-Prozess frei bleibt.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#abschnitt */
import { meldeFehler, ohneFehlendeDatei } from '../../src/infra/fehler';
import { fehlerAntwort, streamFileToResponse, sendeFehler } from '../../src/http/httpAntwort';
import { requireToken, kontoSchranke } from './middleware';
import { registerSse } from '../../src/http/sseRegistry';
import _pdfFs from 'fs/promises';
import _fsSync from 'fs';
import { liesAuftrag, loescheAuftrag, pdfSchluessel, gueltigeAuftragsKennung, pdfDateiPfad, pdfAuftragStarten } from '../../src/auftraege/pdfAuftraege';
import { beiAuftragsStand } from '../../src/auftraege/dienst';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Anfrage, Antwort } from '../../src/http/vertragsRouter';
const router = vertragsRouter();

type PdfJobStatus = { status?: string | undefined; error?: string | null; etaSeconds?: number | null; missingImages?: number | null };

const validJobId = gueltigeAuftragsKennung;

async function pdfJobRead(id: string) {
  // Ein Lesefehler ist kein unbekannter Auftrag (404): Er geht weiter.
  return liesAuftrag(id);
}

/** Der einzige Weg, auf dem die drei Abrufrouten an einen Auftrag kommen —
 * damit keine die Zugehörigkeit vergisst. */
async function pdfJobReadFor(id: string, userId: number) {
  const job = await pdfJobRead(id);
  if (!job) return null;
  if (job.user_id !== userId) return null;
  return job;
}
router.post('/sets/partslist-pdf', requireToken, async (req: Anfrage<'POST /api/v1/sets/partslist-pdf'>, res: Antwort<'POST /api/v1/sets/partslist-pdf'>) => {
  const uid = req.apiUser.user_id;
  const { sets = [], parts = [] } = req.eingabe;
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

router.get('/sets/partslist-pdf/status/:jobId', requireToken, async (req: Anfrage<'GET /api/v1/sets/partslist-pdf/status/:jobId'>, res: Antwort<'GET /api/v1/sets/partslist-pdf/status/:jobId'>) => {
  if (!validJobId(req.pfad.jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
  const job = await pdfJobReadFor(req.pfad.jobId, req.apiUser.user_id);
  if (!job) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
  res.json({ success: true, status: job.status, error: job.error || null, etaSeconds: job.etaSeconds ?? null, missingImages: job.missingImages ?? null });
});

// SSE statt Polling; der Rückfall sendet nur bei Änderung.
router.get('/sets/partslist-pdf/stream/:jobId', requireToken, kontoSchranke('strom'), async (req: Anfrage<'GET /api/v1/sets/partslist-pdf/stream/:jobId'>, res) => {
  const jobId = req.pfad.jobId;
  if (!validJobId(jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
  const initial = await pdfJobReadFor(jobId, req.apiUser.user_id);
  if (!initial) return sendeFehler(req, res, 404, 'job_nicht_gefunden');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Anmelden, sonst wartet httpServer.close() beim Herunterfahren auf diesen Strom.
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

  send({ status: initial.status, error: initial.error || null, etaSeconds: initial.etaSeconds ?? null, missingImages: initial.missingImages ?? null });
  if (isDone(initial.status)) { closed = true; unregisterSse(); return res.end(); }

  // NOTIFY, gleich in welchem Prozess der Auftrag läuft; ohne Nutzlast (beim
  // Wiederverbinden) wird ebenfalls nachgesehen.
  const pruefe = async () => {
    const job = await pdfJobReadFor(jobId, req.apiUser.user_id);
    if (closed) return;
    if (!job) { cleanup(); return; }
    send({ status: job.status, error: job.error || null });
    if (isDone(job.status)) cleanup();
  };
  const onStatus = (nutzlast?: string) => { if (!nutzlast || nutzlast === pdfSchluessel(jobId)) return pruefe(); };
  const abmelden = beiAuftragsStand(onStatus);

  // Rückfall, falls ein Signal während einer Verbindungsstörung verloren geht.
  const fallback = setInterval(pruefe, 15000);

  const heartbeat = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);

  function cleanup() {
    if (closed) return;
    closed = true;
    abmelden();
    clearInterval(fallback);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }

  req.on('close', cleanup);
});

router.get('/sets/partslist-pdf/download/:jobId', requireToken, async (req: Anfrage<'GET /api/v1/sets/partslist-pdf/download/:jobId'>, res) => {
  const jobId = req.pfad.jobId;
  if (!validJobId(jobId)) return sendeFehler(req, res, 400, 'job_id_ungueltig');
  const job = await pdfJobReadFor(jobId, req.apiUser.user_id);
  if (!job) return sendeFehler(req, res, 404, 'job_nicht_gefunden');
  if (job.status !== 'done') {
    // `status` zeigt der Oberfläche, wie weit der Auftrag ist; sendeFehler kennt das Feld nicht.
    return res.status(409).json({ success: false, code: 'pdf_nicht_fertig',
      error: fehlerText('pdf_nicht_fertig', antwortSprache(req)), status: job.status });
  }
  const pdfPath = pdfDateiPfad(jobId);
  if (!pdfPath || !_fsSync.existsSync(pdfPath)) return sendeFehler(req, res, 410, 'pdf_nicht_verfuegbar');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="teileliste.pdf"');
  // streamFileToResponse statt pipe(): Das Aufräumen kann die Datei zwischen
  // Prüfung und Öffnen entfernen, und ein Lesestrom-Fehler ohne Zuhörer beendet
  // den Prozess. Aufgeräumt wird nur nach vollständiger Auslieferung.
  streamFileToResponse(res, pdfPath, () => {
    _pdfFs.unlink(pdfPath).catch(ohneFehlendeDatei('pdf:datei loeschen'));
    loescheAuftrag(jobId).catch((e: unknown) => meldeFehler('pdf:auftrag-loeschen', e));
  }, req);
});

router.use(fehlerAntwort);

export default router;
