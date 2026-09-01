
import express from 'express';
import { APP_ROOT, DATA_DIR, PUBLIC_DIR, IMAGES_DIR , INSTRUCTIONS_DIR} from '../utils/appPaths';
/*
 * ── Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts ──
 *
 * Marcos Vorgabe (Nachtrag 70): „Können die beiden Apps nicht die gleichen APIs
 * nutzen (mit unterschiedlichen Authentifizierungsarten), damit die Logik nur
 * einmal implementiert werden muss und das Verhalten immer gleich ist?"
 *
 * Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
 * doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
 * den Token der App. Aus dieser Doppelung stammen nachweislich sechs der
 * letzten Fehlermeldungen — Kaufpreis, Menge, Löschen, Erfassungen im Haushalt,
 * Preisauffüllung, und zuletzt zwei verschiedene Marktpreise für denselben
 * Vorgang (18.90 gegen 12.55).
 *
 * Möglich wurde der Schnitt, weil requireToken in routes/api_v1/middleware.ts
 * BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER Bearer-Token. Es brauchte
 * also keine neue Schicht, nur das Entfernen der Zweitfassung. Die Webapp ruft
 * jetzt /api/v1/... — dieselbe Adresse wie die App.
 */

/*
 * ── Zusammengelegt mit der v1-Fabrik (Nachtrag 74, letzte Etappe) ───────────
 *
 * Sieben Routen standen hier doppelt — Liste, Detail, Anlegen, Ändern,
 * Löschen, Eigentümerwechsel und Haushaltsmitglieder. Sie sind entfernt; beide
 * Clients rufen /api/v1/sets/…, weil requireToken BEIDE Ausweise akzeptiert.
 *
 * Vor dem Entfernen alle Paare gemessen (Antwort UND vollständiger
 * Datenbankzustand, lesend wie schreibend): identisch. Einziger Unterschied:
 * Die Liste nennt zusätzlich `count` — ein Feld MEHR, keines fehlt.
 *
 * HIER GEBLIEBEN, und zwar mit Absicht:
 *   • add-stream, import/csv samt Status/Abbruch/Strom — diese Wege schicken
 *     laufend Fortschritt (SSE) statt einer einzelnen Antwort und hängen an der
 *     Oberfläche der Webapp
 *   • instructions (Anlegen, Hochladen, Löschen) und /:setNumber/parts —
 *     Datei-Uploads, die es nur hier gibt
 *   • info/:setNumber, export/csv, export/rebrickable — je nur an einem Ort
 * Alles davon existiert NUR einmal und kann daher nicht auseinanderlaufen.
 */

const router  = express.Router();
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { DEFAULT_PRICE_CONDITION } from '../utils/financeCalc';
import path from 'path';
import fs from 'fs';
import https from 'https';

import * as db from '../db/database';
import { handleRouteError, logAndContinue, fehlertext } from '../utils/httpError';
import { downloadSetImage } from '../utils/setImages';
// Der Kern liegt seit Nachtrag 131 in utils/setService.ts; hier bleiben die
// HTTP-Routen, die ihn rufen.
import { addSet, updateSet, buildSetsCsv, recordAcquisition, sanitizeSetNumber, addSetWithDate } from '../utils/setService';
import { downloadSetInstructions, scrapeInstructionsFromFallback } from '../utils/instructions';
import { getCurrentMarketPrice } from '../utils/marketPrice';
// Der Standard-Zustand eines Benutzers. Stand hier bis Nachtrag 125 als
// `getUserDefaultCondition` — eine wortgleiche Zweitfassung von
// effectiveCondition() in utils/settings.ts.
import { effectiveCondition as userDefaultCondition } from '../utils/settings';
import { recordAcquisitionForDay, findSameDayAcquisition } from '../utils/acquisitions';
import { moveSetBetweenAccounts } from '../utils/setMove';
import { acquisitionMoveSource, canWriteFor, householdMembers, resolveWriteTarget, parseScopeMode, writableIds } from '../utils/household';
import { registerSse } from '../utils/sseRegistry';
import { getItemImageUrl } from '../clients/bricklink';
import { getSetInfo, downloadFile, scrapeInstructions, sleep, httpsGetRobust } from '../clients/rebrickable';
import * as brickset from '../clients/brickset';
import { requireLogin } from './auth';
import { withInventoryLock } from '../utils/txLock';
import { importPartsForSet } from './parts';
import { importMinifigsForSet } from './minifigs';
import { refreshPriceForSet } from '../jobs/priceJob';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ── CSV-Import Fortschritt: In-Process Event-Bus ──────────────────────────────
// Der Import-Worker läuft im selben Prozess und feuert bei jedem Fortschritt
// ein Event pro User. Der SSE-Endpoint (/import/csv/stream) hört darauf und
// schiebt den Stand an verbundene Clients (Webapp + Android), ganz ohne
// Polling. Der bestehende /status-Endpoint bleibt als Fallback erhalten.
import EventEmitter from 'events';
const csvImportBus = new EventEmitter();
csvImportBus.setMaxListeners(0); // beliebig viele gleichzeitige Streams

