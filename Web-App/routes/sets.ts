
import express from 'express';
import { APP_ROOT, DATA_DIR, IMAGES_DIR } from '../utils/appPaths';
/*
 * Was unter /api/v1/sets nicht im v1-Router steht: CSV-Import samt
 * Fortschritt, Rebrickable-Export, Anlegen mit Fortschrittsstrom und die
 * Anleitungen. Liste, Detail, Ändern und Erfassungen stehen nur dort.
 * Ausführlich: docs/begruendungen/routes/sets.ts.md#router
 */

const router  = express.Router();
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import * as db from '../db/database';
import { handleRouteError, logAndContinue, fehlertext, pfadParam, vorDem, meldeUndLiefere } from '../utils/httpError';
// Der Kern liegt in utils/setService.ts; hier bleiben die
// HTTP-Routen, die ihn rufen.
import { addSet } from '../utils/setService';
import { downloadSetInstructions, anleitungenZuSet, loescheAnleitungen } from '../utils/instructions';
// Der Standard-Zustand eines Benutzers. Stand hier früher als
// `getUserDefaultCondition` — eine wortgleiche Zweitfassung von
// nutzerStandardZustand() in utils/settings.ts.
import {  resolveWriteTarget } from '../utils/household';
import { registerSse } from '../utils/sseRegistry';
import { requireLoginOrToken as requireLogin } from '../utils/auth';
import { importPartsForSet } from '../utils/partsImport';
import { stelleAuftragEin } from '../utils/auftraege';
import { randomUUID } from 'crypto';



// Fortschritt eines Imports: Zustand und Signal
// Der Import-Worker läuft im selben Prozess und meldet bei jedem Fortschritt
// einen Stand je Konto. Der SSE-Endpunkt (/import/csv/stream) weiter unten
// hört darauf und schiebt ihn an die verbundenen Clients (Webapp + Android), …
// Ausführlich: docs/begruendungen/routes/sets.ts.md#abschnitt-2
import {
  csvImportBus, buildJobStatus, emitJobStatus, jobGet, jobSet, jobUpdate,
} from '../utils/importAuftrag';

/**
 * Offene SSE-Verbindungen je Nutzer, für die Obergrenze weiter unten.
 * Ausführlich: docs/begruendungen/routes/sets.ts.md#ssecounts
 */
const _sseCounts = new Map<number, number>();
const MAX_SSE_PER_USER = 6;



// Set-Bilder liegen im Daten-Volume, damit sie einen Container-Neubau
// überstehen; der Web-Pfad /images/sets/… bildet utils/appPaths.ts darauf ab.
const SET_IMAGES_DIR = path.join(IMAGES_DIR, 'sets');
if (!fs.existsSync(SET_IMAGES_DIR)) fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

//  GET /api/sets/import/csv/status — poll import progress (session OR bearer)
//  Zugang zum Fortschrittskanal des CSV-Imports
// Ausführlich: docs/begruendungen/routes/sets.ts.md#abschnitt-3
import { findSetInScope } from '../utils/setAdd';
import { loginOrTokenGuard, angemeldeteNutzerId, istVerwalter } from '../utils/auth';
import { csvEinlesen, entschaerfungRueckgaengig, parseCsvDate, sendCsv, uebersprungenHinweis } from '../utils/csvExport';
import { ausTabelle } from '../utils/validate';
import { csvEmpfang, inhaltPasstZuTyp, uploadKontingentBytes, belegterPlatz } from '../utils/dateiEmpfang';
import { sendeFehler } from '../utils/fehlerTexte';
import { mengeSkalar } from '../utils/bestandsmenge';
import * as pgNotify from '../utils/pgNotify';
import * as V2 from '../utils/validate';
import crypto from 'crypto';

const requireLoginOrToken = loginOrTokenGuard({ timeoutMs: 3000 });

router.get('/import/csv/status', requireLoginOrToken, async (req, res) => {
  const uid = angemeldeteNutzerId(req);
  const job = await jobGet(uid);
  res.json(buildJobStatus(job, req));
});

