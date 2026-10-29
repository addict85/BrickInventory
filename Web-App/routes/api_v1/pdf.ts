/**
 * /api/v1/sets/partslist-pdf — asynchrone PDF-Erzeugung.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#abschnitt
 */
import express from 'express';
import { IMAGES_DIR, PDF_JOB_DIR, resolveWebPath } from '../../utils/appPaths';
import * as db from '../../db/database';
import {  streamFileToResponse, meldeUndWeiter, fehlertext, pfadParam } from '../../utils/httpError';
import { requireToken } from './middleware';
import { registerSse } from '../../utils/sseRegistry';
import _pdfPath from 'path';
import _pdfFs from 'fs/promises';
import _fsSync from 'fs';
import { liesAuftrag, schreibeAuftrag, laufendeAuftraege, loescheAuftrag, raeumeAuftraegeAuf, PDF_KANAL, type PdfAuftrag } from '../../utils/pdfAuftraege';
import { listen, unlisten } from '../../utils/pgNotify';
import { getMinifigInfo } from '../../clients/rebrickable';
import { downloadImage } from '../../jobs/partsCatalogEnrich';
import { mitVersion, ohneVersion } from '../../utils/setNummer';
import { sendeFehler, fehlerText, antwortSprache } from '../../utils/fehlerTexte';
const router = express.Router();

// Eigenes Body-Limit für die PDF-Routen.
//
// server.ts setzt global 256 KB (vorher: 10 MB für ALLE Endpunkte). Der PDF-
// Export bekommt die komplette Teileliste als JSON geschickt und braucht mehr;
// die Ausnahme gilt jetzt aber nur hier statt serverweit.
router.use(express.json({ limit: '10mb' }));

export { PDF_JOB_DIR };

/**
 * Die Bilddatei eines Teils auf der Platte, nur innerhalb des Bildordners.
 * Die Teileliste kommt vom Client; ein `image_local` wie `/data/uploads/7/…`
 * oder `/images/../../…` lese sonst fremde Dateien ins PDF.
 */
export function pdfBildPfad(p: PdfTeil): string | null {
  let src = p.image_local || p.image_url || '';
  const m = src.match(/\/api\/img-proxy\?url=(.+)/);
  if (m) { try { src = decodeURIComponent(m[1] ?? ''); } catch { return null; } }
  const roh = resolveWebPath(src);
  if (!roh) return null;
  const voll = _pdfPath.resolve(roh);
  return voll.startsWith(_pdfPath.resolve(IMAGES_DIR) + _pdfPath.sep) ? voll : null;
}
const PDF_JOB_TTL = 10 * 60 * 1000;
/** Gleichzeitig laufende PDF-Aufträge je Benutzer. */
const MAX_JOBS_PRO_BENUTZER = 2;
/** Abstand des Aufräumlaufs im Primary. */
const PDF_CLEANUP_MS = 60 * 60 * 1000;

/**
 * Stündliches Aufräumen — NUR im Primary starten (server.ts).
 *
 * Vorher hing cleanOldPdfJobs() allein am POST: Wer einen Export abbrach und
 * nie wieder einen startete, liess PDF und Auftragsdatei dauerhaft liegen.
 * Dieselbe Sache wie beim Bild-Cache, der aus demselben Grund aus der
 * Router-Registrierung in den Primary-Block gewandert ist.
 */
function startPdfJobCleanup() {
  cleanOldPdfJobs().catch(() => {});
  const t = setInterval(() => { cleanOldPdfJobs().catch(() => {}); }, PDF_CLEANUP_MS);
  t.unref?.();
  return t;
}

// Vom Server erzeugtes Format: `${Date.now()}-${12 Hex-Zeichen}` — alles andere
// ist ungültig und wird abgewiesen (verhindert Path Traversal über den
// jobId-Param). Das Muster lässt die alte Form (4–10 Zeichen aus [a-z0-9])
// weiter zu, damit Aufträge über ein Update hinweg abrufbar bleiben.
const JOB_ID_RE = /^\d{10,16}-[a-z0-9]{4,12}$/;