/**
 * Offene SSE-Verbindungen je Nutzer, für die Obergrenze weiter unten.
 *
 * Der Stream bleibt dauerhaft offen — auch wenn gar kein Import läuft. Ohne
 * Obergrenze belegt ein Client mit fehlerhafter Reconnect-Schleife (oder ein
 * Nutzer mit zwanzig Tabs) beliebig viele Sockets und Timer im Worker, und
 * jede Verbindung hängt zusätzlich am NOTIFY-Kanal. Sechs ist grosszügig für
 * den realistischen Fall: ein paar Browser-Tabs plus die Android-App.
 */
const _sseCounts = new Map<number, number>();
const MAX_SSE_PER_USER = 6;



// Set-Bilder liegen seit der Umstellung im DATEN-Volume statt in public/ —
// sonst sind sie nach jedem Container-Rebuild weg und werden einzeln neu vom
// CDN geholt. Der Web-Pfad "/images/sets/…" bleibt unverändert; die Zuordnung
// macht utils/appPaths.ts. Eigener Name, weil IMAGES_DIR dort das
// Elternverzeichnis meint.
const SET_IMAGES_DIR = path.join(IMAGES_DIR, 'sets');
if (!fs.existsSync(SET_IMAGES_DIR)) fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

// Looks up the current BrickLink market price for a set (qty-weighted average,
// falling back to plain average). Used to default the purchase price when the
// user does not provide one manually. Returns null if no price is available
// (e.g. missing BrickLink credentials or set unknown to BrickLink).


// Mengen-Änderung über den Detail-Dialog auf die Historie abbilden:
// Erhöhung → Tageszeile aufstocken oder anlegen (recordAcquisitionForDay);
// Reduktion → LIFO von den letzten Erfassungen abziehen (Zeilen, die auf 0
// fallen, werden gelöscht).
//
// Die frühere Hilfsfunktion isToday() ist entfallen: Die Tagesprüfung gehört
// an eine Stelle, und das ist utils/acquisitions.ts.

// ── GET /api/sets/import/csv/status — poll import progress (session OR bearer) ─
// ── Zugang zum Fortschrittskanal des CSV-Imports ────────────────────────────
//
// Hier stand eine EIGENE Fassung von requireLoginOrToken, die ?token=
// bedingungslos akzeptierte. Der Bedarf ist echt — EventSource kann keine
// Kopfzeilen setzen —, die zweite Fassung war es nicht: utils/auth.ts pflegt
// eine Liste der Pfade, auf denen ein Token in der URL reiten darf, und
// schreibt dazu „alles andere verlangt einen Authorization-Header". Genau das
// stimmte wegen dieser Datei nicht, ohne dass man es dort sieht.
//
// Jetzt stehen /import/csv/stream und /status in TOKEN_QUERY_ALLOWED, und die
// Prüfung kommt von der zentralen Stelle. Das 3s-Zeitlimit bleibt: Während
// eines Imports kann die Datenbank ausgelastet sein, und ein Client, der 503
// bekommt, versucht es gleich wieder — besser als eine hängende Verbindung.
import { scopeIds } from '../utils/household';
import { findSetInScope } from '../utils/setAdd';
import { loginOrTokenGuard } from '../utils/auth';
import { csvEinlesen, entschaerfungRueckgaengig, parseCsvDate, sendCsv, sendCsvText, uebersprungenHinweis } from '../utils/csvExport';
import { ausTabelle } from '../utils/validate';

const requireLoginOrToken = loginOrTokenGuard({ timeoutMs: 3000 });

// Baut das Status-Objekt aus einem Job-Datensatz — gemeinsam genutzt von
/**
 * Ein Ergebnis je Set im CSV-Import — nur die drei Felder, nach denen hier
 * gezaehlt wird. `isWarning` trennt „hat nicht geklappt" von „ist eine
 * Anmerkung"; ohne die Unterscheidung stuende jede Anmerkung als Fehler da.
 */
type ImportErgebnis = { success?: boolean; isWarning?: boolean; [k: string]: any };

/** Ein Auftragsdatensatz aus import_jobs, soweit buildJobStatus ihn liest. */
type ImportAuftrag = {
  status?: string | null;
  total?: number | null;
  done?: number | null;
  current?: string | null;
  error?: string | null;
  results?: ImportErgebnis[] | null;
} | null | undefined;

// /status (Polling-Fallback) und /stream (SSE).
function buildJobStatus(job: ImportAuftrag) {
  if (!job || !job.status) return { success: false, error: 'Kein Import läuft' };
  const results = Array.isArray(job.results) ? job.results : [];
  const ok   = results.filter((r: ImportErgebnis)=>r.success).length;
  const err  = results.filter((r: ImportErgebnis)=>!r.success && !r.isWarning).length;
  const warn = results.filter((r: ImportErgebnis)=>!r.success &&  r.isWarning).length;
  return {
    success: true,
    status:  job.status,
    total:   job.total  || 0,
    done:    job.done   || 0,
    current: job.current || null,
    ok, err, warn,
    results,
    error:   job.error  || null,
  };
}

