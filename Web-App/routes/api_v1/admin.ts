/**
 * /api/v1/admin — Monitoring, Cache-/Limit-Verwaltung, Nutzerverwaltung.
 * ALLE Routen laufen über requireApiAdmin (Token/Session + is_admin) —
 * der Check liegt in der Middleware statt in jedem Handler.
 */
import express from 'express';
import {  DATA_DIR } from '../../utils/appPaths';
import * as db from '../../db/database';
import { handleRouteError, meldeUndWeiter } from '../../utils/httpError';
import { requireApiAdmin } from './middleware';
import { PDF_JOB_DIR } from './pdf';
import { getLimitForApi, getRateLimitStatus } from '../../utils/financeCalc';
import { scrapeInstructionsFromFallback } from '../../utils/instructions';
import { imgProxyFailures } from '../../utils/imgProxyStats';
import { getPoolStats } from '../../db/database';
import { isAllowedImageHost, proxyCachePathFor } from '../imgProxy';
import { vergissFehlend } from '../../utils/imageMisses';
import { clearCatalogCache, clearSubsetsCache, getPriceGuide } from '../../clients/bricklink';
import { enqueue } from '../../jobs/instructionQueue';
import { getJobStatus, triggerNow } from '../../jobs/priceJob';
import { SET_IMAGES_DIR } from '../../utils/appPaths';
import { anfragenJeMinute } from '../../jobs/imageQueue';
import { DAILY_JOBS } from '../../jobs/dailyScheduler';
import { getGlobalSetting, setGlobalSetting, setGlobalTrigger, deleteGlobalSetting } from '../../utils/settings';
const router = express.Router();

/**
 * Wie lange ein gemeldeter Betrieb ohne neues Lebenszeichen gilt.
 *
 * Steht an EINER Stelle, weil zwei Kacheln dieselbe Frage beantworten: Ist das
 * „laeuft" von eben noch aktuell? Vorher stand die Zahl nur beim Katalog-Job;
 * der Bilder-Nachlauf daneben hatte gar keine Frist und blieb nach einem
 * abgebrochenen Lauf fuer immer auf „laeuft".
 *
 * Drei Minuten: lang genug, dass ein langsamer Durchgang nicht faelschlich als
 * tot gilt (der Takt schreibt alle zwanzig Sekunden), kurz genug, dass ein
 * abgestuerzter Lauf nicht den ganzen Tag Betrieb vortaeuscht.
 */
const JOB_FRISCH_MS = 3 * 60_000;

