'use strict';

const db      = require('../db/database');
import { kontingentFrei, speicherePreis, cacheUsable, preisAusCache } from '../utils/financeCalc';
import { meldeUndWeiter, fehlertext } from '../utils/httpError';
import { getSetting, getGlobalSetting } from '../utils/settings';
import { katalogEintrag, ohneBricklinkPreis } from '../utils/setNummer';
const monitor = require('../utils/jobMonitor');
const { getPriceGuide } = require('../clients/bricklink');

/**
 * Laufzustand des Preis-Jobs.
 *
 * Ausgeschrieben, weil TypeScript aus `lastRun:null` sonst den Typ `null`
 * ableitet und aus `log:[]` den Typ `never[]` — beides ist nicht gemeint und
 * war unter strictNullChecks die grösste Einzelgruppe Meldungen in dieser
 * Datei. Der Typ beschreibt, was das Feld über die Laufzeit WIRKLICH annimmt.
 */
interface PriceJobState {
  running: boolean;
  lastRun: string | null;
  lastDuration: number | null;
  lastUpdated: number;
  lastErrors: number;
  nextRun: string | null;
  progress: { current: number; total: number; set: string | null } | null;
  log: string[];
}
const state: PriceJobState = { running:false, lastRun:null, lastDuration:null, lastUpdated:0, lastErrors:0, nextRun:null, progress:null, log:[] };
let _timer: any = null;
let _started = false; // true, sobald start() lief (nur im Primary) — schützt reschedule()

/**
 * Namensraum der prozessübergreifenden Sperre für den Preislauf.
 *
 * Die Zahl steht seit Nachtrag 149 nicht mehr hier, sondern in
 * utils/lockNamespaces.ts — zusammen mit allen anderen. Hier stand vorher eine
 * abgeschriebene Liste der belegten Namensräume; sie kannte 55 und 58 nicht
 * und wäre bei der nächsten Ergänzung wieder veraltet gewesen.
 */
const { LOCKS } = require('../utils/lockNamespaces');
const PRICE_JOB_LOCK = LOCKS.PREIS_JOB;

/**
 * Sperre über die ganze Laufzeit halten — auf einer EIGENEN Verbindung.
 * Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#acquirerunlock
 * @returns Freigabefunktion, oder null wenn anderswo bereits ein Lauf läuft
 */
async function acquireRunLock(): Promise<(() => Promise<void>) | null> {
  let client;
  try { client = await db.pool.connect(); }
  catch (e) {
    // Ohne Verbindung keine Sperre — dann lieber laufen als gar nicht
    // aktualisieren. state.running schützt im eigenen Prozess weiterhin.
    log(`Sperre nicht verfügbar (${fehlertext(e)}) — Lauf ohne prozessübergreifenden Schutz`);
    return async () => {};
  }
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [PRICE_JOB_LOCK]);
    if (!rows[0]?.ok) { client.release(); return null; }
  } catch (e) {
    client.release();
    log(`Sperre nicht verfügbar (${fehlertext(e)}) — Lauf ohne prozessübergreifenden Schutz`);
    return async () => {};
  }
  return async () => {
    try { await client.query('SELECT pg_advisory_unlock($1, 0)', [PRICE_JOB_LOCK]); }
    catch (e) { log(`Sperre konnte nicht freigegeben werden: ${fehlertext(e)}`); }
    finally { client.release(); }
  };
}

function log(msg: string) {
  const line = `[${new Date().toISOString().replace('T',' ').substring(0,19)}] ${msg}`;
  console.log('  PriceJob:', msg);
  state.log.unshift(line);
  if (state.log.length > 50) state.log.length = 50;
}