/**
 * Auftragskennung.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#abschnitt-2
 */
/**
 * Eine Teilezeile im PDF-Auftrag, soweit hier gelesen.
 *
 * `is_fig` und die zwei Bildfelder entscheiden ueber Nachladen und Layout;
 * mehr braucht diese Datei nicht zu wissen.
 */
type PdfTeil = {
  part_number: string;
  is_fig?: boolean | number | null;
  image_url?: string | null;
  image_local?: string | null;
};

/**
 * Ein Auftragszustand, wie ihn der Ereignisstrom weiterreicht.
 * Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#pdfjobstatus
 */
type PdfJobStatus = { status?: string | undefined; [k: string]: any };

function neueJobId(): string {
  return `${Date.now()}-${require('crypto').randomBytes(6).toString('hex')}`;
}
function validJobId(id: string): boolean { return JOB_ID_RE.test(id); }

// `string`, nicht `unknown`: Alle drei Abrufrouten pruefen vorher mit
// validJobId() gegen JOB_ID_RE (^\d{10,16}-[a-z0-9]{4,12}$) — daher kommt
// hier nie ein Pfadtrenner oder '..' an. Der Typ haelt fest, dass die
// Absicherung OBERHALB liegt und diese Funktion sie nicht wiederholt.
function pdfFilePath(id: string) { return _pdfPath.join(PDF_JOB_DIR, `${id}.pdf`);  }
async function pdfJobRead(id: string) {
  return liesAuftrag(id).catch((e: unknown) => { meldeUndWeiter('pdf:auftrag-lesen', e); return null; });
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
  for (const id of await raeumeAuftraegeAuf(PDF_JOB_TTL).catch((e: unknown) => { meldeUndWeiter('pdf:aufraeumen', e); return []; }))
    await _pdfFs.unlink(pdfFilePath(id)).catch(() => {});
  try {
    const files = await _pdfFs.readdir(PDF_JOB_DIR);
    for (const f of files) {
      try {
        const fp = _pdfPath.join(PDF_JOB_DIR, f);
        const st = await _pdfFs.stat(fp);
        if (Date.now() - st.mtimeMs > PDF_JOB_TTL) await _pdfFs.unlink(fp);
      } catch(_) {}
    }
  } catch(_) {}
}

// schreibeAuftrag() sendet zusätzlich ein NOTIFY; der Statusstrom unten hört
// darauf in jedem Arbeitsprozess.
const pdfJobWriteAndEmit = pdfJobWrite;