// Wird vom Import-Worker nach jedem jobUpdate aufgerufen: liest den frischen
// Stand und feuert ihn an alle SSE-Listener dieses Users.
async function emitJobStatus(userId: number) {
  try {
    const job = await jobGet(userId);
    csvImportBus.emit(`progress:${userId}`, buildJobStatus(job));
  } catch (_) { /* Fortschritt geht notfalls über den Nachzieh-Timer im Stream */ }
  // Über Prozessgrenzen hinweg signalisieren.
  //
  // csvImportBus ist ein prozesslokaler EventEmitter — im Cluster sieht ihn nur
  // der Worker, der den Import ausführt. Ein Client, dessen SSE-Verbindung in
  // einem ANDEREN Worker liegt, bekam davon nichts mit; deshalb gab es einen
  // 10-Sekunden-Poller auf die Datenbank, dauerhaft, pro offener Verbindung.
  // LISTEN/NOTIFY erledigt genau das, wofür der Poller da war — und die
  // Infrastruktur dafür steht bereits (utils/pgNotify.ts).
  require('../utils/pgNotify').notify('csv_import_progress', String(userId)).catch(() => {});
}

router.get('/import/csv/status', requireLoginOrToken, async (req, res) => {
  const uid = req.tokenUserId || Number(req.session.userId);
  const job = await jobGet(uid);
  res.json(buildJobStatus(job));
});

