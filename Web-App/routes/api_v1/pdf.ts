/**
 * /api/v1/sets/partslist-pdf — asynchrone PDF-Erzeugung. Die Route stellt
 * einen Auftrag ein (utils/auftraege.ts); Bilder holt und zeichnet der
 * Primär-Worker (jobs/pdfErzeugung.ts) in einem eigenen Faden.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#abschnitt
 */
import express from 'express';
import crypto from 'crypto';
import { PDF_JOB_DIR } from '../../utils/appPaths';
import * as db from '../../db/database';
import { streamFileToResponse, meldeUndWeiter, meldeUndLiefere, ohneFehlendeDatei, logAndContinue, pfadParam } from '../../utils/httpError';
import { requireToken } from './middleware';
import { registerSse } from '../../utils/sseRegistry';
import _pdfPath from 'path';
import _pdfFs from 'fs/promises';
import _fsSync from 'fs';
import {
  liesAuftrag, schreibeAuftrag, laufendeAuftraege, loescheAuftrag, raeumeAuftraegeAuf, PDF_KANAL,
  gueltigeAuftragsKennung, type PdfAuftrag,
} from '../../utils/pdfAuftraege';
import { stelleAuftragEin } from '../../utils/auftraege';
import { listen, unlisten } from '../../utils/pgNotify';
import { mitVersion, ohneVersion } from '../../utils/setNummer';
import { sendeFehler, fehlerText, antwortSprache } from '../../utils/fehlerTexte';
const router = express.Router();

// Eigenes Body-Limit: Der Export schickt die ganze Teileliste als JSON; die
// Ausnahme vom serverweiten Limit gilt nur hier.
router.use(express.json({ limit: '10mb' }));

export { PDF_JOB_DIR };

const PDF_JOB_TTL = 10 * 60 * 1000;
/** Gleichzeitig laufende PDF-Aufträge je Benutzer. */
const MAX_JOBS_PRO_BENUTZER = 2;
/** Abstand des Aufräumlaufs im Primary. */
const PDF_CLEANUP_MS = 60 * 60 * 1000;

/** Stündliches Aufräumen, nur im Primary (startup/backgroundJobs.ts). */
function startPdfJobCleanup() {
  cleanOldPdfJobs().catch(logAndContinue('pdf:aufraeumen'));
  const t = setInterval(() => { cleanOldPdfJobs().catch(logAndContinue('pdf:aufraeumen')); }, PDF_CLEANUP_MS);
  t.unref?.();
  return t;
}

/**
 * Ein Auftragszustand, wie ihn der Ereignisstrom weiterreicht.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#pdfjobstatus
 */
type PdfJobStatus = { status?: string | undefined; error?: string | null; etaSeconds?: number | null; missingImages?: number | null };

/** Auftragskennung aus kryptografischem Zufall. Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#abschnitt-2 */
function neueJobId(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}
const validJobId = gueltigeAuftragsKennung;

// Alle Abrufrouten prüfen die Kennung vorher mit validJobId(); hier kommt nie
// ein Pfadtrenner oder '..' an.
function pdfFilePath(id: string) { return _pdfPath.join(PDF_JOB_DIR, `${id}.pdf`);  }
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
async function pdfJobWrite(id: string, data: PdfAuftrag) {
  await schreibeAuftrag(id, data);
}
/** Wie viele Aufträge dieses Benutzers laufen gerade? Hängengebliebene zählen nach PDF_JOB_TTL nicht mehr. */
function laufendeJobs(userId: number): Promise<number> {
  return laufendeAuftraege(userId, PDF_JOB_TTL);
}

async function cleanOldPdfJobs() {
  for (const id of await raeumeAuftraegeAuf(PDF_JOB_TTL).catch(meldeUndLiefere('pdf:aufraeumen', [] as string[])))
    await _pdfFs.unlink(pdfFilePath(id)).catch(ohneFehlendeDatei('pdf:datei loeschen'));
  const files = await _pdfFs.readdir(PDF_JOB_DIR).catch((e: unknown) => { ohneFehlendeDatei('pdf:ordner lesen')(e); return [] as string[]; });
  for (const f of files) {
    const fp = _pdfPath.join(PDF_JOB_DIR, f);
    const st = await _pdfFs.stat(fp).catch(ohneFehlendeDatei('pdf:datei pruefen'));
    if (st && Date.now() - st.mtimeMs > PDF_JOB_TTL) await _pdfFs.unlink(fp).catch(ohneFehlendeDatei('pdf:datei loeschen'));
  }
}