// getSetting()/getGlobalSetting() standen hier als wortgleiche Kopien von
// utils/settings.ts — inklusive der eigenen SELECT-Anweisung auf
// global_settings. Beide sind ersatzlos gestrichen: Wer den Tabellenzugriff
// aendert (Zwischenspeicher, Umbenennung einer Spalte), soll das an EINER …
// Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#parallellimit

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results = new Array(tasks.length); let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; const t = tasks[i]; if (t) results[i] = await t(); } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// forceTtlHours ist `string | number`: dieselbe Herkunft wie in
// utils/financeCalc.ts — getGlobalSetting() liefert eine Zeichenkette,
// andere Aufrufer eine Zahl.
async function fetchAndCachePrice(setNumber: string, condition: string, guideType: string,
                                  currency: string, forceTtlHours?: string | number) {
  if (ohneBricklinkPreis(await katalogEintrag(setNumber))) return 'skipped_gear';

  const ttl = Math.max(1, parseInt(String(forceTtlHours ?? '')));
  // Dieselbe Frisch-Regel wie im Anfrageweg (utils/financeCalc.ts). Hier stand
  // vorher `SELECT 1 ... fetched_at > ttl` — das erklaerte auch eine
  // Null-Zeile fuer die volle Laufzeit fuer frisch, waehrend der Anfrageweg
  // es nach sechs Stunden erneut versucht. cacheUsable() kennt beide Faelle.
  const vorhanden = await preisAusCache(setNumber, condition, currency, ttl);
  if (cacheUsable(vorhanden, ttl)) return 'skipped';

  const rl = await kontingentFrei('bricklink');
  if (!rl.allowed) { log(`BrickLink Tageslimit erreicht (${rl.limit}/Tag) — Job pausiert`); return 'rate_limited'; }

  const fallback = condition === 'N' ? 'U' : 'N';
  let g;
  try { g = await getPriceGuide(setNumber, condition, guideType, currency); }
  catch (e) { log(`Error ${setNumber} (${condition}): ${fehlertext(e).substring(0,60)}`); return 'error'; }

  // Die Antwort zum ANGEFRAGTEN Zustand immer wegschreiben, auch eine mit
  // lauter Nullen: Sie ist es, die den naechsten Lauf zurueckhaelt. Vorher
  // sprang der Rueckfall unten mit `return` heraus, sobald der andere Zustand
  // einen Preis hatte — die Null-Zeile fehlte, und derselbe Set kostete
  // jeden Lauf wieder zwei BrickLink-Abrufe.
  const p = await speicherePreis(setNumber, condition, currency, g);

  if (p.avg === 0 && p.qavg === 0) {
    const rl2 = await kontingentFrei('bricklink');
    if (rl2.allowed) {
      try {
        const g2 = await getPriceGuide(setNumber, fallback, guideType, currency);
        await speicherePreis(setNumber, fallback, currency, g2);
      } catch (e) { meldeUndWeiter('preis-job:rueckfall-zustand', e); }
    }
  }
  return 'updated';
}

/**
 * @param vorhandeneSperre bereits gehaltene Sperre (siehe triggerNow) — dann
 *        wird KEINE zweite geholt. pg_try_advisory_lock ist je Sitzung
 *        rekursiv: Ein zweiter Aufruf auf derselben Verbindung gelänge und
 *        bräuchte zwei Freigaben, ein Aufruf auf einer anderen Verbindung
 *        scheiterte am eigenen Lauf.
 */