// ── POST /api/v1/sets/partslist-pdf — start async PDF job ─────────────────────
router.post('/sets/partslist-pdf', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const { sets = [], parts = [] } = req.body;
  if (!parts.length) return sendeFehler(req, res, 400, 'keine_teile');

  await _pdfFs.mkdir(PDF_JOB_DIR, { recursive: true });

  // Deckel je Benutzer. Ein Auftrag lädt hunderte Bilder nach und baut das PDF
  // im Arbeitsspeicher auf; zehnmal auf den Knopf getippt hiess vorher zehn
  // parallele Läufe in einem Prozess. Aufgeräumt wird nicht mehr hier, sondern
  // stündlich im Primary (startPdfJobCleanup in server.ts) — sonst hing das
  // Aufräumen daran, dass überhaupt jemand ein neues PDF startet.
  const laufend = await laufendeJobs(uid);
  if (laufend >= MAX_JOBS_PRO_BENUTZER) {
    // Die Beugung steht als Platzhalter in der Tabelle, nicht hier: Im
    // Englischen faellt sie anders aus („there is/are", „job/jobs"), und im
    // Satz an anderer Stelle.
    const eins = laufend === 1;
    return sendeFehler(req, res, 429, 'pdf_auftrag_laeuft', {
      anzahl: laufend,
      laufenVerb:  eins ? (antwortSprache(req) === 'en' ? 'is'  : 'läuft')  : (antwortSprache(req) === 'en' ? 'are' : 'laufen'),
      auftragWort: eins ? (antwortSprache(req) === 'en' ? 'job' : 'Auftrag') : (antwortSprache(req) === 'en' ? 'jobs' : 'Aufträge'),
    });
  }

  const jobId = neueJobId();
  // Wartezeit-Schätzung: die Zeit dominiert der Bild-Download (CDN-Limit
  // ~1 neuer Download/Sekunde). Der Job lädt über downloadSetImages (s. u.)
  // genau die im Set-Katalog noch fehlenden Bilder der beteiligten Sets. Wir
  // zählen die DISTINCT Datei-Schlüssel (Teil+Farbe bzw. Figur) mit
  // image_local IS NULL — das entspricht den echten neuen Downloads, da
  // bereits vorhandene Dateien den Rate-Limiter überspringen (existsSync).
  // Fallback bei DB-Fehler: einfache Zählung aus der PDF-Teileliste.
  let missingImages = parts.filter((p: any) => !p.image_local && p.image_url).length;
  try {
    const setKeys = new Set<string>();
    for (const s of (sets || [])) {
      const raw = String(s?.set_number || '').trim();
      if (!raw) continue;
      const n = mitVersion(raw);
      setKeys.add(n);
      setKeys.add(ohneVersion(n)); // alt ohne -N (wie downloadSetImages)
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
  } catch (e: any) {
    console.warn('[PDF job] ETA: Katalog-Zählung fehlgeschlagen, nutze Teileliste:', e?.message);
  }
  const etaSeconds = Math.max(3, Math.round(missingImages * 1.0) + 3);
  await pdfJobWrite(jobId, { status: 'running', error: null, missingImages, etaSeconds, user_id: uid });

  setImmediate(async () => {
    try {
      const setNumbers = (sets || []).map((s: { set_number: string }) => s.set_number).filter(Boolean);
      if (setNumbers.length) {
        const enrich = require('../../jobs/partsCatalogEnrich');

        // For minifigs with null image_url, fetch from Rebrickable API before downloading
        const figsNoUrl = parts.filter((p: PdfTeil) => (p.is_fig || String(p.part_number).startsWith('fig-')) && !p.image_url && !p.image_local);
        if (figsNoUrl.length) {
          for (const p of figsNoUrl) {
            try {
              const info = await getMinifigInfo(p.part_number);
              if (info?.image_url) {
                p.image_url = info.image_url;
                await db.run(
                  `UPDATE set_minifigs_catalog SET image_url=$1 WHERE fig_number=$2 AND image_url IS NULL`,
                  [info.image_url, p.part_number]
                ).catch(() => {});
              }
            } catch (e) { meldeUndWeiter('pdf:teilebild-merken', e); }
          }
        }

        // Download images sequentially per set. waitIfBusy=true: falls ein
        // anderer Cluster-Worker dieselben Bilder gerade lädt, WARTEN bis
        // fertig — sonst würde das PDF mit unvollständigen Bildern erzeugt.
        for (const sn of setNumbers) {
          await enrich.downloadSetImages(sn, true).catch((e: Error) => console.error('[PDF job] download error:', e.message));
        }

        // Reload image_local from DB for parts
        const partNums = [...new Set(parts.filter((p: PdfTeil) => !p.is_fig).map((p: PdfTeil) => p.part_number))];
        if (partNums.length) {
          const fresh = await db.all(
            `SELECT part_number, color_id, image_local FROM set_parts_catalog
             WHERE part_number = ANY($1) AND image_local IS NOT NULL`,
            [partNums]
          ).catch(() => []);
          const freshMap = new Map<string, any>(fresh.map(r => [`${r.part_number}|${r.color_id}`, r.image_local] as [string, any]));
          for (const p of parts) {
            if (p.is_fig) continue;
            const key = `${p.part_number}|${p.color_id||0}`;
            if (freshMap.has(key)) p.image_local = freshMap.get(key);
          }
        }

        // Reload image_local from DB for minifigs
        const figNums = [...new Set(parts.filter((p: PdfTeil) => p.is_fig || String(p.part_number).startsWith('fig-')).map((p: PdfTeil) => p.part_number))];
        if (figNums.length) {
          const fresh = await db.all(
            `SELECT fig_number, image_local FROM set_minifigs_catalog
             WHERE fig_number = ANY($1) AND image_local IS NOT NULL`,
            [figNums]
          ).catch(() => []);
          const freshMap = new Map<string, any>(fresh.map(r => [r.fig_number, r.image_local] as [string, any]));
          // VORHER: _pdfPath.join(__dirname, '..', 'data', 'part_images') — nur EIN
          // '..'. Von routes/api_v1/ aus zeigte das auf routes/data/part_images,
          // ein Verzeichnis, das es nie gab. Die Existenzprüfungen darunter
          // schlugen deshalb immer fehl, und Figurenbilder fielen im PDF still …
          // Ausführlich: docs/begruendungen/routes/api_v1/pdf.ts.md#post-sets-partslist-pdf-img-dir
          const IMG_DIR = require('../../utils/appPaths').MINIFIG_IMAGES_DIR;
          for (const p of parts) {
            const isFig = p.is_fig || String(p.part_number).startsWith('fig-');
            if (!isFig) continue;
            if (freshMap.has(p.part_number)) {
              p.image_local = freshMap.get(p.part_number);
              continue;
            }
            // Filesystem fallback: check disk with expected filename
            if (!p.image_local) {
              const rawUrl = p.image_url?.match(/\/api\/img-proxy\?url=(.+)/)?.[1];
              const cdnUrl = rawUrl ? decodeURIComponent(rawUrl) : (p.image_url || '');
              const ext = (cdnUrl.split('.').pop().split('?')[0] || 'jpg').substring(0, 4).toLowerCase();
              // Try both naming conventions: "fig-009287.jpg" and "fig_009287.jpg"
              const candidates = [
                `${p.part_number.replace(/[^a-z0-9-]/gi, '_')}.${ext}`,
                `${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`,
                `fig_${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`,
              ];
              for (const candidate of candidates) {
                const fp = _pdfPath.join(IMG_DIR, candidate);
                const exists = await _pdfFs.access(fp).then(() => true).catch(() => false);
                if (exists) {
                  const rel = `/images/minifigs/${candidate}`;
                  p.image_local = rel;
                  db.run(`UPDATE set_minifigs_catalog SET image_local=$1 WHERE fig_number=$2`, [rel, p.part_number]).catch(() => {});
                  break;
                }
              }
            }
          }
        }
      }

      // Letzter Fallback: Teile/Figuren, die nach dem Set-Download noch kein
      // lokales Bild haben, aber eine Bild-URL besitzen, einzeln direkt
      // nachladen. Fängt Fälle ab, in denen das Teil nicht im Set-Katalog
      // steht, die Farbe abweicht (z. B. Element-Bild) oder der Set-Download
      // einzelne Bilder verpasst hat — sonst fehlten sie im PDF.
      const stillMissing = parts.filter((p: PdfTeil) => !p.image_local && p.image_url);
      if (stillMissing.length) {
        console.log(`[PDF job] ${jobId}: ${stillMissing.length} Bilder werden einzeln nachgeladen…`);
        for (const p of stillMissing) {
          const rawUrl = p.image_url.match(/\/api\/img-proxy\?url=(.+)/)?.[1];
          const cdnUrl = rawUrl ? decodeURIComponent(rawUrl) : p.image_url;
          if (!/^https?:\/\//.test(cdnUrl)) continue;
          const local = await downloadImage(cdnUrl, p.part_number, p.color_id || 0, 'part').catch(() => null);
          if (local) p.image_local = local;
        }
      }

      const withImg = parts.filter((p: PdfTeil) => p.image_local).length;
      if (withImg < parts.length) {
        console.log(`[PDF job] ${jobId}: ${withImg}/${parts.length} Bilder vorhanden (${parts.length - withImg} ohne Bild)`);
      }

      await buildPdf(sets, parts, pdfFilePath(jobId));
      await pdfJobWriteAndEmit(jobId, { status: 'done', error: null, user_id: uid });
    } catch(e) {
      await pdfJobWriteAndEmit(jobId, { status: 'error', error: fehlertext(e), user_id: uid }).catch(() => {});
      console.error('[PDF job] error:', fehlertext(e));
    }
  });

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
    _pdfFs.unlink(pdfPath).catch(() => {});
    loescheAuftrag(jobId).catch((e: unknown) => meldeUndWeiter('pdf:auftrag-loeschen', e));
  }, req);
});