// ── POST /api/v1/sets/partslist-pdf — start async PDF job ─────────────────────
router.post('/sets/partslist-pdf', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const { sets = [], parts = [] } = req.body;
  if (!parts.length) return sendeFehler(req, res, 400, 'keine_teile');

  // Deckel je Benutzer: Ein Auftrag lädt hunderte Bilder nach.
  const laufend = await laufendeJobs(uid);
  if (laufend >= MAX_JOBS_PRO_BENUTZER) {
    // Die Beugung steht als Platzhalter in der Tabelle, nicht hier.
    const eins = laufend === 1;
    return sendeFehler(req, res, 429, 'pdf_auftrag_laeuft', {
      anzahl: laufend,
      laufenVerb:  eins ? (antwortSprache(req) === 'en' ? 'is'  : 'läuft')  : (antwortSprache(req) === 'en' ? 'are' : 'laufen'),
      auftragWort: eins ? (antwortSprache(req) === 'en' ? 'job' : 'Auftrag') : (antwortSprache(req) === 'en' ? 'jobs' : 'Aufträge'),
    });
  }

  const jobId = neueJobId();
  // Die Wartezeit hängt am Bild-Download (etwa ein neues Bild je Sekunde):
  // gezählt werden die Bilder der beteiligten Sets, die lokal noch fehlen.
  let missingImages = parts.filter((p: { image_local?: string; image_url?: string }) => !p.image_local && p.image_url).length;
  try {
    const setKeys = new Set<string>();
    for (const s of (sets || [])) {
      const raw = String(s?.set_number || '').trim();
      if (!raw) continue;
      const n = mitVersion(raw);
      setKeys.add(n);
      setKeys.add(ohneVersion(n));
    }
    if (setKeys.size) {
      const rows = await db.all(
        `SELECT
           (SELECT COUNT(*) FROM (
              SELECT DISTINCT part_number, color_id FROM set_parts_catalog
               WHERE set_number = ANY($1) AND image_url IS NOT NULL AND image_local IS NULL
            ) p)
           +
           (SELECT COUNT(*) FROM (
              SELECT DISTINCT fig_number FROM set_minifigs_catalog
               WHERE set_number = ANY($1) AND image_url IS NOT NULL AND image_local IS NULL
            ) f) AS c`,
        [[...setKeys]]
      );
      const c = Number(rows?.[0]?.c);
      if (Number.isFinite(c)) missingImages = c;
    }
  } catch (e) {
    meldeUndWeiter('pdf:wartezeit schaetzen', e);
  }
  const etaSeconds = Math.max(3, Math.round(missingImages * 1.0) + 3);
  await pdfJobWrite(jobId, { status: 'running', error: null, missingImages, etaSeconds, user_id: uid });
  await stelleAuftragEin('pdf', { job_id: jobId, user_id: uid, sets, parts }, { userId: uid, maxVersuche: 2 });
  res.json({ success: true, jobId });
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
  // (utils/sseRegistry.ts) — sonst wartet httpServer.close() auf ihn.
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
  const onStatus = (nutzlast?: string) => { if (!nutzlast || nutzlast === jobId) return pruefe(); };
  listen(PDF_KANAL, onStatus);

  // 3) Rückfall, falls ein Signal während einer Verbindungsstörung verloren geht.
  const fallback = setInterval(pruefe, 15000);

  const heartbeat = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 20000);

  function cleanup() {
    if (closed) return;
    closed = true;
    unlisten(PDF_KANAL, onStatus);
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
  const pdfPath = pdfFilePath(jobId);
  if (!_fsSync.existsSync(pdfPath)) return sendeFehler(req, res, 410, 'pdf_nicht_verfuegbar');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="teileliste.pdf"');
  // streamFileToResponse statt rohem pipe(): Zwischen existsSync oben und dem
  // Öffnen hier kann cleanOldPdfJobs (10-Minuten-TTL) die Datei entfernen —
  // ein Lesestrom-Fehler ohne Zuhörer beendet den Prozess (utils/httpError.ts).
  // Aufgeräumt wird nur bei VOLLSTÄNDIGER Auslieferung.
  streamFileToResponse(res, pdfPath, () => {
    _pdfFs.unlink(pdfPath).catch(ohneFehlendeDatei('pdf:datei loeschen'));
    loescheAuftrag(jobId).catch((e: unknown) => meldeUndWeiter('pdf:auftrag-loeschen', e));
  }, req);
});

export { startPdfJobCleanup, cleanOldPdfJobs, neueJobId, validJobId };
export default router;