async function runPriceRefresh(vorhandeneSperre?: (() => Promise<void>) | null) {
  // Billige Vorprüfung im eigenen Prozess; die belastbare Antwort gibt die
  // Sperre unten.
  if (state.running) { log('Already running, skipping'); return; }
  const ck = await getGlobalSetting('bricklink_consumer_key', '');
  if (!ck) {
    log('BrickLink credentials not configured, skipping');
    if (vorhandeneSperre) await vorhandeneSperre();
    scheduleNext();
    return;
  }

  const releaseLock = vorhandeneSperre ?? await acquireRunLock();
  if (!releaseLock) {
    log('Läuft bereits in einem anderen Worker — übersprungen');
    scheduleNext();
    return;
  }

  state.running = true; state.progress = null;
  const t0 = Date.now(); let updated=0, skipped=0, errors=0;
  monitor.update('priceJob', { status:'running', progress:0, total:0, sub:'Starte…', lastRun:new Date().toISOString() });
  try {
    // Weil dieser Lauf bis hierher nur `sets` kannte. Ein Merkposten ist kein
    // Bestand, hatte also nie einen Preis im Cache — und /price-history LIEST
    // den Cache nur, es holt nichts. Das Merkposten-Detail zeigte deshalb „—",
    // und der Preisverlauf blieb leer, weil nie jemand einen Punkt schrieb.
    // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh-eigene
    const eigene = await db.all('SELECT DISTINCT user_id, set_number FROM sets');
    const gewuenschte = await db.all(
      'SELECT DISTINCT user_id, set_number FROM wanted').catch(() => []);
    const allSets = [...eigene, ...(gewuenschte || [])]
      .filter((r, i, a) => a.findIndex(x =>
        x.user_id === r.user_id && x.set_number === r.set_number) === i)
      .sort((a, b) => a.user_id - b.user_id);
    // KEIN scheduleNext() hier: Der finally-Block unten macht das ohnehin, und
    // zwar für JEDEN Ausgang. Vorher stand es an beiden Stellen — ein Lauf
    // ohne Sets hinterliess dadurch ZWEI Intervall-Timer statt einem (am
    // laufenden Job nachgezählt). Weil jeder gefeuerte Timer wieder einen Lauf …
    // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh
    if (!allSets.length) { log('No sets, nothing to do'); state.lastRun=new Date().toISOString(); return; }
    log(`Starting: ${allSets.length} set-slots`);
    // Eigene Referenz statt state.progress in der Schleife: Der finally-Block
    // setzt state.progress am Ende auf null, die Aufgaben laufen aber
    // nebenläufig (parallelLimit). Über `fortschritt` hängt der Zähler nicht
    // daran, dass das gemeinsame Feld genau jetzt noch gesetzt ist.
    const fortschritt = { current:0, total:allSets.length, set:null as string | null };
    state.progress = fortschritt;
    monitor.update('priceJob', { status:'running', progress:0, total:allSets.length, sub:`0/${allSets.length} Sets` });
    const byUser: any = {};
    for (const row of allSets) (byUser[row.user_id] = byUser[row.user_id] || []).push(row.set_number);
    for (const [userId, setNumbers] of Object.entries(byUser)) {
      // Number(): Object.entries() gibt Schluessel als ZEICHENKETTEN zurueck,
      // auch wenn sie aus row.user_id (einer Zahl) stammen. Postgres wuerde
      // '7' fuer die integer-Spalte zwar umwandeln — auf genau diese
      // Umwandlung wollen wir uns hier nicht verlassen.
      const currency  = await getSetting(Number(userId), 'currency', 'EUR');
      // 'sold' = tatsächlich erzielte Preise der letzten sechs Monate.
      const guideType = 'sold';
      const ttlHours  = (await getGlobalSetting('price_cache_ttl', '24')) || '24';
      const valid = (setNumbers as string[]).filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));

      // Zustände je Set vorab bestimmen — drei Abfragen für den ganzen Nutzer,
      // nicht drei je Set. Gemischte Sets brauchen beide Preise, reine nur
      // einen; jeder überflüssige Abruf ginge auf das BrickLink-Tageskontingent.
      // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh-zustaende
      const zustaende = await zustaendeJeSet(Number(userId), valid);

      const tasks = valid.map(sn => async () => {
        fortschritt.current++; fortschritt.set = sn;
        monitor.update('priceJob', { status:'running', progress:fortschritt.current, total:fortschritt.total, sub:`${sn} (${fortschritt.current}/${fortschritt.total})` });
        const conditions = zustaende.get(sn) ?? ['N'];
        let last = 'skipped';
        for (const c of conditions) {
          try {
            const r = await fetchAndCachePrice(sn, c, guideType, currency, ttlHours);
            if (r === 'updated') { updated++; last = 'updated'; }
            else if (r === 'rate_limited') { errors++; return 'rate_limited'; }
            else if (last !== 'updated') { skipped++; }
          } catch (e) { errors++; log(`Error ${sn} (${c}): ${fehlertext(e).substring(0,80)}`); last = 'error'; }
        }
        return last;
      });
      await parallelLimit(tasks, 5);
    }
    const dur = Date.now() - t0;
    log(`Done: ${updated} updated, ${skipped} skipped, ${errors} errors — ${(dur/1000).toFixed(1)}s`);
    state.lastRun=new Date().toISOString(); state.lastDuration=dur; state.lastUpdated=updated; state.lastErrors=errors;
    monitor.update('priceJob', { status:'done', progress:state.progress?.total||0, total:state.progress?.total||0, sub:`${updated} aktualisiert, ${errors} Fehler — ${(dur/1000).toFixed(1)}s`, lastRun:state.lastRun });

    // Daily snapshot: copy all price_cache entries to price_history (once per day)
    log('Writing daily price_history snapshot from price_cache...');
    try {
      const inserted = await db.run(`
        INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, recorded_at)
        SELECT set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, NOW()
        FROM price_cache
        WHERE (avg_price > 0 OR qty_avg_price > 0)
          AND NOT EXISTS (
            SELECT 1 FROM price_history ph
            WHERE ph.set_number = price_cache.set_number
              AND ph.condition = price_cache.condition
              AND ph.currency_code = price_cache.currency_code
              AND ph.recorded_at::date = CURRENT_DATE
          ) ON CONFLICT DO NOTHING
      `);
      // Mit ZAHL: Die Meldung stand vorher ohne sie da, obwohl das Ergebnis
      // in `inserted` schon bereitlag — ungenutzt. Ob der Schnappschuss 0
      // oder 5000 Zeilen geschrieben hat, war damit aus dem Log nicht zu
      // erkennen. Gefunden von noUnusedLocals.
      log(`Daily snapshot: ${inserted.changes} price history entries inserted`);
    } catch(e) { log(`Daily snapshot error: ${fehlertext(e)}`); }

    // Preisalarme
    // Hier und nicht in fetchAndCachePrice(): Dort wird JE SET UND ZUSTAND
    // geholt, oft auch ohne dass sich etwas geaendert hat (Cache-Treffer).
    // Eine Pruefung dort liefe pro Lauf tausendfach und meldete dieselbe …
    // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh-2
    try {
      const { pruefeSet } = require('../utils/preisalarm');
      const wartende = await db.all(
        'SELECT DISTINCT set_number FROM price_alerts').catch(() => []);
      let gemeldet = 0;
      for (const z of wartende || []) gemeldet += await pruefeSet(String(z.set_number));
      if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
    } catch (e) { log(`Preisalarm error: ${fehlertext(e)}`); }

    // Der Portfolio-Schnappschuss je Konto ist entfallen.
    // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#abschnitt

  } catch (e) { log(`Fatal: ${fehlertext(e)}`); }
  finally {
    state.running=false; state.progress=null;
    await releaseLock();   // MUSS hier stehen: sonst blockiert ein abgestürzter
                           // Lauf alle folgenden bis zum Neustart
    scheduleNext();
  }
}