// ── GET /api/sets/import/csv/stream — persistenter SSE-Kanal ──────────────────
// Bleibt dauerhaft offen (auch wenn kein Import läuft) und sendet bei jeder
// Statusänderung sofort ein Event — sowohl Fortschritt als auch Import-Start.
// Der Client (Android/Webapp) muss damit nicht mehr pollen ob ein Import
// gestartet wurde; er erfährt es im selben Moment.
// Gleiches JSON-Schema wie /status.  Heartbeat alle 20s hält Proxies wach.
router.get('/import/csv/stream', requireLoginOrToken, async (req, res) => {
  const uid = req.tokenUserId || Number(req.session.userId);

  // Obergrenze offener Streams je Nutzer (siehe _sseCounts oben).
  const openNow = _sseCounts.get(uid) || 0;
  if (openNow >= MAX_SSE_PER_USER) {
    console.warn(`[csv-stream] Nutzer ${uid} hat bereits ${openNow} offene Streams — abgelehnt`);
    return res.status(429).json({ success: false, error: 'Zu viele offene Verbindungen' });
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
    // Rückgabewert auswerten (Gegendruck).
    //
    // Bei einem hängenden Client — Handy im Funkloch, halb tote Verbindung —
    // puffert Node sonst unbegrenzt im Speicher des Workers, bis TCP irgendwann
    // aufgibt. false heisst: der Puffer läuft voll. Dann ist Schliessen die
    // richtige Antwort; der Client baut die Verbindung neu auf und bekommt beim
    // Verbinden ohnehin sofort den aktuellen Stand geschickt.
    if (!res.write(`data: ${json}\n\n`)) {
      console.warn(`[csv-stream] Gegendruck bei Nutzer ${uid} — Verbindung wird geschlossen`);
      cleanup();
    }
  };

  // REIHENFOLGE: Erst alles anmelden, DANN den ersten Stand schicken.
  //
  // Vorher stand `send(initial)` hier oben — vor onProgress, onNotify und den
  // beiden Zeitgebern. Meldet der Client beim allerersten Schreiben Gegendruck
  // (Handy im Funkloch, halb tote Verbindung), ruft send() sofort cleanup()
  // auf. Das greift auf `onProgress` zu, das als const erst weiter unten
  // entsteht — und die Anfrage endete mit
  // „ReferenceError: Cannot access 'onProgress' before initialization",
  // also mit einem 500er statt mit einem sauber geschlossenen Strom. Im
  // Protokoll standen beide Zeilen direkt hintereinander: erst der
  // Gegendruck-Hinweis, dann der Fehler.

  // 1) Alle zukünftigen Statusänderungen (Import-Start, Fortschritt, Abschluss)
  const onProgress = (status: unknown) => { send(status); };
  csvImportBus.on(`progress:${uid}`, onProgress);

  // 2b) Dasselbe Signal aus ANDEREN Cluster-Workern, per LISTEN/NOTIFY.
  //     Der Payload ist die userId; nur der eigene Nutzer löst ein Nachladen aus.
  const pgNotify = require('../utils/pgNotify');
  const onNotify = async (payload: any) => {
    if (String(payload) !== String(uid)) return;
    send(buildJobStatus(await jobGet(uid).catch(() => null)));
  };
  pgNotify.listen('csv_import_progress', onNotify);

  // 3) DB-Fallback alle 10s — fängt verpasste Events ab und dient gleichzeitig
  //    als Erkennung wenn ein Import über einen anderen Prozess/Node gestartet
  //    wurde (kein EventEmitter-Event verfügbar).
  // Der Takt ist von 10 s auf 120 s gestreckt.
  //
  // Er war der EINZIGE Weg, wie ein Client Fortschritt aus einem anderen
  // Worker erfuhr — deshalb so eng. Diese Aufgabe hat jetzt LISTEN/NOTIFY
  // (2b). Übrig bleibt die Rolle als Netz für den einen Fall, den NOTIFY nicht
  // abdeckt: ein Signal, das während einer Verbindungstrennung zur Datenbank
  // gesendet wurde, ist verloren. Zwei Minuten reichen dafür völlig.
  //
  // Rechnung: Bei drei offenen Verbindungen (zwei Tabs + Android) waren das
  // vorher rund 26'000 Abfragen pro Tag, dauerhaft, auch wenn nie ein Import
  // läuft. Jetzt sind es gut 2'000.
  const fallbackTimer = setInterval(async () => {
    const s = buildJobStatus(await jobGet(uid).catch(() => null));
    send(s);
  }, 120000);

  // 4) Heartbeat — hält die Verbindung durch Proxies/NAT/Doze offen
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 20000);

  // 5) Jetzt erst den aktuellen Stand schicken — ab hier ist cleanup() sicher.
  // KEIN frühes res.end() wenn kein Import läuft: Die Verbindung bleibt offen.
  send(buildJobStatus(await jobGet(uid).catch(() => null)));

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

// ── Routes ────────────────────────────────────────────────────────────────────
// ── GET /api/sets/info/:setNumber — lightweight name lookup from shared catalog ─
// Used by the Teileliste to resolve set names without requiring user ownership.
router.get('/info/:setNumber', requireLogin, async (req, res) => {
  const n = req.params.setNumber.includes('-')
    ? req.params.setNumber
    : req.params.setNumber + '-1';
  try {
    const row = await db.get(
      'SELECT name, year, theme, pieces, image_url, image_local FROM set_catalog WHERE set_number = $1',
      [n]
    );
    if (row) return res.json({ success: true, set_number: n, name: row.name || n, ...row });
    // Not in catalog yet — try the user's own sets table as fallback
    const own = await db.get(
      'SELECT name, year, theme, pieces, image_url, image_local FROM sets WHERE set_number = $1 AND user_id = $2',
      [n, req.session.userId]
    );
    if (own) return res.json({ success: true, set_number: n, name: own.name || n, ...own });
    // Unknown set — return the number itself as name
    res.json({ success: true, set_number: n, name: n });
  } catch (e) { handleRouteError(res, e); }
});

router.use(requireLogin);


// ── GET /api/sets/export/csv — export all sets for re-import with the Sets CSV importer
// LoggedInRequest: Die Route liegt hinter dem router.use(requireLogin) direkt
// darueber. (Die drei Routen OBERHALB tragen ihre eigene Absicherung —
// requireLoginOrToken bzw. requireLogin —, die Platzierung ist Absicht.)
router.get('/export/csv', async (req: LoggedInRequest, res) => {
  try {
    const csv = await buildSetsCsv(req.session.userId);
    sendCsvText(res, `sets-export-${new Date().toISOString().substring(0,10)}.csv`, csv);
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/sets/export/rebrickable — export all sets in Rebrickable's own
// "Set Number,Quantity" list-import format (see rebrickable.com/help/lists-sets/)
router.get('/export/rebrickable', async (req, res) => {
  try {
    const sets = await db.all('SELECT set_number, quantity FROM sets WHERE user_id=$1 ORDER BY set_number ASC', [req.session.userId]);
    sendCsv(res, `rebrickable-sets-${new Date().toISOString().substring(0,10)}.csv`,
      ['Set Number', 'Quantity'],
      sets.map(s => ({ 'Set Number': s.set_number, 'Quantity': s.quantity })));
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/sets/:sn/move — Set in ein anderes Konto des Haushalts ─────────
/**
 * Verschiebt ein Set samt seinen Kaufpreis-Erfassungen.
 *
 * ── Verschieben heisst oft VERSCHMELZEN ─────────────────────────────────────
 * Besitzt das Zielkonto dasselbe Set schon, gibt es dort keine zweite Zeile —
 * `sets` ist je Konto und Setnummer eindeutig. Mengen werden addiert, und die
 * Erfassungen wandern EINZELN über recordAcquisitionForDay(): Treffen dabei
 * zwei Erfassungen desselben Tages aufeinander, fasst der Helfer sie
 * mengengewichtet zusammen — nach genau derselben Regel, die auch beim
 * Erfassen gilt („pro Tag, Element und Benutzer genau ein Kaufpreis"). Ein
 * direktes UPDATE der user_id würde stattdessen zwei Zeilen desselben Tages
 * hinterlassen, also einen Zustand herstellen, den der Bearbeiten-Pfad ablehnt.
 *
 * ── Rechte ──────────────────────────────────────────────────────────────────
 * Beide Seiten müssen im Schreibbereich des Anfragenden liegen: Man kann nur
 * verschieben, was einem (oder einem eigenen Unterkonto) gehört, und nur
 * dorthin, wo man schreiben darf. Das schliesst den Weg vom Unterkonto ins
 * Nachbarkonto aus.
 *
 * Anleitungen bleiben, wo sie sind: Sie hängen an Datei und Konto, nicht am
 * Exemplar. Bilder ohnehin — die liegen nutzerunabhängig nach Setnummer.
 */

// GET /api/sets/household-members — Konten für die Auswahl beim Erfassen.
//
// MUSS vor /:setNumber stehen: Express probiert der Reihe nach, und der
// Platzhalter würde "household-members" sonst als Setnummer lesen.




router.post('/add-stream', async (req: LoggedInRequest, res) => {
  const { set_number, quantity=1, purchase_price, condition: setCondition, owner_user_id } = req.body;
  if (!set_number) { res.status(400).json({ success:false, error:'set_number erforderlich' }); return; }
  const streamOwner = await resolveWriteTarget(req.session.userId, owner_user_id);
  if (streamOwner === null) { res.status(403).json({ success:false, error:'Kein Schreibrecht für dieses Konto.' }); return; }
  // Schon im Blickfeld? Dann NICHT die Menge erhöhen (utils/setAdd.ts) — die
  // Oberfläche öffnet die Detailansicht. Die Antwort kommt hier als normales
  // JSON und nicht als Ereignisstrom: Es gibt nichts zu verfolgen, und ein
  // Strom mit genau einem Ereignis wäre für den Client nur Umweg.
  const vorhanden = await findSetInScope(req.session.userId, set_number);
  if (vorhanden) { res.json({ success:true, action:'exists', ...vorhanden }); return; }
  res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.flushHeaders();
  const unregisterAddSse = registerSse(res);
  let cancelled=false; req.on('close',()=>{cancelled=true;});
  const send = (d: unknown) => { if(!cancelled&&!res.destroyed) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  try {
    // setCondition wurde oben aus dem Body gelesen, aber nicht weitergereicht —
    // der im Formular gewählte Zustand ging dadurch verloren.
    const V2 = require('../utils/validate');
    const result = await addSet(set_number, V2.acquisitionQuantity(quantity), streamOwner,
      d=>{ if(cancelled) throw new Error('CANCELLED'); send(d); },
      V2.optionalPrice(purchase_price, 'Kaufpreis'), setCondition);
    send({ step:'done', ...result });
  } catch (e) { if(fehlertext(e)!=='CANCELLED') send({ step:'error', error:fehlertext(e) }); }
  unregisterAddSse();
  res.end();
});

// ── CSV Import — polling approach (avoids SSE connection issues) ──────────────
// Job state stored in PostgreSQL so all cluster workers can read it.
// Schema (created on first import if missing):
//   csv_import_jobs(user_id PK, status, total, done, current, results JSONB,
//                  error, started_at, updated_at)

async function ensureJobTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS csv_import_jobs (
      user_id    INTEGER PRIMARY KEY,
      status     TEXT    NOT NULL DEFAULT 'running',
      total      INTEGER NOT NULL DEFAULT 0,
      done       INTEGER NOT NULL DEFAULT 0,
      current    TEXT,
      results    JSONB   NOT NULL DEFAULT '[]',
      error      TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function jobGet(userId: number) {
  const row = await db.get('SELECT * FROM csv_import_jobs WHERE user_id = $1', [userId]);
  if (!row) return null;
  return { ...row, results: row.results || [] };
}

/**
 * Spalten, die jobSet()/jobUpdate() schreiben dürfen.
 *
 * Beide Funktionen bauen ihre SET-/VALUES-Liste aus Object.keys(fields) — die
 * Spaltennamen gehen also UNPARAMETRISIERT ins Statement (Bezeichner lassen
 * sich in SQL nicht binden). Heute rufen nur interne Stellen mit fest
 * verdrahteten Objektliteralen auf, es ist also keine Lücke. Aber es ist genau
 * die Sorte Helfer, die irgendwann jemand mit `...req.body` füttert, und dann
 * ist es eine. Die Prüfung kostet nichts und macht den Fall unmöglich statt
 * unwahrscheinlich.
 */
const JOB_COLUMNS = new Set(['status', 'total', 'done', 'current', 'results', 'error', 'started_at']);

/**
 * @param {Record<string, unknown>} fields
 * @returns {string[]} geprüfte Spaltennamen
 */
// Der Injektionsschutz dieser Datei: Die Schluessel landen als SPALTENNAMEN
// im Abfragetext (dort hilft keine Parameterbindung), deshalb die
// Positivliste. Der Typ sagt, dass beliebige Schluessel hereinkommen
// duerfen — genau darum wird hier geprueft.
function assertJobColumns(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields);
  for (const k of keys) {
    if (!JOB_COLUMNS.has(k)) throw new Error(`jobSet: unerlaubte Spalte "${k}"`);
  }
  return keys;
}

async function jobSet(userId: number, fields: Record<string, unknown>) {
  const keys   = assertJobColumns(fields);
  const values = keys.map(k => fields[k]);
  // Build: INSERT ... ON CONFLICT (user_id) DO UPDATE SET k=$n, ...
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const colList    = keys.join(', ');
  const valPlaces  = keys.map((_, i) => `$${i + 2}`).join(', ');
  await db.run(
    `INSERT INTO csv_import_jobs (user_id, ${colList}, updated_at)
     VALUES ($1, ${valPlaces}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    [userId, ...values]
  );
}

async function jobUpdate(userId: number, fields: Record<string, unknown>) {
  if (!fields || !Object.keys(fields).length) return;
  const keys   = assertJobColumns(fields);
  const values = keys.map(k => fields[k]);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.run(
    `UPDATE csv_import_jobs SET ${setClauses}, updated_at = NOW() WHERE user_id = $1`,
    [userId, ...values]
  );
}

router.post('/import/csv', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success:false, error:'Keine Datei' });
  const userId = Number(req.session.userId);

  await ensureJobTable();

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
    return res.status(400).json({ success:false, error:'CSV Parse Fehler: ' + fehlertext(e) });
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
    const sn = rawSn ? String(rawSn).split(';')[0].trim() : null;
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

  await jobSet(userId, {
    status: 'running', total: rows.length, done: 0,
    current: null, results: JSON.stringify([]), error: null,
  });

  // Run import in background — writes progress to DB after each set
  (async () => {
    const results: any[] = [];
    let cancelled = false;
    global._csvImportRunning = true; // signal to background jobs to back off

    for (const { sn, qty, purchasePrice, condition, acquiredAt } of rows) {
      if (cancelled) break;

      // Check cancelled every 10 sets to reduce DB load
      if (results.length % 10 === 0) {
        const cur = await jobGet(userId).catch(() => null);
        if (!cur || cur.status === 'cancelled') { cancelled = true; break; }
      }

      await jobUpdate(userId, { current: sn }).catch(logAndContinue('csv-import:fortschritt'));
      emitJobStatus(userId);

      let attempt = 0;
      while (attempt < 2) {
        try {
          const r = await Promise.race([
            addSetWithDate(sn, qty, userId, purchasePrice, condition, acquiredAt),
            new Promise<never>((_,rej) => setTimeout(() => rej(new Error('Timeout')), 120000))
          ]);
          results.push({ set_number:sn, success:true, action:r.action });
          break;
        } catch(e) {
          attempt++;
          const msg = fehlertext(e) || 'Unbekannter Fehler';
          const isTimeout   = msg.includes('Timeout');
          const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('Daily limit');
          if ((isTimeout || isRateLimit) && attempt < 2) {
            console.warn(`CSV: ${sn} retry after ${msg}...`);
            await new Promise(r => setTimeout(r, 5000));
            continue; // retry — don't push error or update job yet
          }
          const isWarning = isTimeout || isRateLimit;
          results.push({ set_number:sn, success:false, error:msg, isWarning });
          console[isWarning?'warn':'error'](`CSV: ${sn} ${isWarning?'WARNING':'FAILED'}: ${msg}`);
        }
      }
      // Update job after set is fully processed (success or final failure)
      await jobUpdate(userId, { done: results.length, results: JSON.stringify(results) }).catch(e => {
        console.error(`CSV: jobUpdate failed for ${sn}: ${e.message}`);
      });
      emitJobStatus(userId);
    }

    const finalStatus = cancelled ? 'cancelled' : 'done';
    await jobUpdate(userId, { status: finalStatus, current: null }).catch(e => {
      console.error(`CSV: final jobUpdate failed: ${e.message}`);
    });
    emitJobStatus(userId);
    console.log(`CSV import ${finalStatus}: ${results.filter(r=>r.success).length} ok, ${results.filter(r=>!r.success).length} errors`);
    global._csvImportRunning = false;

    // Now trigger background enrichment for all successfully imported sets
    // (deferred during import to avoid DB pool exhaustion)
    const successSets = results.filter(r => r.success).map(r => r.set_number);
    if (successSets.length) {
      const enrich = require('../jobs/partsCatalogEnrich');
      const { importPartsForSet }    = require('./parts');
      const { importMinifigsForSet } = require('./minifigs');
      // Anreicherung mit BEGRENZTER Parallelität (nie mehr als ENRICH_CONCURRENCY
      // Sets gleichzeitig) — der frühere setTimeout(i*3000)-Stagger begrenzte nur
      // den Start-Abstand und erschöpfte bei langen Sets den DB-Connection-Pool.
      // ZWEI Pässe:
      //   Pass 1 (DB-lastig, begrenzt): Import + Katalog-Enrich + Brickset-Meta;
      //           die Anleitungen werden dabei in die Instruction-Queue eingereiht
      //           und diese danach angestoßen (robust: Quota/Retry/Backoff).
      //   Pass 2 (durch den globalen CDN-Limiter ohnehin gedrosselt): Bilder.
      const ENRICH_CONCURRENCY = Math.max(1, parseInt(process.env.ENRICH_CONCURRENCY || '2'));

      const importOne = async (sn: string) => {
        await importMinifigsForSet(sn, userId).catch(() => {});
        await importPartsForSet(sn, userId).catch(() => {});
        await enrich.enrichSetParts(sn).catch(() => {});
        await enrich.enrichSetMinifigs(sn).catch(() => {});
        // Brickset-Metadaten (respektiert Quota)
        // Metadaten sind Beiwerk: Sie dürfen den Import eines Sets nicht
        // scheitern lassen — aber schweigend übersprungen sah ein dauerhaft
        // kaputter Brickset-Zugang genauso aus wie ein Set ohne Eintrag dort.
        await require('../clients/brickset').getSetInfo(sn).then((bs: any) => {
          if (!bs) return;
          return db.run(
            `UPDATE sets SET name=COALESCE(name,$1), year=COALESCE(year,$2), theme=COALESCE(theme,$3), pieces=COALESCE(pieces,$4), minifigs=COALESCE(minifigs,$5) WHERE set_number=$6`,
            [bs.name, bs.year, bs.theme, bs.pieces, bs.minifigs, sn]
          ).catch(logAndContinue(`sets:brickset-meta ${sn}`));
        }).catch(logAndContinue(`sets:brickset-abruf ${sn}`));
        // Anleitungen über die Instruction-Queue einreihen statt direkt laden:
        // Der Job verarbeitet sie robust (Brickset-Quota, Retry-Queue, Cloudflare-
        // Backoff) und ist im Monitoring sichtbar. Angestoßen wird die Queue nach
        // Pass 1 (siehe unten) — analog zum Admin-Reimport.
        await require('../jobs/instructionQueue').enqueue(sn).catch(() => {});
      };

      const runPool = async (fn: (sn: string) => Promise<unknown>) => {
        let i = 0;
        const worker = async () => {
          while (i < successSets.length) {
            const sn = successSets[i++];
            await fn(sn).catch(() => {});
            await new Promise(r => setTimeout(r, 200)); // kleine Pause zwischen Sets
          }
        };
        await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, () => worker()));
      };

      // Pass 1 abwarten (Import/Enrich + Anleitungen einreihen), dann die
      // Instruction-Queue anstoßen und Pass 2 (Bilder) starten.
      runPool(importOne)
        .then(async () => {
          // Anstoss über das Flag — der Primary pollt es alle 3 s. Hier stand
          // zusätzlich ein direkter processNext() „falls DIESER Prozess der
          // Primary ist"; geprüft hat das nie jemand, und in jedem anderen
          // Worker lief dadurch eine zweite Abarbeitung derselben Queue.
          await require('../jobs/instructionQueue').requestRun();
        })
        .then(() => runPool(sn => enrich.downloadSetImages(sn)))
        .catch(() => {});
    }
  })().catch(async e => {
    console.error(`CSV import fatal error: ${e.message}`);
    await jobUpdate(userId, { status: 'error', error: e.message }).catch(e2 =>
      console.error(`CSV: error jobUpdate also failed: ${e2.message}`)
    );
    emitJobStatus(userId);
  });

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
  const userId = Number(req.session.userId);
  await ensureJobTable().catch(logAndContinue('csv-import:job-tabelle'));
  await jobUpdate(userId, { status: 'cancelled' }).catch(logAndContinue('csv-import:abbruch vermerken'));
  emitJobStatus(userId);
  res.json({ success:true });
});

// ── Temporary parts list PDF export ─────────────────────────────────────────



router.post('/:setNumber/instructions', async (req, res) => {
  try {
    const sn = req.params.setNumber;
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);
    // Download synchronously so we can return the actual results
    await downloadSetInstructions(sn).catch(() => {});
    const instrs = await db.all('SELECT * FROM shared_instructions WHERE set_number = $1', [sn]);
    res.json({ success: true, instructions: instrs, count: instrs.length });
  } catch (e) { handleRouteError(res, e); }
});

// LoggedInRequest: liegt hinter dem router.use(requireLogin) weiter oben.
router.post('/:setNumber/parts', async (req: LoggedInRequest, res) => {
  try { const count = await importPartsForSet(req.params.setNumber, req.session.userId); res.json({ success:true, count }); }
  catch (e) { handleRouteError(res, e); }
});

// Erlaubte Endungen strikt aus dem MIME-Typ ableiten, NIE aus file.originalname.
//
// VORHER kam die Endung per path.extname(file.originalname) — also frei vom
// Client wählbar. fileFilter prüfte zwar den mimetype, liess das Ergebnis
// aber links liegen: Content-Type "image/png" + Dateiname "x.html" wurde
// klaglos als "..._<ts>.html" gespeichert. GET /data/uploads/... liefert die
// Datei über res.sendFile(), das den Content-Type-Header aus GENAU dieser
// Endung ableitet — die Datei kam also als text/html vom eigenen Origin
// zurück und hätte darin enthaltenes <script> ausgeführt (die serverweite
// CSP schützt hier nicht, weil sie den eigenen Origin als script-src erlaubt).
//
// Die Zuordnung unten ist bewusst eine feste Allowlist: Es gibt nur drei
// erlaubte Ausgänge, jede andere Kombination wird abgelehnt statt geraten.
const INSTR_EXT_BY_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

const uploadInstr = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const dir=path.join(DATA_DIR,'uploads',String(req.session.userId)); fs.mkdirSync(dir,{recursive:true}); cb(null,dir); },
    filename: (req, file, cb) => {
      const safe = String(req.params.setNumber).replace(/[^a-z0-9-]/gi,'_');
      // ausTabelle statt direktem Zugriff: `INSTR_EXT_BY_MIME['constructor']`
      // lieferte die geerbte Object-Funktion — wahrheitswertig, also kam die
      // Datei am Filter vorbei und landete unter einem Namen aus
      // "function Object() { [native code] }". Siehe utils/validate.ausTabelle.
      const ext  = ausTabelle(INSTR_EXT_BY_MIME, file.mimetype);
      if (!ext) return cb(new Error('Nur PDF, JPG oder PNG'), '');
      cb(null, `${safe}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 50*1024*1024 },
  // Derselbe Grund wie oben: Das hier ist das TOR. Ein geerbter Wert liess
  // beliebigen Inhalt an der Zusage "nur PDF, JPG oder PNG" vorbei.
  fileFilter: (req, file, cb) => { if (ausTabelle(INSTR_EXT_BY_MIME, file.mimetype)) cb(null,true); else cb(new Error('Nur PDF, JPG oder PNG')); }
});
router.post('/:setNumber/instructions/upload', uploadInstr.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success:false, error:'Keine Datei' });
  const uid=req.session.userId, sn=req.params.setNumber;
  const desc=(req.body.description||req.file.originalname).substring(0,200);
  const relPath=`/data/uploads/${uid}/${req.file.filename}`;
  await db.run('INSERT INTO instructions (user_id,set_number,url,description,local_path) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [uid,sn,relPath,desc,relPath]);
  res.json({ success:true, instruction:{ url:relPath, description:desc, local_path:relPath } });
});

router.delete('/:setNumber/instructions/:instrId', async (req, res) => {
  try {
    const instr = await db.get('SELECT * FROM instructions WHERE id = $1 AND user_id = $2', [req.params.instrId, req.session.userId]);
    if (!instr) return res.status(404).json({ success:false, error:'Nicht gefunden' });
    await db.run('DELETE FROM instructions WHERE id = $1 AND user_id = $2', [req.params.instrId, req.session.userId]);
    // Die DATEI erst löschen, wenn keine andere Zeile mehr darauf zeigt.
    //
    // Beim Verschieben eines Sets wird die Anleitungs-Zeile KOPIERT, der Pfad
    // wörtlich übernommen (utils/setMove.ts) — zwei Konten teilen sich dann
    // eine Datei. Vorher lag das Löschen VOR dem DELETE und fragte niemanden:
    // Entfernte das eine Konto seine Anleitung, zeigte die Zeile des anderen
    // ins Leere, und im Set-Detail stand ein Eintrag, der beim Klick 404 gibt.
    //
    // Reihenfolge deshalb umgedreht: erst die Zeile weg, dann zählen. Bleibt
    // eine übrig, bleibt die Datei liegen — sie gehört ja noch jemandem.
    if (instr.local_path?.startsWith('/data/uploads/')) {
      const rest = await db.get('SELECT 1 AS ok FROM instructions WHERE local_path = $1 LIMIT 1',
        [instr.local_path]).catch(() => ({ ok: 1 }));   // im Zweifel behalten
      if (!rest) {
        try { const fp=path.join(APP_ROOT,instr.local_path.slice(1)); if(fs.existsSync(fp))fs.unlinkSync(fp); }
        catch(e){ console.warn('[instructions] Datei konnte nicht gelöscht werden:', fehlertext(e)); }
      }
    }
    res.json({ success:true });
  } catch (e) { handleRouteError(res, e); }
});

// probeBrickInstructions() stand hier: eine dritte Kopie der
// BrickInstructions-Prüfung. Der lebende Weg steht inline in
// fetchInstructions() und in scrapeInstructionsFromFallback(). Entfallen.

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
// ── GET /api/sets/:sn/acquisitions — list all acquisitions ───────────────────

// ── PUT /api/sets/:sn/acquisitions/:id — update one acquisition ───────────────

// ── DELETE /api/sets/:sn/acquisitions/:id — Erfassung löschen ────────────────

// downloadSetImage und getUserDefaultCondition stehen hier NICHT mehr: Die
// erste lebt in utils/setImages.ts, die zweite war eine Dublette von
// effectiveCondition() in utils/settings.ts (Nachtrag 125). Was hier noch
// mitexportiert wird, wartet auf spätere Durchgänge.
// Der Anhang ist leer: addSet, updateSet und buildSetsCsv leben in
// utils/setService.ts und werden von dort importiert — kein Router mehr, der
// Hilfsfunktionen weiterreicht (Nachtrag 131).
export = router;