// ── POST /api/v1/admin/trigger-csv-sync — manually trigger CSV sync ──────────
router.post('/admin/trigger-csv-sync', requireApiAdmin, async (_req: AuthedRequest, res) => {
  // Signal primary worker via DB flag (same pattern as instruction queue trigger)
  try {
    await setGlobalTrigger('csv_sync_trigger');
    // Weckt den Primary-Worker sofort. Der Eintrag oben bleibt die belastbare
    // Quelle — ohne Signal liefe er erst beim nächsten Verbindungsaufbau an.
    await require('../../utils/pgNotify').notify('csv_sync_trigger');
    res.json({ success: true, message: 'CSV-Sync wird gestartet…' });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/v1/admin/cache-stats ─────────────────────────────────────────────
router.get('/admin/cache-stats', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    const { getCacheStats }      = require('../../clients/bricklink');
    const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
      getCacheStats().catch(() => ({})),
      db.get("SELECT COUNT(*) as c FROM price_cache WHERE fetched_at <= NOW() - INTERVAL '24 hours'").catch(() => null),
      getRateLimitStatus('bricklink').catch(() => ({ count:0, limit:0 })),
      getRateLimitStatus('rebrickable').catch(() => ({ count:0, limit:0 })),
      getRateLimitStatus('brickset').catch(() => ({ count:0, limit:0 })),
    ]);
    // db_pool kommt aus der Webapp-Fassung mit, die hier aufgeht (Etappe 7).
    // Ohne das Feld verlöre die Überwachungsseite die Pool-Anzeige.
    res.json({ success:true, ...stats, price_stale: parseInt(stale?.c||0),
      rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS },
      db_pool: getPoolStats() });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/v1/admin/image-diag/:setNumber ───────────────────────────────────
//
// „Warum fehlt das Bild für Set X?" — in EINER Antwort (Nachtrag 50).
//
// Dieser Endpunkt ist die Lehre aus einer Fehlersuche, die fünf Anläufe
// gebraucht hat. Dasselbe Symptom („Kachel bleibt leer") hatte nacheinander
// fünf verschiedene Ursachen, und jede Runde begann damit, dieselben Fragen
// von Hand zu beantworten: Kennt die Datenbank überhaupt eine Adresse? Liegt
// die Datei da? Die Vorschau? Ist sie plausibel gross? Was sagt der
// Proxy-Cache? Jede Antwort lag woanders — in der Datenbank, auf der Platte,
// im Cache-Verzeichnis.
//
// Bewusst nur BEOBACHTUNG, keine Reparatur: Der Endpunkt lädt nichts nach und
// erzeugt nichts. Wer reparieren will, nimmt den Bilder-Nachlauf. Ein
// Diagnosewerkzeug, das nebenbei Zustand verändert, macht die nächste
// Fehlersuche schwerer statt leichter.
router.get('/admin/image-diag/:setNumber', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const fs   = require('fs');
    const path = require('path');
    const { SET_IMAGES_DIR } = require('../../utils/appPaths');
    const sn = String(req.params.setNumber);

    // 1. Was weiss die Datenbank — eigene Zeile UND gemeinsamer Katalog?
    const zeilen = await db.all(
      `SELECT user_id, image_local, image_url FROM sets WHERE set_number = $1 ORDER BY user_id`, [sn]
    ).catch(() => []);
    const katalog = await db.get(
      `SELECT image_url FROM set_catalog WHERE set_number = $1`, [sn]
    ).catch(() => null);

    // 2. Was liegt auf der Platte?
    const safe = sn.replace(/[^a-z0-9-]/gi, '_');
    const datei = (p: string) => {
      try { const st = fs.statSync(p); return { vorhanden: true, bytes: st.size, geaendert: st.mtime }; }
      catch (_) { return { vorhanden: false }; }
    };
    const original = datei(path.join(SET_IMAGES_DIR, `${safe}.jpg`));
    const vorschau = datei(path.join(SET_IMAGES_DIR, `${safe}_thumb.jpg`));

    // 3. Kennt der Bild-Proxy das CDN-Bild schon?
    const cdnUrl = zeilen.find(r => r.image_url)?.image_url || katalog?.image_url || null;
    let proxy: any = { adresse: cdnUrl, gecacht: false };
    if (cdnUrl) {
      const cf = proxyCachePathFor ? proxyCachePathFor(cdnUrl) : null;
      if (cf) {
        proxy = { adresse: cdnUrl, gecacht: datei(cf).vorhanden,
                  cache: datei(cf), vorschau: datei(cf + '_thumb.jpg') };
      }
    }

    // 3b. Gilt das Bild als fehlend — und warum?
    //
    // ── Die Lücke, die Marco aufgehalten hat (Nachtrag 123) ──────────────────
    // Der Endpunkt sollte „warum fehlt das Bild für Set X?" in EINER Antwort
    // beantworten. Ausgerechnet die Tabelle, die den Abruf VERHINDERT, sah er
    // nicht an. Steht dort ein Eintrag, ist jede andere Auskunft hier
    // gegenstandslos: Es wird gar nicht erst versucht.
    const merker = await db.get(
      `SELECT checked_at, reason FROM image_misses WHERE cache_key = $1`,
      ['set:' + sn]).catch(() => null);
    const vorschauMerker = await db.get(
      `SELECT checked_at, reason FROM image_misses WHERE cache_key LIKE $1`,
      ['thumb:%' + safe + '_thumb.jpg']).catch(() => null);

    // 4. Eine Einschätzung im Klartext — das, was man sonst aus den Zahlen
    //    selbst ableiten müsste.
    const hinweise: string[] = [];
    if (!zeilen.length) hinweise.push('Kein Konto führt dieses Set.');
    if (zeilen.length && !zeilen.some(r => r.image_local) && !cdnUrl)
      hinweise.push('Weder lokale Datei noch CDN-Adresse bekannt — die Clients können nichts anzeigen.');
    if (zeilen.some(r => r.image_local) && !original.vorhanden)
      hinweise.push('image_local ist gesetzt, die Datei fehlt aber — die Bildroute weicht auf den Proxy aus.');
    if (original.vorhanden && !vorschau.vorhanden)
      hinweise.push('Original da, Vorschau fehlt — sie entsteht beim nächsten Abruf oder über den Bilder-Nachlauf.');
    if (vorschau.vorhanden && vorschau.bytes < 200)
      hinweise.push('Die Vorschau ist unbrauchbar klein und wird beim Ausliefern verworfen.');
    if (merker) hinweise.push(
      `Gilt seit ${new Date(merker.checked_at).toLocaleString()} als fehlend` +
      (merker.reason ? ` (${merker.reason})` : ' (Grund nicht vermerkt — Altbestand)') +
      '. Solange der Eintrag steht, wird das Bild NICHT geholt. ' +
      'Zurücknehmen: POST /api/v1/admin/forget-image-misses');
    if (vorschauMerker) hinweise.push(
      'Für die Vorschau ist ein Fehlschlag vermerkt — sie wird nicht erneut versucht.');
    if (!hinweise.length) hinweise.push('Alles vorhanden: Original und Vorschau liegen bereit.');

    res.json({ success: true, set_number: sn,
      datenbank: { zeilen, katalog_bild: katalog?.image_url || null },
      lokal: { original, vorschau },
      merker: merker ? { seit: merker.checked_at, grund: merker.reason || null } : null,
      proxy, hinweise });
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/v1/admin/forget-image-misses ────────────────────────────────────
//
// Fehlanzeigen zurücknehmen, damit die betroffenen Bilder wieder geholt werden.
//
// ── Warum das fehlte (Nachtrag 123) ──────────────────────────────────────────
// Ein Bild, das einmal als fehlend vermerkt war, wurde sieben Tage lang nicht
// mehr versucht — und es gab keinen Weg, das zurückzunehmen. Der Knopf
// „Fehlende neu laden" hilft nicht: Er sieht nur Zeilen mit gesetztem
// `image_local` an, also Bilder, die schon einmal da waren. Ein Katalogbild,
// das nie ankam, fiel durch jedes Raster.
//
// Ohne Angabe werden alle Set-Fehlanzeigen zurückgenommen; mit `set_numbers`
// nur die genannten. Die Vorschau-Vermerke (`thumb:…`) lassen sich über
// `thumbs: true` mitnehmen — sie hängen an Dateipfaden, nicht an Setnummern.
router.post('/admin/forget-image-misses', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const sets = Array.isArray(req.body?.set_numbers) ? req.body.set_numbers.map(String) : null;
    let entfernt = 0;
    if (sets?.length) {
      entfernt = await vergissFehlend(sets.map((sn: string) => 'set:' + sn));
    } else {
      // Nicht die ganze Tabelle: Die Vorschau-Vermerke haben einen anderen
      // Zweck (eine Verkleinerung, die nie gelingen kann) und sollen nicht
      // nebenbei mitverschwinden.
      const rows = await db.all(
        `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'set:%'`).catch(() => []);
      if (rows.length) entfernt = await vergissFehlend(rows.map((r: any) => r.cache_key));
    }
    if (req.body?.thumbs === true) {
      const rows = await db.all(
        `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'thumb:%'`).catch(() => []);
      if (rows.length) entfernt += await vergissFehlend(rows.map((r: any) => r.cache_key));
    }
    // Die anderen Arbeitsprozesse halten den Merker im Speicher und frischen
    // ihn im Fünf-Minuten-Takt vollständig aus der Tabelle auf — länger dauert
    // es dort also nicht.
    res.json({ success: true, entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' });
  } catch (e) { handleRouteError(res, e); }
});

/**
 * POST /api/v1/admin/cache-clear — Preis-Cache leeren, optional alle Caches.
 *
 * Etappe 7: Stand als /api/finance/refresh und /refresh-all nur in der Webapp.
 * Das Leeren ist eine GLOBALE Aktion (price_cache ist nicht pro Konto, und
 * jeder Neuaufbau kostet Anfragen aus dem gemeinsamen Tageskontingent) —
 * deshalb gehört sie zu den Admin-Werkzeugen, nicht in die Finanz-Routen.
 *
 * `all=true` nimmt Teil- und Katalog-Caches mit.
 */
router.post('/admin/cache-clear', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    await db.run('DELETE FROM price_cache');
    if (req.body?.all) {
      await clearSubsetsCache(); await clearCatalogCache();
    }
    res.json({ success: true, message: req.body?.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/v1/admin/cache-ttl ───────────────────────────────────────────────
router.get('/admin/cache-ttl', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    const ttl = await getGlobalSetting('price_cache_ttl');
    res.json({ success:true, ttl: ttl || '24' });
  } catch (e) { handleRouteError(res, e); }
});

// POST /api/v1/admin/cache-ttl
router.post('/admin/cache-ttl', requireApiAdmin, async (req: AuthedRequest, res) => {
  const ttl = String(req.body?.ttl || '24');
  if (!['12','24','168'].includes(ttl)) return res.status(400).json({ success:false, error:'Ungültiger Wert' });
  try {
    setGlobalSetting('price_cache_ttl', ttl);
    res.json({ success:true, ttl });
  } catch (e) { handleRouteError(res, e); }
});

// POST /api/v1/admin/default-condition — Standard-Zustand setzen (nur Admin)
router.post('/admin/default-condition', requireApiAdmin, async (req: AuthedRequest, res) => {
  const condition = String(req.body?.condition || 'N');
  if (!['N','U'].includes(condition)) return res.status(400).json({ success: false, error: 'N oder U erwartet' });
  try {
    setGlobalSetting('default_price_condition', condition);
    res.json({ success: true, condition });
  } catch (e) { handleRouteError(res, e); }
});

// GET /api/v1/admin/api-limits — get current limits
router.get('/admin/api-limits', requireApiAdmin, async (_req: AuthedRequest, res) => {
  const [rb, bl, bs] = await Promise.all([
    getLimitForApi('rebrickable'), getLimitForApi('bricklink'), getLimitForApi('brickset')
  ]);
  res.json({ success:true, limits: { rebrickable: rb, bricklink: bl, brickset: bs } });
});

// PUT /api/v1/admin/api-limits — update limits
router.put('/admin/api-limits', requireApiAdmin, async (req: AuthedRequest, res) => {
  const { rebrickable, bricklink, brickset } = req.body;
  try {
    if (rebrickable) {
      // Vorher ungeprüft: bei "abc" landete der String "NaN" in global_settings
      // und der Vergleich gegen NaN liess jeden Aufruf scheitern.
      const n = parseInt(rebrickable, 10);
      if (!Number.isFinite(n) || n < 1 || n > 100000)
        return res.status(400).json({ success: false, error: 'Tageslimit muss zwischen 1 und 100000 liegen' });
      setGlobalSetting('api_limit_rebrickable', String(n));
      // Kein setMax() mehr nötig: Der Zähler liegt in der Datenbank und liest
      // die Grenze bei jedem Aufruf (getLimitForApi). Der Wert galt vorher nur
      // im Worker, der diese Anfrage bearbeitet hat — die übrigen liefen bis
      // zum Neustart mit dem alten weiter.
    }
    if (bricklink) {
      setGlobalSetting('api_limit_bricklink', String(parseInt(bricklink)));
    }
    if (brickset) {
      const newLimit = parseInt(brickset);
      const oldLimit = parseInt(await getGlobalSetting('api_limit_brickset') || '100');
      setGlobalSetting('api_limit_brickset', String(newLimit));
      // If limit was increased and quota is available, trigger retry queue
      if (newLimit > oldLimit) {
        const rl = await getRateLimitStatus('brickset').catch(() => null);
        const remaining = rl ? Math.max(0, newLimit - (rl.count || 0)) : 0;
        if (remaining > 0) {
          console.log(`[brickset] Limit increased ${oldLimit}→${newLimit}, ${remaining} calls available — triggering retry queue`);
          setImmediate(() => require('../../jobs/bricksetRetry').processRetryQueue(true).catch(() => {}));
        }
      }
    }
    res.json({ success:true });
  } catch (e) { handleRouteError(res, e); }
});

// Admin: job monitoring
// ── GET /api/v1/admin/brickset-queue — list retry queue entries ───────────────
// ── POST /api/v1/admin/reimport-instructions — enqueue all sets missing instructions ─
router.post('/admin/reimport-instructions', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    // Find all sets across all users that have no instruction
    const missing = await db.all(`
      SELECT DISTINCT s.set_number
      FROM sets s
      WHERE NOT EXISTS (
        SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number
      )
      ORDER BY s.set_number
    `);
    if (!missing.length) return res.json({ success: true, enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' });

    // Delete existing queue entries for these sets so they get re-tried fresh
    let enqueued = 0;
    for (const { set_number } of missing) {
      await db.run(`DELETE FROM shared_instructions WHERE set_number = $1`, [set_number]).catch(() => {});
      await enqueue(set_number).catch(() => {});
      enqueued++;
    }
    // Der Primary-Worker holt sich die Arbeit über das Flag (Poll alle 3 s).
    // Ein zusätzlicher direkter processNext() stand hier „falls dies der
    // Primary ist" — processNext() kannte den Primary aber gar nicht und lief
    // deshalb in JEDEM Worker, der die Anfrage bearbeitet hat.
    await require('../../jobs/instructionQueue').requestRun();
    console.log(`[admin] Reimport instructions: ${enqueued} sets enqueued`);
    res.json({ success: true, enqueued });
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/v1/admin/trigger-price-job ──────────────────────────────────────
// Startet den Preis-Aktualisierungs-Job. Eigener Admin-Endpoint (requireApiAdmin
// = Session ODER Bearer-Token), damit auch die Android-App ihn auslösen kann —
// /api/finance/job-trigger akzeptiert nur Session-Cookies.
/**
 * GET /api/v1/admin/job-status — Stand des Preis-Jobs samt Kontingent.
 *
 * Etappe 7: Die Webapp fragte das unter /api/finance/job-status ab, die App
 * hatte kein Gegenstück. Zwei Adressen für denselben Job wären wieder die
 * Doppelung, an der in dieser Reihe schon mehrfach eine Regel nur an einer
 * Stelle nachgezogen wurde — jetzt gibt es eine, und requireApiAdmin nimmt
 * beide Ausweise.
 */
router.get('/admin/job-status', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    res.json({ success: true, job: getJobStatus(), rate_limit: await getRateLimitStatus('bricklink') });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/admin/trigger-price-job', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    const started = await triggerNow();
    res.json({ success: true, started });
  } catch (e) { handleRouteError(res, e); }
});

/**
 * POST /api/v1/admin/catalog-images — alle fehlenden Katalogbilder einreihen.
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Wenn dieser geklickt wird, sollen alle fehlenden Bilder des Katalogs
 * heruntergeladen werden resp. in die Queue gestellt werden."
 *
 * Bisher füllte sich der lokale Bildbestand nur beim Blättern: Was man nie
 * ansieht, wird nie geholt. Für ein gezieltes Vorbefüllen — etwa über Nacht —
 * fehlte der Anstoss.
 *
 * ── Warum nur EINE Anweisung und keine Prüfung je Datei ─────────────────────
 * Der Katalog hat rund 25 000 Sets. Für jedes zu prüfen, ob die Datei schon
 * liegt, wären 25 000 Dateizugriffe in einer Anfrage — auf einem Raspberry Pi
 * eine spürbare Blockade. Die Prüfung gehört ohnehin dorthin, wo abgearbeitet
 * wird: jobs/imageQueue.ts überspringt, was bereits lokal liegt, und ergänzt
 * dort nur eine fehlende Vorschau.
 *
 * ── Fehlanzeigen werden zurückgenommen (Nachtrag 124) ──────────────────────
 * Marcos Wunsch: „Kannst du die Logik von ‚Alle fehlenden Katalogbilder' so
 * anpassen, dass er die image_misses löscht und sie erneut versucht? Aktuell
 * stehen in der Tabelle sehr viele Einträge."
 *
 * Er hat recht, und der Grund für die vielen Einträge ist mein Fehler aus
 * Nachtrag 123: Bis dahin vermerkte der Job JEDEN gescheiterten Download als
 * „dieses Bild gibt es nicht" — auch eine Zeitüberschreitung oder einen
 * Netzwerkaussetzer. Diese Einträge sind schlicht falsch, und der Knopf war die
 * einzige Stelle, an der sie jemandem im Weg standen.
 *
 * WELCHE zurückgenommen werden, ist die entscheidende Frage. Ein bestätigter
 * 404 heisst wirklich „kein Bild vorhanden" — für alte Sets hat Rebrickable
 * meist keines, das sind Tausende. Die alle erneut zu holen, wäre bei dreissig
 * Anfragen je Minute ein halber Tag reiner 404-Verkehr, und beim nächsten Klick
 * wieder.
 *
 * Deshalb: Zurückgenommen wird, was NICHT als bestätigter 404 vermerkt ist —
 * also die Altbestände ohne Grund und alles, was vorübergehend gescheitert ist.
 * Seit Nachtrag 123 trägt ein echter 404 seinen Grund, und die Sache heilt sich
 * selbst: Ein Altbestand, der beim erneuten Versuch wieder 404 liefert, wird
 * diesmal richtig vermerkt und bleibt beim nächsten Klick draussen.
 *
 * `alle_erneut: true` nimmt auch die bestätigten 404er zurück — für den Fall,
 * dass der CDN Bilder nachgereicht hat. Bewusst nicht die Vorgabe.
 */
router.post('/admin/catalog-images', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const alleErneut = req.body?.alle_erneut === true;
    const zuVergessen = await db.all(
      alleErneut
        ? `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'set:%'`
        : `SELECT cache_key FROM image_misses
            WHERE cache_key LIKE 'set:%'
              AND (reason IS NULL OR reason NOT LIKE '%404%')`
    ).catch(() => []);
    const verworfen = zuVergessen.length
      ? await vergissFehlend(zuVergessen.map((r: any) => r.cache_key))
      : 0;
    // ── Was schon fertig ist, wird nicht wieder eingereiht ────────────────
    //
    // Marcos Befund: „Wenn ich auf den Button klicke, werden immer ca. 29 000
    // Bilder eingereiht. Auch wenn der Job bereits einmal erfolgreich
    // durchgelaufen ist."
    //
    // Er hatte recht, und die Begründung, die ich in Nachtrag 111 dafür notiert
    // habe, war zu kurz gedacht: Ich wollte 25 000 einzelne Dateizugriffe in
    // einer Anfrage vermeiden — richtig — und habe daraus geschlossen, gar
    // nicht zu prüfen. Dabei geht es EINMAL: Ein Verzeichnis lesen liefert alle
    // Namen in einem Zug.
    //
    // Ohne die Prüfung reihte jeder Klick den ganzen Katalog ein. Der Job
    // arbeitete das zwar richtig ab (Datei da → überspringen), aber die Kachel
    // zeigte 29 000 offene Bilder, und jede Notiz kostete einen Durchgang.
    const fs = require('fs');
    let vorhanden: Set<string> = new Set();
    try {
      const namen = new Set<string>(fs.readdirSync(SET_IMAGES_DIR));
      // FERTIG heisst: Original UND Vorschau. Fehlt die Vorschau, gehört das
      // Set weiter in die Warteschlange — der Job holt sie dann nach, ohne
      // erneut zu laden.
      for (const n of namen) {
        if (!n.endsWith('_thumb.jpg')) continue;
        const basis = n.slice(0, -'_thumb.jpg'.length);
        if (namen.has(`${basis}.jpg`)) vorhanden.add(basis);
      }
    } catch (_) { /* Ordner noch leer — dann ist nichts fertig */ }

    const kandidaten = await db.all(
      `SELECT rb.set_num, rb.set_img_url FROM rb_sets rb
        WHERE rb.set_img_url IS NOT NULL AND rb.set_img_url <> ''
          AND NOT EXISTS (SELECT 1 FROM image_misses m
                           WHERE m.cache_key = 'set:' || rb.set_num)`);

    // Dieselbe Namensregel wie in downloadSetImage() — sonst verglichen wir
    // Setnummern mit Dateinamen und fänden nie eine Übereinstimmung.
    const dateiname = (sn: string) => String(sn).replace(/[^a-z0-9-]/gi, '_');
    const offenSets: string[] = [];
    const offenUrls: string[] = [];
    for (const k of kandidaten) {
      if (vorhanden.has(dateiname(k.set_num))) continue;
      offenSets.push(k.set_num);
      offenUrls.push(k.set_img_url);
    }

    let neuEingereiht = 0;
    if (offenUrls.length) {
      const r = await db.get(
        `WITH neu AS (
           INSERT INTO image_wanted (url, set_number)
             SELECT * FROM unnest($1::text[], $2::text[])
             ON CONFLICT (url) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS n FROM neu`, [offenUrls, offenSets]);
      neuEingereiht = r?.n ?? 0;
    }
    const offen = await db.get(`SELECT COUNT(*)::int AS n FROM image_wanted`);
    // Wie lange das dauert — die Zahl der Aufträge allein sagt es nicht, und
    // „Stunden oder Tage?" ist die erste Frage, die sich stellt. Die Rate kommt
    // aus dem Job selbst, damit sie nicht an zwei Stellen gepflegt wird.
    const proMinute = anfragenJeMinute() || 30;
    res.json({
      success: true,
      queued:  neuEingereiht,
      pending: offen?.n ?? 0,
      // Für die Rückmeldung: So viele waren schon fertig und blieben aussen vor.
      skipped: kandidaten.length - offenUrls.length,
      // Zurückgenommene Fehlanzeigen — ohne die Zahl bliebe unklar, warum
      // plötzlich wieder Bilder anstehen, die zuletzt als fehlend galten.
      verworfen,
      dauer_minuten: Math.ceil((offen?.n ?? 0) / proMinute),
    });
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/v1/admin/redownload-missing-images ──────────────────────────────
// Lädt Bilder neu, die laut DB (image_local) heruntergeladen sind, deren Datei
// aber physisch fehlt. Läuft im Hintergrund; Fortschritt erscheint im Monitoring
// unter „Bild-Download (CDN)".
router.post('/admin/redownload-missing-images', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    const enrich = require('../../jobs/partsCatalogEnrich');
    // Nicht awaiten — kann je nach Kataloggröße lange dauern.
    enrich.redownloadMissingImages().catch((e: any) => console.error('[admin] redownload-missing-images:', e?.message));
    res.json({ success: true, started: true });
  } catch (e) { handleRouteError(res, e); }
});

// ── Nutzerverwaltung: NUR unter /api/v1/auth/users ───────────────────────────────
//
// Hier standen GET /api/v1/admin/users und PUT /api/v1/admin/users/:id/role.
// Beide hat kein Client gerufen — nachgemessen ueber den Browser-Code und die
// Retrofit-Anmerkungen der App (test/api-aufrufer.test.js). Die Webapp
// verwaltet Konten ueber /api/v1/auth/users, die App hat keine Nutzerverwaltung.
//
// Schwerer als das Totliegen wog die Doppelung: Adminrechte liessen sich hier
// mit dem Feld `is_admin` und dort mit `role` umschalten — zwei Schreibweisen
// fuer dieselbe Umschaltung, jede mit eigener Pruefung. Bei Rechten ist genau
// das die Sorte Doppelung, bei der irgendwann eine Seite grosszuegiger ist.
//
// Der Selbstschutz („eigene Admin-Rolle kann nicht entfernt werden") und die
// strictBool-Pruefung stehen weiter in routes/auth.ts, PUT /users/:id/admin.

// ── GET /api/v1/admin/logs?minutes=15 — return recent log entries ─────────────
router.get('/admin/logs', requireApiAdmin, async (req: AuthedRequest, res) => {
  const minutes = Math.min(2880, Math.max(1, parseInt(String(req.query.minutes || '15'))));
  try {
    const rows = await db.all(
      `SELECT id, level, message, logged_at
       FROM app_logs
       WHERE logged_at >= NOW() - ($1 || ' minutes')::INTERVAL
       ORDER BY logged_at ASC
       LIMIT 5000`,
      [minutes]
    );
    res.json({ success: true, minutes, count: rows.length, logs: rows });
  } catch (e) { handleRouteError(res, e); }
});

router.get('/admin/brickset-queue', requireApiAdmin, async (_req: AuthedRequest, res) => {
  const rows = await db.all(
    `SELECT q.set_number, q.retry_after, q.attempts, q.last_error, q.created_at,
            s.name
     FROM brickset_retry_queue q
     LEFT JOIN sets s ON s.set_number = q.set_number
     ORDER BY q.retry_after ASC, q.set_number ASC`
  ).catch(() => []);
  res.json({ success: true, count: rows.length, entries: rows });
});

// ── POST /api/v1/admin/brickset-queue/:setNumber/retry — retry single entry now ─
router.post('/admin/brickset-queue/:setNumber/retry', requireApiAdmin, async (req: AuthedRequest, res) => {
  const sn = req.params.setNumber;
  // Reset retry_after to today so processRetryQueue picks it up immediately
  await db.run(
    `UPDATE brickset_retry_queue SET retry_after = CURRENT_DATE WHERE set_number = $1`, [sn]
  ).catch(() => {});
  // Temporarily reset today's rate limit counter so the retry goes through even if limit reached
  await deleteGlobalSetting('api_calls_brickset', 'api_calls_date_brickset')
    .catch(() => {});
  // Trigger queue processing immediately
  setImmediate(() => require('../../jobs/bricksetRetry').processRetryQueue(true).catch(() => {}));
  res.json({ success: true, set_number: sn });
});

// ── DELETE /api/v1/admin/brickset-queue/:setNumber — remove + trigger fallback ─
router.delete('/admin/brickset-queue/:setNumber', requireApiAdmin, async (req: AuthedRequest, res) => {
  const sn = req.params.setNumber;
  await db.run(`DELETE FROM brickset_retry_queue WHERE set_number = $1`, [sn]).catch(() => {});
  // Trigger fallback directly — skip Brickset since that's why it was in the queue
  setImmediate(async () => {
    try {
      await scrapeInstructionsFromFallback(sn ?? '').catch(() => {});
    } catch (e) { meldeUndWeiter('admin:anleitungen-nachschlagen', e); }
  });
  res.json({ success: true, set_number: sn });
});

router.get('/admin/jobs', requireApiAdmin, async (_req: AuthedRequest, res) => {
  const monitor = require('../../utils/jobMonitor');
  const jobs = await monitor.all(); // reads from PostgreSQL — shared across all cluster workers

  // Enrich with live DB counts
  const [pending, done, failed] = await Promise.all([
    db.get(`SELECT COUNT(*) as c FROM instruction_queue WHERE status='pending'`).catch(()=>null),
    db.get(`SELECT COUNT(*) as c FROM instruction_queue WHERE status='done'`).catch(()=>null),
    db.get(`SELECT COUNT(*) as c FROM instruction_queue WHERE status='failed'`).catch(()=>null),
  ]);
  const blMapped = await db.get(`SELECT COUNT(*) as c FROM rb_bl_mapping`).catch(()=>null);
  const blTotal  = await db.get(`SELECT COUNT(DISTINCT part_number) as c FROM parts WHERE source!='manual'`).catch(()=>null);
  const rbParts  = await db.get(`SELECT COUNT(*) as c FROM rb_parts`).catch(()=>null);
  const rbInvParts = await db.get(`SELECT COUNT(*) as c FROM rb_inventory_parts`).catch(()=>null);
  const lastSync = await getGlobalSetting('rb_csv_last_sync');

  // Enrich blIds job with live DB counts
  const mappedC = parseInt(blMapped?.c||0);
  const totalBl = parseInt(blTotal?.c||0);
  if (totalBl > 0) {
    jobs.blIds = {
      ...jobs.blIds,
      status:   mappedC < totalBl ? (jobs.blIds.status === 'running' ? 'running' : 'idle') : 'done',
      progress: mappedC,
      total:    totalBl,
      sub:      mappedC < totalBl ? `${mappedC} / ${totalBl} gemappt` : `Alle ${totalBl} gemappt`
    };
  }

  // Enrich instrQueue job with live DB counts
  const pendingC = parseInt(pending?.c||0);
  const doneC    = parseInt(done?.c||0);
  const failedC  = parseInt(failed?.c||0);
  const totalC   = pendingC + doneC + failedC;
  if (totalC > 0) {
    const enriched = {
      ...jobs.instrQueue,
      status:   pendingC > 0 ? 'running' : 'done',
      progress: doneC,
      total:    totalC,
      sub:      pendingC > 0 ? `${pendingC} ausstehend` : 'Alle erledigt'
    };
    jobs.instrQueue = enriched;
  }

  // Brickset retry queue
  const bsRetry = await db.get(
    `SELECT COUNT(*) as c FROM brickset_retry_queue`
  ).catch(() => null);
  const bsRetryC = parseInt(bsRetry?.c || 0);
  const bsRetryDue = await db.get(
    `SELECT COUNT(*) as c FROM brickset_retry_queue WHERE retry_after <= CURRENT_DATE`
  ).catch(() => null);
  const bsRetryDueC = parseInt(bsRetryDue?.c || 0);
  jobs.bricksetRetry = {
    label:    'Brickset Retry Queue',
    status:   bsRetryC === 0 ? 'done' : bsRetryDueC > 0 ? 'idle' : 'idle',
    progress: 0,
    total:    bsRetryC,
    sub:      bsRetryC === 0
      ? 'Keine ausstehenden Einträge'
      : bsRetryDueC > 0
        ? `${bsRetryDueC} Sets bereit zum Retry, ${bsRetryC - bsRetryDueC} warten`
        : `${bsRetryC} Sets warten auf morgen`,
    lastRun: null,
  };

  // img-dl: active download locks and pending images count
  const [imgDlPending, imgDlDone, imgDlPendingFigs, imgDlPendingOwnFigs] = await Promise.all([
    db.get(`SELECT COUNT(*) as c FROM set_parts_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`).catch(()=>null),
    db.get(`SELECT COUNT(*) as c FROM set_parts_catalog WHERE image_local IS NOT NULL`).catch(()=>null),
    db.get(`SELECT COUNT(*) as c FROM set_minifigs_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`).catch(()=>null),
    // Minifiguren des Bestands: Sie werden seit der Erweiterung des
    // img-dl-Hintergrundlaufs ebenfalls lokal abgelegt und gehören damit in
    // die offene Menge. DISTINCT, weil die Datei je Figur nur einmal geholt
    // wird und von allen Nutzern geteilt wird.
    db.get(`SELECT COUNT(DISTINCT fig_number) as c FROM minifigs WHERE image_url IS NOT NULL AND image_local IS NULL`).catch(()=>null),
  ]);
  const imgPending = parseInt(imgDlPending?.c||0) + parseInt(imgDlPendingFigs?.c||0)
                   + parseInt(imgDlPendingOwnFigs?.c||0);
  const imgDone    = parseInt(imgDlDone?.c||0);
  // Aktiv laufende Downloads: über ALLE Batches/Worker summierter Zähler
  // (imgDlAdd/-Sub in downloadSetImages) — nicht mehr der zuletzt gestartete
  // Batch. Deckelung auf imgPending (real noch nicht gecachte Bilder) heilt
  // einen evtl. verwaisten Zähler nach einem Worker-Crash selbst; bei 0 offenen
  // Bildern wird der Zähler zurückgesetzt.
  const imgDlJob   = await monitor.get('imgDl').catch(() => null);
  let imgActive    = await monitor.imgDlPending().catch(() => 0);
  if (imgPending === 0 && imgActive > 0) { await monitor.imgDlReset().catch(() => {}); imgActive = 0; }
  imgActive = Math.min(imgActive, imgPending);
  const imgRunning = imgActive > 0;
  // Manueller Re-Download fehlender Bilder (image_local gesetzt, Datei fehlt) —
  // Status liegt in global_settings.imgredl_status.
  let reDl: any = null;
  try {
    const roh = await getGlobalSetting('imgredl_status');
    if (roh) reDl = JSON.parse(roh);
  } catch (_) { reDl = null; }
  // ── „laeuft" heisst auch hier: hat KUERZLICH etwas getan ──────────────────
  //
  // Hier stand `reDl?.running === true` — der Wert allein, ohne sein Alter.
  // Ein Prozess, der mitten im Lauf beendet wird (Neustart, Auslieferung,
  // Container gestoppt), kommt nie mehr dazu, `false` zu schreiben. Der Stand
  // blieb dann fuer immer auf „laeuft", und diese Kachel meldete Betrieb, bis
  // jemand den Schluessel von Hand loeschte.
  //
  // Der Zeitstempel dafuer wird laengst mitgeschrieben: _redlSetStatus() in
  // jobs/partsCatalogEnrich.ts haengt an JEDEN Stand ein `at`. Gelesen wurde
  // er nie.
  //
  // Zwoelf Zeilen weiter unten steht fuer den Katalog-Job dieselbe Regel, und
  // zwar begruendet mit genau diesem Befund von Marco („Der Job scheint zu
  // laufen laut Monitoring, aber im Log sind keine Eintraege dazu zu finden").
  // Sie stand nur an einer der beiden Stellen. Deshalb jetzt EINE Konstante
  // fuer beide — sonst laufen die zwei Fenster beim naechsten Anfassen
  // auseinander.
  //
  // NACHGEMESSEN: Ein hinterlassenes {running:true} macht
  // test/image-queue-db.test.js rot („'running' !== 'idle'"). So ist der
  // Fehler ueberhaupt aufgefallen — im allerersten CI-Lauf dieses Repositories.
  const seitReDl = typeof reDl?.at === 'number' ? Date.now() - reDl.at : null;
  const reDlRunning = reDl?.running === true
    && (seitReDl === null || seitReDl < JOB_FRISCH_MS);
  const reDlSub = reDlRunning
    ? (reDl.phase === 'scanning'
        ? '↻ suche fehlende Bilder…'
        : `↻ ${reDl.done || 0}/${reDl.total || 0} fehlende neu geladen`)
    : null;
  // ── Katalog-Bilder gehören in DIESE Kachel ────────────────────────────────
  //
  // Marcos Wunsch: „Ich fände es sprechend, wenn diese in der Kachel
  // ‚Bild-Download (CDN)' enthalten sind, da der Titel nichts von meinen Sets
  // aussagt."
  //
  // Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen
  // BESTANDES und meldete „Alle 62 170 Bilder gecacht", während der
  // Hintergrund-Job gerade hunderte Katalogbilder nachlud. Der Titel verspricht
  // aber alles, was vom CDN kommt.
  //
  // `image_wanted` ist die Warteschlange des Jobs (jobs/imageQueue.ts): Jede
  // Bildanfrage über den Proxy hinterlässt dort eine Notiz.
  const katalogOffen = (await db.get(
    `SELECT COUNT(*)::int AS c FROM image_wanted`).catch(() => null))?.c ?? 0;
  // ── „läuft" heisst: hat kürzlich etwas getan ─────────────────────────────
  //
  // Marcos Befund: „Der Job scheint zu laufen laut Monitoring und
  // Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."
  //
  // Die Kachel meldete „läuft", sobald die Warteschlange nicht leer war
  // (Nachtrag 108). Das ist keine Aussage über TÄTIGKEIT: Eine
  // steckengebliebene Warteschlange sah genauso aus wie eine, die abgearbeitet
  // wird. Jetzt zählt der Zeitpunkt des letzten Durchgangs — bleibt er aus,
  // steht die Kachel auf „idle" und nennt den Grund.
  //
  // ── Der Stand kommt aus der DATENBANK (Nachtrag 121) ─────────────────────
  //
  // Marcos Kachel meldete „Job noch nicht gelaufen", während im Log gerade
  // fünf Durchgänge standen. Hier stand vorher
  //
  //     const { letzterLauf } = require('../../jobs/imageQueue');
  //
  // — also ein Blick in den ARBEITSSPEICHER des Prozesses, der diese Anfrage
  // gerade bedient. Gesetzt wird der Merker aber nur dort, wo der Job läuft
  // (Primär-Worker). Bei vier Workern war die Antwort in drei von vier Fällen
  // `null`. Der Job schrieb in `global_settings`, sobald er etwas getan hat;
  // von dort sehen ihn alle Worker.
  let letzterLauf: { zeit?: number } | null = null;
  try {
    const roh = await getGlobalSetting('imgqueue_last_run');
    if (roh) letzterLauf = JSON.parse(roh);
  } catch (_) { letzterLauf = null; }
  const seitLauf = letzterLauf?.zeit ? Date.now() - letzterLauf.zeit : null;
  const jobLaeuft = seitLauf !== null && seitLauf < JOB_FRISCH_MS;
  const katalogSub = katalogOffen > 0
    ? `${katalogOffen} Katalog-Bilder in Warteschlange` +
      (jobLaeuft ? '' : seitLauf === null ? ' · Job noch nicht gelaufen'
                                          : ` · seit ${Math.round(seitLauf / 60_000)} min kein Durchgang`)
    : null;

  const bestandSub = imgRunning ? `${imgActive} Bilder werden geladen`
              : imgPending > 0 ? `${imgPending} Bilder noch nicht gecacht`
              : `Alle ${imgDone} Bilder gecacht`;
  // „Bestand" ausdrücklich benennen, sobald daneben Katalogzahlen stehen —
  // sonst lässt sich nicht sagen, worauf sich welche Zahl bezieht.
  const imgBaseSub = katalogSub ? `Bestand: ${bestandSub} · ${katalogSub}` : bestandSub;
  jobs.imgDl = {
    label:    '📥 Bild-Download (CDN)',
    // Läuft auch dann, wenn nur der Katalog-Job arbeitet — sonst stünde die
    // Kachel auf „fertig", während sie gerade lädt.
    status:   (imgRunning || reDlRunning || (katalogOffen > 0 && jobLaeuft)) ? 'running'
              : (imgPending > 0 || katalogOffen > 0) ? 'idle' : 'done',
    sub:      reDlSub ? `${imgBaseSub} · ${reDlSub}` : imgBaseSub,
    // Der Balken bezieht die Warteschlange mit ein: Sonst stünde er auf 100 %,
    // während noch hunderte Bilder ausstehen.
    progress: imgDone,
    total:    imgDone + imgPending + katalogOffen,
    queue:    katalogOffen,
    queueLastRun: letzterLauf?.zeit || null,
    lastRun:  imgDlJob?.lastRun || null,
    canRedownload: true,
  };

  // PDF jobs: count from filesystem
  let pdfRunning = 0, pdfDone = 0;
  try {
    const _fs2 = require('fs'), _path2 = require('path');
    const pdfFiles = _fs2.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'));
    for (const f of pdfFiles) {
      try {
        const j = JSON.parse(_fs2.readFileSync(_path2.join(PDF_JOB_DIR, f), 'utf8'));
        if (j.status === 'running') pdfRunning++;
        else if (j.status === 'done') pdfDone++;
      } catch (e) { meldeUndWeiter('admin:pdf-auftrag-lesen', e); }
    }
  } catch (e) { meldeUndWeiter('admin:auftragsordner-lesen', e); }
  jobs.pdfJobs = {
    label:   '📄 PDF-Jobs',
    status:  pdfRunning > 0 ? 'running' : pdfDone > 0 ? 'idle' : 'done',
    sub:     pdfRunning > 0 ? `${pdfRunning} PDF(s) werden erstellt`
             : pdfDone > 0 ? `${pdfDone} PDF(s) bereit zum Download`
             : 'Keine aktiven Jobs',
    progress: 0,
    total:    0,
    lastRun:  null,
  };

  // Konfigurierte Zeitpläne für die Monitoring-UI:
  // tägliche Jobs (HH:MM) + Preis-Job (Intervall in Minuten).
  const schedules: any = {};
  for (const dj of DAILY_JOBS) {
    const zeit = await getGlobalSetting(`job_time_${dj.name}`);
    schedules[dj.monitorKey] = { type: 'daily', time: zeit || dj.default };
  }
  const priceInt = await getGlobalSetting('price_job_interval_minutes');
  schedules.priceJob = { type: 'interval', minutes: parseInt(priceInt || '60') };

  res.json({
    success: true,
    jobs,
    schedules,
    db: {
      instrQueue: { pending: pendingC, done: doneC, failed: failedC },
      blMapping:  { mapped: parseInt(blMapped?.c||0), total: parseInt(blTotal?.c||0) },
      csvCache:   { parts: parseInt(rbParts?.c||0), inventoryParts: parseInt(rbInvParts?.c||0), lastSync: lastSync || null },
    }
  });
});

// ── POST /api/v1/admin/job-schedule — Zeitplan eines Jobs ändern ──────────────
// Body: { name: <monitorKey>, time: "HH:MM" }  (für tägliche Jobs)
//   oder { name: 'priceJob', minutes: <n> }    (für den Preis-Job, Intervall)
// Die Änderung greift SOFORT (Reschedule-Trigger + direkter Aufruf).
router.post('/admin/job-schedule', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const { name, time, minutes } = req.body || {};
    const daily = DAILY_JOBS.find(j => j.monitorKey === name);
    if (daily) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
      if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) {
        return res.status(400).json({ success: false, error: 'Ungültige Uhrzeit (HH:MM)' });
      }
      const norm = `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`;
      setGlobalSetting(`job_time_${daily.name}`, norm);
    } else if (name === 'priceJob') {
      const min = Math.max(5, parseInt(minutes) || 60);
      setGlobalSetting('price_job_interval_minutes', String(min));
    } else {
      return res.status(400).json({ success: false, error: 'Unbekannter Job' });
    }
    // Sofort anwenden: Flag für den Primary-Worker + direkter Aufruf (falls dieser Prozess der Primary ist).
    await setGlobalTrigger('job_reschedule_trigger').catch(() => {});
    await require('../../utils/pgNotify').notify('job_reschedule_trigger');
    try { await require('../../jobs/dailyScheduler').rescheduleAll(); } catch (e) { meldeUndWeiter('admin:zeitplan-neu-planen', e); }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

/**
 * GET /api/v1/admin/img-probe?url=…
 *
 * Fragt eine Bild-URL vom SERVER aus ab und meldet, was das CDN antwortet —
 * mit Referer, ohne Referer und ganz ohne Kopfzeilen. Damit lässt sich der
 * Unterschied zwischen „Bild fehlt", „Hotlink-Schutz" und „Server kommt gar
 * nicht raus" belegen, statt ihn zu vermuten.
 *
 * Entstanden, weil Minifiguren-Bilder über den Proxy fehlschlugen, während
 * dieselbe URL im Browser lud. Ohne Sicht auf die Serverantwort war das nicht
 * zu entscheiden.
 */
router.get('/admin/img-probe', requireApiAdmin, async (req: AuthedRequest, res) => {
  const url = String(req.query.url || '');
  if (!/^https:\/\//.test(url)) return res.status(400).json({ success: false, error: 'url fehlt oder ist kein https' });

  // Dieselbe Host-Allowlist wie der Bild-Proxy.
  //
  // Ohne sie holt diese Route JEDE https-Adresse über den Server — auch
  // interne, die von aussen nicht erreichbar sind (Datenbank-Oberflächen,
  // Metadaten-Endpunkte der Cloud, Nachbardienste im Docker-Netz). Dass nur
  // Admins sie aufrufen dürfen, macht das nicht harmlos: Ein Admin-Konto ist
  // genau das Ziel, das ein Angreifer zuerst übernimmt, und die Antwort
  // (Status, Kopfzeilen, erste 64 KB) reicht zum Abtasten des internen Netzes.
  // Eine Liste, zwei Aufrufer: Die Kopie hier ist durch den gemeinsamen Helfer
  // aus routes/imgProxy.ts ersetzt — sonst wird beim nächsten neuen CDN genau
  // eine der beiden Stellen nachgezogen.
  try {
    if (!isAllowedImageHost(url)) {
      return res.status(403).json({ success: false, error: `Host nicht erlaubt: ${new URL(url).hostname}` });
    }
  } catch (_) {
    return res.status(400).json({ success: false, error: 'Ungültige URL' });
  }

  // Dieselbe Host-Allowlist wie der Bild-Proxy.
  //
  // VORHER holte diese Route JEDE https-Adresse. Sie ist zwar Admin-geschützt,
  // aber der Abruf läuft vom Server aus — also aus dem internen Netz heraus.
  // Damit liesse sich von aussen prüfen, welche internen Hosts erreichbar sind
  // und was sie antworten (Server-Side Request Forgery). Ein Diagnosewerkzeug
  // für CDN-Bilder braucht das nicht: Es soll genau die Hosts erreichen, die
  // der Proxy auch erreicht.
  const ALLOWED_PROBE_HOSTS = ['cdn.rebrickable.com', 'rebrickable.com', 'images.brickset.com', 'www.bricklink.com', 'img.bricklink.com'];
  try {
    const host = new URL(url).hostname;
    if (!ALLOWED_PROBE_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
      return res.status(403).json({ success: false, error: `Host nicht erlaubt: ${host}` });
    }
  } catch (_) {
    return res.status(400).json({ success: false, error: 'Ungültige URL' });
  }

  const https2 = require('https');
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const variants = [
    { name: 'mit Referer',  headers: { 'User-Agent': UA, 'Referer': 'https://rebrickable.com/', 'Accept': 'image/*,*/*;q=0.8' } },
    { name: 'ohne Referer', headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8' } },
    { name: 'nackt',        headers: {} },
  ];

  const probe = (v: any) => new Promise(resolve => {
    const t0 = Date.now();
    let settled = false;
    const done = (o: any) => { if (!settled) { settled = true; resolve({ variant: v.name, ms: Date.now() - t0, ...o }); } };
    const rq = https2.get(url, { family: 4, headers: v.headers }, (r: any) => {
      let bytes = 0;
      r.on('data', (c: any) => { bytes += c.length; if (bytes > 65536) rq.destroy(); });
      r.on('end',   () => done({ status: r.statusCode, content_type: r.headers['content-type'] || null,
                                 content_length: r.headers['content-length'] || null,
                                 // Liefert das CDN komprimiert, muss der Proxy die Kopfzeile
                                 // weiterreichen — sonst hält der Browser die Bytes für ein JPEG.
                                 content_encoding: r.headers['content-encoding'] || null,
                                 transfer_encoding: r.headers['transfer-encoding'] || null,
                                 bytes, server: r.headers['server'] || null, cf_ray: r.headers['cf-ray'] || null }));
      r.on('close', () => done({ status: r.statusCode, content_type: r.headers['content-type'] || null, bytes, truncated: true }));
    });
    rq.on('error', (e: any) => done({ error: e.message, code: e.code }));
    rq.setTimeout(10000, () => { rq.destroy(); done({ error: 'timeout' }); });
  });

  const results: any[] = [];
  for (const v of variants) results.push(await probe(v));

  // Liegt das Bild bereits im Plattencache?
  const crypto = require('crypto'), fsp = require('fs').promises, pathm = require('path');
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const dir = pathm.join(DATA_DIR, 'img_proxy_cache');
  const cached = await fsp.stat(pathm.join(dir, key)).then((st: any) => ({ bytes: st.size })).catch(() => null);
  const thumb  = await fsp.stat(pathm.join(dir, key + '_thumb.jpg')).then((st: any) => ({ bytes: st.size })).catch(() => null);

  // Fehlerzähler des Proxys mitliefern — zeigt auf einen Blick, ob und woran
  // Abrufe scheitern, ohne im Server-Log suchen zu müssen.
  const failures = imgProxyFailures;
  // Was würde der Proxy AUSLIEFERN? Ein Abruf durch dieselbe Kette wie im
  // Bild-Proxy, aber statt zum Client gehen die ersten Bytes hierher — als Hex.
  //
  // Grund: Der Server meldet 200, das CDN liefert 200, nichts steht im Log, und
  // der Browser zeigt trotzdem nichts. Der einzige Blickwinkel, der bisher
  // fehlte, ist der tatsächliche Inhalt.
  //
  //   FF D8 FF …  gültiger JPEG-Anfang
  //   89 50 4E 47 gültiger PNG-Anfang
  //   1F 8B …     gzip — dann liegt es an der Komprimierung
  //   3C 21 44 …  "<!D" — eine HTML-Seite statt eines Bildes
  const head = await new Promise(resolve => {
    const rq = https2.get(url, { family: 4, headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8',
                                            'Accept-Encoding': 'identity' } }, (r: any) => {
      const chunks: any[] = []; let n = 0;
      r.on('data', (c: any) => { chunks.push(c); n += c.length; if (n >= 32) rq.destroy(); });
      const fin = () => resolve({
        status: r.statusCode,
        content_encoding: r.headers['content-encoding'] || null,
        first_bytes_hex: Buffer.concat(chunks).slice(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim(),
        looks_like: (() => {
          const b = Buffer.concat(chunks);
          if (b[0] === 0xFF && b[1] === 0xD8) return 'JPEG';
          if (b[0] === 0x89 && b[1] === 0x50) return 'PNG';
          if (b[0] === 0x1F && b[1] === 0x8B) return 'gzip (komprimiert!)';
          if (b.slice(0, 5).toString().toLowerCase().startsWith('<')) return 'HTML/XML statt Bild';
          return 'unbekannt';
        })(),
      });
      r.on('end', fin); r.on('close', fin);
    });
    rq.on('error', (e: any) => resolve({ error: e.message }));
    rq.setTimeout(10000, () => { rq.destroy(); resolve({ error: 'timeout' }); });
  });

  res.json({ success: true, url, cache: { original: cached, thumb }, probes: results,
             proxy_failures: failures, body_check: head });
});
/**
 * GET /api/v1/admin/price-probe?set=10290-1
 *
 * Zeigt für ein Set alles, was in die Marktpreis-Anzeige einfliesst:
 * Erfassungen, gespeicherter Zustand, sämtliche price_cache-Zeilen und — auf
 * Wunsch — was BrickLink gerade antwortet.
 *
 * Entstanden nach mehreren Runden, in denen ein zu niedriger Preis angezeigt
 * wurde und nicht zu klären war, ob es an der Zustandswahl, am Cache oder an
 * der BrickLink-Antwort liegt. Wie beim Bild-Proxy gilt: erst messen.
 *
 * `&live=1` fragt BrickLink zusätzlich direkt ab (kostet Kontingent).
 */
router.get('/admin/price-probe', requireApiAdmin, async (req: AuthedRequest, res) => {
  const setNumber = String(req.query.set || '').trim();
  if (!setNumber) return res.status(400).json({ success: false, error: 'Parameter set fehlt' });
  const uid = req.apiUser.user_id;

  const [setRow, acqs, cacheRows, histRows, currRow, ttlRow] = await Promise.all([
    db.get('SELECT set_number, quantity, condition, purchase_price FROM sets WHERE user_id=$1 AND set_number=$2', [uid, setNumber]),
    // Spalte heisst created_at, nicht added_at — daran scheiterte die Probe
    // zuvor mit einem 500er.
    db.all('SELECT quantity, condition, purchase_price, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at', [uid, setNumber]),
    db.all(`SELECT condition, currency_code, avg_price, qty_avg_price, min_price, max_price, fetched_at,
                   EXTRACT(EPOCH FROM (NOW() - fetched_at))/3600 AS age_hours
              FROM price_cache WHERE set_number=$1 ORDER BY condition, currency_code`, [setNumber]),
    db.all(`SELECT condition, avg_price, qty_avg_price, recorded_at FROM price_history
             WHERE set_number=$1 ORDER BY recorded_at DESC LIMIT 5`, [setNumber]),
    db.get("SELECT value FROM user_settings WHERE user_id=$1 AND key='currency'", [uid]).catch(() => null),
    getGlobalSetting('price_cache_ttl'),
  ]);

  // Welchen Zustand würde die Bewertung wählen? Dieselbe Regel wie
  // conditionFromAcquisitions() in utils/handlers.ts: Eine gebrauchte
  // Erfassung genügt; gibt es Erfassungen ohne gebrauchte, ist es Neu; ohne
  // Erfassungen zählt sets.condition. Die Probe zeigte hier vorher die
  // ÜBERHOLTE Regel („nur sets.condition zählt") — das hätte bei genau dieser
  // Art von Anfrage einen falschen Eindruck vermittelt.
  const acqCount = acqs.length;
  const anyUsed = acqs.some((a: any) => a.condition === 'U');
  const chosen = anyUsed ? 'U' : (acqCount > 0 ? 'N' : (setRow?.condition === 'U' ? 'U' : 'N'));

  const out: any = {
    success: true,
    set: setRow || null,
    acquisitions: acqs,
    condition_logic: {
      stored_in_sets: setRow?.condition ?? null,
      any_acquisition_used: anyUsed,
      chosen_for_price: chosen,
      hinweis: 'Eine gebrauchte Erfassung macht das Set gebraucht; Erfassungen ohne '
             + 'gebrauchte machen es neu; ohne Erfassungen zählt sets.condition. '
             + 'Weicht "chosen_for_price" von der Anzeige ab, liegt der Fehler dort.',
    },
    currency: currRow?.value || 'EUR',
    ttl_hours: parseInt(ttlRow || '24'),
    price_cache: cacheRows,
    price_history_last5: histRows,
  };

  if (req.query.live === '1') {
    const cur = out.currency;
    out.live = {};
    for (const cond of ['N', 'U']) {
      try {
        const g = await getPriceGuide(setNumber, cond, 'sold', cur);
        out.live[cond] = { avg_price: g?.avg_price, qty_avg_price: g?.qty_avg_price,
                           guide_used: g?.guide_used, guide_fallback: g?.guide_fallback || false };
      } catch (e: any) { out.live[cond] = { error: e.message }; }
    }
  }

  res.json(out);
});

export default router;