/**
 * Welche Preis-Zustände braucht dieser Nutzer für diese Sets?
 * Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#zustaendejeset
 * @param hintCondition Zustand einer Erfassung, die es noch nicht GIBT (siehe
 * @returns Map mit einem Eintrag je übergebenem Set, nie leer je Eintrag
 */
async function zustaendeJeSet(userId: number, setNumbers: string[],
                              hintCondition: string | null = null): Promise<Map<string, string[]>> {
  const ergebnis = new Map<string, string[]>();
  if (!setNumbers.length) return ergebnis;

  // Der Typ steht an jeder Abfrage, weil `db.all(...).catch(() => [])` eine
  // Union aus any[] und never[] ergibt — darauf verliert .map() sein Ergebnis
  // nach unknown[], und die Zusage oben wäre nicht mehr einlösbar.
  type ZustandsZeile = { set_number: string; c?: string | null };
  const sammle = async (sql: string): Promise<Map<string, Set<string>>> => {
    const zeilen: ZustandsZeile[] = await db.all(sql, [userId, setNumbers]).catch(() => []);
    const m = new Map<string, Set<string>>();
    for (const r of zeilen) {
      if (!m.has(r.set_number)) m.set(r.set_number, new Set<string>());
      m.get(r.set_number)!.add(r.c === 'U' ? 'U' : 'N');
    }
    return m;
  };

  const erfasst = await sammle(
    `SELECT set_number, COALESCE(condition,'N') AS c
       FROM set_acquisitions WHERE user_id=$1 AND set_number = ANY($2)
      GROUP BY set_number, COALESCE(condition,'N')`);
  const gewuenscht = await sammle(
    `SELECT DISTINCT set_number, COALESCE(condition,'N') AS c
       FROM wanted WHERE user_id=$1 AND set_number = ANY($2)`);

  for (const sn of setNumbers) {
    // Hier stand eine dritte Quelle: `COALESCE(condition,'N') FROM sets`, die
    // nur zählte, wenn es KEINE Erfassung gab. Mit Migration 0032 ist die
    // Spalte weg — und mit ihr der Fall, dass zwei Orte verschiedene Zustände
    // behaupten. Der Hinweis bleibt und ist jetzt die einzige Quelle für ein
    // Set, dessen Erfassung noch nicht geschrieben ist (siehe
    // conditionsNeededFor unten).
    const eigene = new Set<string>(erfasst.get(sn) ?? []);
    if (hintCondition === 'U' || hintCondition === 'N') eigene.add(hintCondition);
    for (const c of gewuenscht.get(sn) ?? []) eigene.add(c);
    ergebnis.set(sn, eigene.size ? [...eigene] : ['N']);
  }
  return ergebnis;
}