/**
 * Das PDF als Strom in die Datei — nicht als Puffer im Speicher: Eine grosse
 * Sammlung ergibt viele Megabyte, und zwei Aufträge je Konto liefen sonst
 * vollständig im Arbeitsspeicher. Erst die fertige Datei bekommt ihren Namen.
 */
async function buildPdf(sets: any, parts: any[], ziel: string) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const teil = `${ziel}.teil`;
  const datei = _fsSync.createWriteStream(teil);
  doc.pipe(datei);
  const pdfDone = new Promise((resolve, reject) => {
    datei.on('finish', resolve); datei.on('error', reject); doc.on('error', reject); });

  let _pageNum = 1;
  const PAGE_H = 841.89, PAGE_W = 595.28;

  function addFooter() {
    const savedY = doc.y, savedX = doc.x, savedSize = doc._fontSize;
    const origMargins = doc.page.margins;
    doc.page.margins = { top: 40, left: 40, bottom: 0, right: 40 };
    doc.fontSize(8).fillColor('#94a3b8').text(`Seite ${_pageNum}`, 0, PAGE_H - 28, { width: PAGE_W, align: 'center', lineBreak: false });
    doc.page.margins = origMargins;
    doc.y = savedY; doc.x = savedX; doc.fontSize(savedSize).fillColor('#1e293b');
  }
  function newPage() { addFooter(); _pageNum++; doc.addPage(); doc.y = 40; }

  doc.fontSize(18).font('Helvetica-Bold').text('Teileliste', { align: 'left' });
  doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Sets: ${sets.map((s: { set_number: string }) => s.set_number).join(', ')}`, { align: 'left' });
  doc.moveDown(0.5);
  const totalQty = parts.reduce((s,p) => s + (parseInt(p.quantity)||0), 0);
  doc.fontSize(9).fillColor('#64748b').text(`${parts.length} Teiletypen · ${totalQty.toLocaleString()} Teile total`);
  doc.moveDown(1);

  const deduped: Record<string, any> = {};
  for (const p of parts) {
    const blNum = p.bl_part_number || p.part_number;
    const key = `${blNum}|${p.color_id||p.color_name||0}`;
    if (deduped[key]) deduped[key].quantity = (deduped[key].quantity||0) + (p.quantity||0);
    else deduped[key] = { ...p, part_number: blNum };
  }
  const dedupedParts = Object.values(deduped);

  // Ausgeschrieben: `const colorOrder = []` leitet TypeScript als never[] ab,
  // und jeder Zugriff darauf meldet dann etwas über die Ableitung statt über
  // den Code.
  const colorOrder: string[] = [], byColor: Record<string, any[]> = {};
  for (const p of dedupedParts) {
    // Die Liste einmal holen statt zweimal indizieren: `??=` legt sie an, wenn
    // es sie noch nicht gibt, und liefert sie in beiden Faellen zurueck.
    const liste = byColor[p.color_name] ??= (colorOrder.push(p.color_name), []);
    liste.push(p);
  }
  colorOrder.sort((a, b) => a.localeCompare(b, 'de'));
  for (const color of colorOrder) {
    byColor[color]?.sort((a, b) => (a.bl_part_number || a.part_number || '').localeCompare(b.bl_part_number || b.part_number || '', undefined, { numeric: true }));
  }

  // Bilder je Farbgruppe asynchron vorladen und danach wieder freigeben: Der
  // Event-Loop bleibt frei, und im Speicher liegt nur eine Gruppe, nicht die
  // ganze Sammlung. pdfkit zeichnet synchron aus der Map.
  const _imgFp = pdfBildPfad;
  const imgBufMap = new Map();
  const ladeBilder = async (gruppe: any[]) => {
    imgBufMap.clear();
    const uniqueFps = [...new Set(gruppe.map(_imgFp).filter((fp): fp is string => !!fp))];
    const CHUNK = 32; // begrenzte Parallelität, um File-Descriptor-Limits zu wahren
    for (let i = 0; i < uniqueFps.length; i += CHUNK) {
      const chunk = uniqueFps.slice(i, i + CHUNK);
      const bufs = await Promise.all(chunk.map(fp => _pdfFs.readFile(fp).catch(() => null)));
      chunk.forEach((fp, j) => imgBufMap.set(fp, bufs[j]));
    }
  };

  const COL = { num: 40, name: 200 };
  for (const colorName of colorOrder) {
    // Ein Farbname aus colorOrder hat immer eine Liste — er kam ja beim
    // Anlegen dorthin. `?? []` sagt das dem Pruefer, ohne einen zweiten Fall
    // zu erfinden.
    const colorParts = byColor[colorName] ?? [];
    await ladeBilder(colorParts);
    if (doc.y > 700) newPage();

    const colorPart0 = colorParts[0];
    const hexColor = colorPart0?.color_hex ? '#' + colorPart0.color_hex : '#94a3b8';
    const dotX = 40, dotY = doc.y + 3;
    doc.circle(dotX + 5, dotY + 5, 5).fill(hexColor).fillColor('#1e293b');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(colorName || '(Keine Farbe)', dotX + 14, dotY, { continued: false });
    doc.moveDown(0.2);

    const startX = 40;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b');
    doc.text('Nummer', startX, doc.y, { width: COL.num + 80, continued: false });
    const hy = doc.y - doc.currentLineHeight();
    doc.text('Bezeichnung', startX + COL.num + 80, hy, { width: COL.name, continued: false });
    doc.text('Anz.', startX + COL.num + 80 + COL.name, hy, { width: 50, align: 'right', continued: false });
    doc.moveDown(0.1);
    doc.moveTo(startX, doc.y).lineTo(555, doc.y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.2);

    for (const p of colorParts) {
      const rowHeight = 36;
      if (doc.y > 730 - rowHeight) newPage();
      const rowY = doc.y;

      const fp = _imgFp(p);
      const imgBuf = fp ? (imgBufMap.get(fp) || null) : null;

      const imgOffset = imgBuf ? 36 : 0;
      if (imgBuf) { try { doc.image(imgBuf, startX, rowY, { width: 30, height: 30, fit: [30, 30] }); } catch(_) {} }
      doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
      doc.text(p.bl_part_number || p.part_number, startX + imgOffset, rowY, { width: COL.num + 60 });
      doc.text(p.part_name, startX + imgOffset + COL.num + 60, rowY, { width: COL.name - imgOffset });
      doc.font('Helvetica-Bold').text(String(p.quantity), startX + imgOffset + COL.num + 60 + COL.name - imgOffset, rowY, { width: 50, align: 'right' });
      doc.y = rowY + rowHeight + 2;
    }
    doc.moveDown(0.6);
  }

  addFooter();
  doc.end();
  await pdfDone;
  await _pdfFs.rename(teil, ziel);
}

// GET /api/v1/minifigs/:figNumber/parts — get individual parts for a minifigure

export { startPdfJobCleanup, cleanOldPdfJobs, neueJobId, validJobId };
export default router;