// ── GET /api/sets/import/csv/stream — persistenter SSE-Kanal ──────────────────
// Bleibt dauerhaft offen (auch wenn kein Import läuft) und sendet bei jeder
// Statusänderung sofort ein Event — sowohl Fortschritt als auch Import-Start.
// Der Client (Android/Webapp) muss damit nicht mehr pollen ob ein Import
// gestartet wurde; er erfährt es im selben Moment.
// Gleiches JSON-Schema wie /status.  Heartbeat alle 20s hält Proxies wach.
router.get('/import/csv/stream', requireLoginOrToken, async (req, res) => {
  const uid = angemeldeteNutzerId(req);

  // Obergrenze offener Streams je Nutzer (siehe _sseCounts oben).
  const openNow = _sseCounts.get(uid) || 0;
  if (openNow >= MAX_SSE_PER_USER) {
    console.warn(`[csv-stream] Nutzer ${uid} hat bereits ${openNow} offene Streams — abgelehnt`);
    return sendeFehler(req, res, 429, 'zu_viele_verbindungen');
  }
  _sseCounts.set(uid, openNow + 1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Beim Herunterfahren muss dieser Strom beendet werden — er bleibt sonst
  // dauerhaft offen und hält httpServer.close() auf (utils/sseRegistry.ts).
  const unregisterSse = registerSse(res);

  let closed = false;
  let lastJson = '';

  const send = (payload: unknown) => {
    if (closed) return;
    const json = JSON.stringify(payload);
    if (json === lastJson) return; // keine Duplikate
    lastJson = json;
    // Gegendruck: Bei einem hängenden Client puffert Node sonst unbegrenzt.
    // false heisst „Puffer voll“ — dann schliessen; beim Neuverbinden kommt
    // der aktuelle Stand ohnehin sofort.
    if (!res.write(`data: ${json}\n\n`)) {
      console.warn(`[csv-stream] Gegendruck bei Nutzer ${uid} — Verbindung wird geschlossen`);
      cleanup();
    }
  };

  // REIHENFOLGE: Erst alles anmelden, DANN den ersten Stand schicken.
  // Ausführlich: docs/begruendungen/routes/sets.ts.md#onprogress

  // 1) Alle zukünftigen Statusänderungen (Import-Start, Fortschritt, Abschluss)
  const onProgress = (status: unknown) => { send(status); };
  csvImportBus.on(`progress:${uid}`, onProgress);

  // 2b) Dasselbe Signal aus ANDEREN Cluster-Workern, per LISTEN/NOTIFY.
  //     Der Payload ist die userId; nur der eigene Nutzer löst ein Nachladen aus.
    const onNotify = async (payload: any) => {
    if (String(payload) !== String(uid)) return;
    send(buildJobStatus(await jobGet(uid).catch(meldeUndLiefere('sets-web:jobGet', null)), req));
  };
  pgNotify.listen('csv_import_progress', onNotify);

  // 3) DB-Fallback alle 10s — fängt verpasste Events ab und dient gleichzeitig
  //    als Erkennung wenn ein Import über einen anderen Prozess/Node gestartet
  //    wurde (kein EventEmitter-Event verfügbar).
  // Der Takt ist von 10 s auf 120 s gestreckt.
  // Ausführlich: docs/begruendungen/routes/sets.ts.md#get-import-csv-stream-fallbacktimer
  const fallbackTimer = setInterval(async () => {
    const s = buildJobStatus(await jobGet(uid).catch(meldeUndLiefere('sets-web:jobGet', null)), req);
    send(s);
  }, 120000);

  // 4) Heartbeat — hält die Verbindung durch Proxies/NAT/Doze offen
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 20000);

  // 5) Jetzt erst den aktuellen Stand schicken — ab hier ist cleanup() sicher.
  // KEIN frühes res.end() wenn kein Import läuft: Die Verbindung bleibt offen.
  send(buildJobStatus(await jobGet(uid).catch(meldeUndLiefere('sets-web:jobGet', null)), req));

  function cleanup() {
    if (closed) return;
    closed = true;
    const left = (_sseCounts.get(uid) || 1) - 1;
    if (left > 0) _sseCounts.set(uid, left); else _sseCounts.delete(uid);
    csvImportBus.off(`progress:${uid}`, onProgress);
    pgNotify.unlisten('csv_import_progress', onNotify);
    clearInterval(fallbackTimer);
    clearInterval(heartbeat);
    unregisterSse();
    res.end();
  }

  req.on('close', cleanup);
});