/**
 * Derselbe Beschluss für ein EINZELNES Set — der Weg beim Erfassen.
 * Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#conditionsneededfor
 * @returns {Promise<string[]>} z. B. ['N'], ['U'] oder ['N','U']
 */
async function conditionsNeededFor(setNumber: string, userId: number,
                                   hintCondition: string | null = null): Promise<string[]> {
  return (await zustaendeJeSet(userId, [setNumber], hintCondition)).get(setNumber) ?? ['N'];
}

async function refreshPriceForSet(setNumber: string, userId: number, hintCondition: string | null = null) {
  if (!/^[a-zA-Z0-9]+-\d+$/.test(setNumber)) { log(`Skipping invalid: ${setNumber}`); return; }
  const ck = await getGlobalSetting('bricklink_consumer_key', '');
  if (!ck) return;
  try {
    const currency  = await getSetting(userId, 'currency', 'EUR');
    // 'sold' = tatsächlich erzielte Preise der letzten sechs Monate.
    const guideType = 'sold';
    // Alle Zustände holen, die das Set tatsächlich führt — sonst fehlt bei
    // gemischten Sets eine Hälfte der Bewertung.
    const conditions = await conditionsNeededFor(setNumber, userId, hintCondition);
    log(`Immediate price fetch: ${setNumber} (${conditions.join('+')})`);
    for (const c of conditions) {
      await fetchAndCachePrice(setNumber, c, guideType, currency, 0);
    }
    log(`Immediate price done: ${setNumber}`);
  } catch (e) {
    // Suppress transient connection errors — they resolve on retry
    const isConnErr = fehlertext(e).includes('timeout') || fehlertext(e).includes('terminated') || fehlertext(e).includes('connect');
    if (!isConnErr) log(`Immediate price failed for ${setNumber}: ${fehlertext(e).substring(0, 80)}`);
  }
}

function scheduleNext() {
  if (_timer) clearTimeout(_timer);
  getGlobalSetting('price_job_interval_minutes', '60').then((gespeichert: unknown) => {
    const minutes = String(gespeichert || '60');
    // NOCHMAL abräumen: Zwischen dem clearTimeout oben und diesem Rückruf
    // liegt eine Datenbankabfrage. Läuft in dieser Lücke ein zweiter
    // scheduleNext()-Aufruf durch, überschriebe seine Zuweisung den Verweis
    // auf den hier gestellten Timer — der liefe dann unkündbar weiter und
    // stiesse einen zusätzlichen Lauf an.
    if (_timer) clearTimeout(_timer);
    const ms = Math.max(5, parseInt(minutes)) * 60 * 1000;
    state.nextRun = new Date(Date.now() + ms).toISOString();
    _timer = setTimeout(() => runPriceRefresh(), ms);
    log(`Next run in ${minutes} min`);
  });
}

function start() { _started = true; log('Background price job started'); setTimeout(() => runPriceRefresh(), 30 * 1000); }
function stop() { if (_timer) clearTimeout(_timer); log('Stopped'); }
// Intervall sofort neu anwenden (nach Config-Änderung im Monitoring). Läuft der
// Job gerade, greift das neue Intervall ohnehin über scheduleNext() im finally.
function reschedule() { if (!_started) return; if (state.running) return; if (_timer) { clearTimeout(_timer); _timer = null; } scheduleNext(); }
function getJobStatus() { return { running:state.running, lastRun:state.lastRun, lastDuration:state.lastDuration, lastUpdated:state.lastUpdated, lastErrors:state.lastErrors, nextRun:state.nextRun, progress:state.progress, log:state.log.slice(0,15) }; }
/**
 * Manueller Anstoss aus dem Monitoring.
 * Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#triggernow
 */
async function triggerNow(): Promise<boolean> {
  if (state.running) return false;
  const lock = await acquireRunLock();
  if (!lock) return false;
  setImmediate(() => runPriceRefresh(lock));
  return true;
}

export { start, stop, reschedule, getJobStatus, triggerNow, refreshPriceForSet, fetchAndCachePrice,
         zustaendeJeSet, conditionsNeededFor };