router.use(requireLogin);



// ── GET /api/sets/export/rebrickable — export all sets in Rebrickable's own
// "Set Number,Quantity" list-import format (see rebrickable.com/help/lists-sets/)
router.get('/export/rebrickable', async (req, res) => {
  try {
    // Die Menge aus den Erfassungen (Migration 0036 hat sets.quantity
    // geloescht). Rebrickable erwartet eine Zeile je Setnummer mit der Anzahl
    // der Exemplare — genau die Summe ueber set_acquisitions.
    const sets = await db.all(
      `SELECT s.set_number, ${mengeSkalar('s')} AS quantity
         FROM sets s WHERE s.user_id=$1 ORDER BY s.set_number ASC`,
      [angemeldeteNutzerId(req)]);
    sendCsv(res, `rebrickable-sets-${new Date().toISOString().substring(0,10)}.csv`,
      ['Set Number', 'Quantity'],
      sets.map(s => ({ 'Set Number': s.set_number, 'Quantity': s.quantity })));
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/sets/:sn/move — Set in ein anderes Konto des Haushalts ─────────
/**
 * Verschiebt ein Set samt seinen Kaufpreis-Erfassungen.
 * Ausführlich: docs/begruendungen/routes/sets.ts.md#abschnitt-4
 */

// GET /api/sets/household-members — Konten für die Auswahl beim Erfassen.
//
// MUSS vor /:setNumber stehen: Express probiert der Reihe nach, und der
// Platzhalter würde "household-members" sonst als Setnummer lesen.




router.post('/add-stream', async (req: LoggedInRequest, res) => {
  const { set_number, quantity=1, purchase_price, condition: setCondition, owner_user_id, storage } = req.body;
  if (!set_number) { sendeFehler(req, res, 400, 'set_number_erforderlich'); return; }
  const streamOwner = await resolveWriteTarget(angemeldeteNutzerId(req), owner_user_id);
  if (streamOwner === null) { sendeFehler(req, res, 403, 'kein_schreibrecht'); return; }
  // Schon im Blickfeld? Dann NICHT die Menge erhöhen (utils/setAdd.ts) — die
  // Oberfläche öffnet die Detailansicht. Die Antwort kommt hier als normales
  // JSON und nicht als Ereignisstrom: Es gibt nichts zu verfolgen, und ein
  // Strom mit genau einem Ereignis wäre für den Client nur Umweg.
  const vorhanden = await findSetInScope(angemeldeteNutzerId(req), set_number);
  if (vorhanden) { res.json({ success:true, action:'exists', ...vorhanden }); return; }
  res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.flushHeaders();
  const unregisterAddSse = registerSse(res);
  let cancelled=false; req.on('close',()=>{cancelled=true;});
  const send = (d: unknown) => { if(!cancelled&&!res.destroyed) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  try {
    // setCondition wurde oben aus dem Body gelesen, aber nicht weitergereicht —
    // der im Formular gewählte Zustand ging dadurch verloren.
        const result = await addSet(set_number, V2.acquisitionQuantity(quantity), streamOwner,
      d=>{ if(cancelled) throw new Error('CANCELLED'); send(d); },
      V2.optionalPrice(purchase_price, 'Kaufpreis'), setCondition, storage);
    // `success: true` gehoert dazu und ist nicht Zierde.
    // Ausführlich: docs/begruendungen/routes/sets.ts.md#post-add-stream
    send({ step:'done', success:true, ...result });
  } catch (e) { if(fehlertext(e)!=='CANCELLED') send({ step:'error', error:fehlertext(e) }); }
  unregisterAddSse();
  res.end();
});

//  CSV Import — polling approach (avoids SSE connection issues)
// Der Job-Zustand steht in PostgreSQL, damit alle Arbeitsprozesse ihn lesen.
// Ausführlich: docs/begruendungen/routes/sets.ts.md#post-import-csv

router.post('/import/csv', csvEmpfang.single('file'), async (req, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const userId = Number(angemeldeteNutzerId(req));

  // Mark any running job as cancelled
  const existing = await jobGet(userId);
  if (existing && existing.status === 'running') {
    await jobUpdate(userId, { status: 'cancelled' });
  }

  // Krumme Zeilen überspringen statt den ganzen Import abzubrechen — siehe
  // csvEinlesen() in utils/csvExport.ts. Vorher kippte eine einzige Zeile mit
  // falscher Spaltenzahl die komplette Datei, mit der rohen Parser-Meldung als
  // Antwort.
  let records, uebersprungen: number[] = [];
  try {
    const gelesen = csvEinlesen(req.file.buffer.toString('utf-8'));
    records = gelesen.records;
    uebersprungen = gelesen.uebersprungen;
  } catch(e) {
    return sendeFehler(req, res, 400, 'csv_parse_fehler', { grund: fehlertext(e) });
  }
  if (!records.length) {
    return res.status(400).json({ success:false,
      error: uebersprungen.length
        ? `Keine brauchbare Zeile gefunden — ${uebersprungenHinweis(uebersprungen)}`
        : 'Keine Datenzeilen in der Datei' });
  }

  records = records.map(row => {
    const norm: any = {};
    // Werte zusätzlich vom Hochkomma befreien, das der eigene Export vor
    // Formelzeichen setzt (utils/csvExport.ts) — sonst käme `'=Test` als
    // Setname zurück.
    for (const [k, v] of Object.entries(row)) {
      norm[k.toLowerCase().trim().replace(/^\uFEFF/, '')] = entschaerfungRueckgaengig(v);
    }
    return norm;
  });

  const rows: any[] = [];
  for (const row of records) {
    const rawSn = row.set_number || row['setnummer'] || row['set'] || Object.values(row)[0];
    const sn = rawSn ? vorDem(String(rawSn), ';').trim() : null;
    if (!sn) continue;
    const rawQty = row.quantity || row['anzahl'] || row['qty'] || row['menge'] || '1';
    const qty = parseInt(String(rawQty).replace(/[^0-9]/g, '') || '1') || 1;
    const rawPrice = row.purchase_price ?? row['kaufpreis'] ?? row['einkaufspreis'] ?? row['price'] ?? '';
    const purchasePrice = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
    const rawCondition = (row.condition || row['zustand'] || row['kondition'] || '').trim().toUpperCase();
    const condition = ['N','U'].includes(rawCondition) ? rawCondition : null;
    // parseCsvDate: 05.03.2026 ist der 5. März, nicht der 3. Mai.
    // `new Date('05.03.2026')` läse es amerikanisch als MM.DD.YYYY.
    const acquiredAt = parseCsvDate(row.acquired_at || row['erfassungsdatum'] || row['datum']);
    rows.push({ sn, qty, purchasePrice: (purchasePrice !== null && !isNaN(purchasePrice)) ? purchasePrice : null, condition, acquiredAt });
  }

  // Der Import läuft als Auftrag im Primär-Worker (jobs/setCsvImport.ts) und
  // übersteht so einen Neustart; die Statuszeile zeigt seinen Fortschritt.
  const lauf = randomUUID();
  await jobSet(userId, {
    status: 'running', total: rows.length, done: 0,
    current: null, results: JSON.stringify([]), error: null, run_id: lauf,
  });
  try {
    await stelleAuftragEin('csv_import', { user_id: userId, lauf, rows }, { userId, maxVersuche: 3 });
  } catch (e) {
    await jobUpdate(userId, { status: 'error', error: fehlertext(e) }, lauf).catch(logAndContinue('csv-import:fehler vermerken'));
    return handleRouteError(res, e, undefined, req);
  }
  await emitJobStatus(userId);

  // Übersprungene Zeilen mitteilen — der Import läuft im Hintergrund weiter,
  // der Hinweis gehört aber in die sofortige Antwort, sonst erfährt niemand
  // davon.
  res.json({ success:true, total: rows.length,
    skipped: uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(uebersprungen) || undefined });
});


// [status endpoint moved before auth middleware]

// ── POST /api/sets/import/csv/cancel — cancel running import ─────────────────
router.post('/import/csv/cancel', requireLogin, async (req, res) => {
  const userId = Number(angemeldeteNutzerId(req));
  await jobUpdate(userId, { status: 'cancelled' }).catch(logAndContinue('csv-import:abbruch vermerken'));
  emitJobStatus(userId);
  res.json({ success:true });
});

// ── Temporary parts list PDF export ─────────────────────────────────────────



// Die Anleitungen sind geteilt: Neu laden darf, wer das Set im Haushalt hat
// (oder der Verwalter) — sonst leerte jeder fremde Sets und verbrauchte das
// Kontingent der Quellen.
router.post('/:setNumber/instructions', async (req, res) => {
  try {
    const sn = req.params.setNumber;
    if (!istVerwalter(req) && !(await findSetInScope(angemeldeteNutzerId(req), sn)))
      return sendeFehler(req, res, 404, 'set_nicht_gefunden');
    await loescheAnleitungen(sn);
    // Download synchronously so we can return the actual results
    await downloadSetInstructions(sn).catch(logAndContinue('sets-web:downloadSetInstructions'));
    const instrs = await anleitungenZuSet(sn);
    res.json({ success: true, instructions: instrs, count: instrs.length });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// LoggedInRequest: liegt hinter dem router.use(requireLogin) weiter oben.
router.post('/:setNumber/parts', async (req: LoggedInRequest, res) => {
  try { const count = await importPartsForSet(pfadParam(req, 'setNumber'), angemeldeteNutzerId(req)); res.json({ success:true, count }); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

// Erlaubte Endungen strikt aus dem MIME-Typ ableiten, NIE aus file.originalname.
// Ausführlich: docs/begruendungen/routes/sets.ts.md#instr-ext-by-mime
const INSTR_EXT_BY_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

const uploadInstr = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => { const dir=path.join(DATA_DIR,'uploads',String(angemeldeteNutzerId(req))); fs.mkdirSync(dir,{recursive:true}); cb(null,dir); },
    filename: (req, file, cb) => {
      const safe = String(req.params.setNumber).replace(/[^a-z0-9-]/gi,'_');
      // ausTabelle statt direktem Zugriff: `INSTR_EXT_BY_MIME['constructor']`
      // lieferte die geerbte Object-Funktion — wahrheitswertig, also kam die
      // Datei am Filter vorbei und landete unter einem Namen aus
      // "function Object() { [native code] }". Siehe utils/validate.ausTabelle.
      const ext  = ausTabelle(INSTR_EXT_BY_MIME, file.mimetype);
      if (!ext) return cb(new Error('Nur PDF, JPG oder PNG'), '');
      // Zufällig statt Zeitstempel: Der Name soll sich nicht erraten lassen.
      cb(null, `${safe}_${crypto.randomBytes(12).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 50*1024*1024 },
  // Derselbe Grund wie oben: Das hier ist das TOR. Ein geerbter Wert liess
  // beliebigen Inhalt an der Zusage "nur PDF, JPG oder PNG" vorbei.
  fileFilter: (_req, file, cb) => { if (ausTabelle(INSTR_EXT_BY_MIME, file.mimetype)) cb(null,true); else cb(new Error('Nur PDF, JPG oder PNG')); }
});
/**
 * Besitz und Kontingent VOR dem Schreiben: Sonst landen bis zu 50 MB auf der
 * Platte, bevor feststeht, dass die Datei gar nicht bleiben darf. Content-Length
 * schliesst die Formularhülle ein, ist also nie kleiner als die Datei.
 */
async function vorDemUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const uid = angemeldeteNutzerId(req);
    // Eine Anleitung gehört zu einem Set des Kontos (Fremdschlüssel, Migration 0058).
    if (!await db.get('SELECT 1 AS ok FROM sets WHERE user_id = $1 AND set_number = $2', [uid, String(req.params.setNumber)]))
      return sendeFehler(req, res, 404, 'nicht_gefunden');
    const ordner = path.join(DATA_DIR, 'uploads', String(uid));
    const belegt = fs.existsSync(ordner) ? belegterPlatz(ordner) : 0;
    const kontingent = uploadKontingentBytes();
    if (belegt + (Number(req.headers['content-length']) || 0) > kontingent)
      return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: Math.round(kontingent / 1024 / 1024) });
    next();
  } catch (e) { handleRouteError(res, e, undefined, req); }
}

router.post('/:setNumber/instructions/upload', vorDemUpload, uploadInstr.single('file'), async (req, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const verwerfen = () => fs.rmSync(req.file!.path, { force: true });
  if (!inhaltPasstZuTyp(req.file.path, req.file.mimetype)) { verwerfen(); return sendeFehler(req, res, 400, 'datei_inhalt_falsch'); }
  // Noch einmal nach dem Schreiben: Ohne Content-Length (chunked) greift die
  // Vorabprüfung nicht.
  const kontingent = uploadKontingentBytes();
  if (belegterPlatz(path.dirname(req.file.path)) > kontingent) {
    verwerfen();
    return sendeFehler(req, res, 413, 'upload_kontingent_voll', { mb: Math.round(kontingent / 1024 / 1024) });
  }
  const uid=angemeldeteNutzerId(req), sn=req.params.setNumber;
  const desc=(req.body.description||req.file.originalname).substring(0,200);
  const relPath=`/data/uploads/${uid}/${req.file.filename}`;
  await db.run('INSERT INTO instructions (user_id,set_number,url,description,local_path) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [uid,sn,relPath,desc,relPath]);
  res.json({ success:true, instruction:{ url:relPath, description:desc, local_path:relPath } });
});

router.delete('/:setNumber/instructions/:instrId', async (req, res) => {
  try {
    const instr = await db.get('SELECT * FROM instructions WHERE id = $1 AND user_id = $2', [req.params.instrId, angemeldeteNutzerId(req)]);
    if (!instr) return sendeFehler(req, res, 404, 'nicht_gefunden');
    await db.run('DELETE FROM instructions WHERE id = $1 AND user_id = $2', [req.params.instrId, angemeldeteNutzerId(req)]);
    // Die DATEI erst löschen, wenn keine andere Zeile mehr darauf zeigt.
    // Ausführlich: docs/begruendungen/routes/sets.ts.md#delete-setnumber-instructions-instrid
    if (instr.local_path?.startsWith('/data/uploads/')) {
      const rest = await db.get('SELECT 1 AS ok FROM instructions WHERE local_path = $1 LIMIT 1',
        [instr.local_path]).catch(() => ({ ok: 1 }));   // im Zweifel behalten
      if (!rest) {
        try { const fp=path.join(APP_ROOT,instr.local_path.slice(1)); if(fs.existsSync(fp))fs.unlinkSync(fp); }
        catch(e){ console.warn('[instructions] Datei konnte nicht gelöscht werden:', fehlertext(e)); }
      }
    }
    res.json({ success:true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// probeBrickInstructions() stand hier: eine dritte Kopie der
// BrickInstructions-Prüfung. Der lebende Weg steht inline in
// fetchInstructions() und in scrapeInstructionsFromFallback(). Entfallen.

export = router;
