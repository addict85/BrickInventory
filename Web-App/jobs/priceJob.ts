'use strict';

import { kontingentFrei, speicherePreis, cacheUsable, preisAusCache, parallelLimit } from '../utils/financeCalc';
import { meldeUndWeiter, fehlertext, meldeUndLiefere, logAndContinue } from '../src/infra/httpError';
import { liesZustand, setzeZustand } from '../utils/laufzustand';
import { AuftragVerschieben, type AuftragsKontext } from './auftragsWorker';
import { getSetting, getGlobalSetting } from '../utils/settings';
import { katalogEintrag, ohneBricklinkPreis } from '../utils/setNummer';
import * as db from '../db/database';
import * as monitor from '../utils/jobMonitor';
import { getPriceGuide } from '../clients/bricklink';
import { LOCKS } from '../src/infra/lockNamespaces';
import { pruefeSet } from '../utils/preisalarm';

/**
 * Was der letzte Lauf hinterliess, für /admin/job-status: Der Job läuft im
 * Job-Prozess, gelesen wird im Web-Prozess — darum in laufzustand.
 */
export const PREIS_STAND = 'preis_job_stand';
/** Die letzten Protokollzeilen dieses Prozesses; am Ende eines Laufs nach PREIS_STAND geschrieben. */
const _log: string[] = [];

/** Namensraum der prozessübergreifenden Sperre; alle Nummern stehen in src/infra/lockNamespaces.ts. */
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
    // aktualisieren; im eigenen Prozess schützt die Exklusivität der Art.
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
  _log.unshift(line);
  if (_log.length > 50) _log.length = 50;
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
 * Ein Lauf als Auftrag 'preise' (geplant, utils/zeitplan.ts). Hält ein
 * anderer Prozess die Sperre, wird er eine Minute später neu versucht.
 */
async function runPriceRefresh(k?: AuftragsKontext) {
  const ck = await getGlobalSetting('bricklink_consumer_key', '');
  if (!ck) { log('BrickLink credentials not configured, skipping'); await merkeStand({}); return; }

  const releaseLock = await acquireRunLock();
  if (!releaseLock) throw new AuftragVerschieben(new Date(Date.now() + 60_000), 'Läuft bereits in einem anderen Prozess');

  const t0 = Date.now(); let updated=0, skipped=0, errors=0;
  const fortschritt = { current:0, total:0, set:null as string | null };
  monitor.update('priceJob', { status:'running', progress:0, total:0, sub:'Starte…', lastRun:new Date().toISOString() });
  try {
    // Weil dieser Lauf bis hierher nur `sets` kannte. Ein Merkposten ist kein
    // Bestand, hatte also nie einen Preis im Cache — und /price-history LIEST
    // den Cache nur, es holt nichts. Das Merkposten-Detail zeigte deshalb „—",
    // und der Preisverlauf blieb leer, weil nie jemand einen Punkt schrieb.
    // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh-eigene
    const eigene = await db.all('SELECT DISTINCT user_id, set_number FROM sets');
    const gewuenschte = await db.all(
      'SELECT DISTINCT user_id, set_number FROM wanted').catch(meldeUndLiefere('preis-job:gewuenschte', []));
    const allSets = [...eigene, ...(gewuenschte || [])]
      .filter((r, i, a) => a.findIndex(x =>
        x.user_id === r.user_id && x.set_number === r.set_number) === i)
      .sort((a, b) => a.user_id - b.user_id);
    if (!allSets.length) { log('No sets, nothing to do'); await merkeStand({ lastRun: new Date().toISOString() }); return; }
    log(`Starting: ${allSets.length} set-slots`);
    fortschritt.total = allSets.length;
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
        if (k && fortschritt.current % 10 === 1)
          await k.fortschritt({ erledigt: fortschritt.current, gesamt: fortschritt.total, text: sn });
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
    const lastRun = new Date().toISOString();
    await merkeStand({ lastRun, lastDuration: dur, lastUpdated: updated, lastErrors: errors });
    monitor.update('priceJob', { status:'done', progress:fortschritt.total, total:fortschritt.total, sub:`${updated} aktualisiert, ${errors} Fehler — ${(dur/1000).toFixed(1)}s`, lastRun });

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
      const wartende = await db.all(
        'SELECT DISTINCT set_number FROM price_alerts').catch(meldeUndLiefere('preis-job:wartende', []));
      let gemeldet = 0;
      for (const z of wartende || []) gemeldet += await pruefeSet(String(z.set_number));
      if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
    } catch (e) { log(`Preisalarm error: ${fehlertext(e)}`); }

    // Der Portfolio-Schnappschuss je Konto ist entfallen.
    // Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#abschnitt

  } catch (e) { log(`Fatal: ${fehlertext(e)}`); await merkeStand({}); throw e; }
  finally {
    await releaseLock();   // MUSS hier stehen: sonst blockiert ein abgestürzter
                           // Lauf alle folgenden bis zum Neustart
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
    const zeilen: ZustandsZeile[] = await db.all(sql, [userId, setNumbers]).catch(meldeUndLiefere('preis-job:all', []));
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
    // Ohne Erfassung ist der Hinweis die einzige Quelle: Die Erfassung des
    // neuen Sets ist noch nicht geschrieben (conditionsNeededFor).
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

/** Stand und Protokoll für die Verwaltung ablegen; fehlende Felder behalten ihren Wert. */
async function merkeStand(neu: Record<string, unknown>): Promise<void> {
  const alt = await liesZustand(PREIS_STAND).then(r => (r ? JSON.parse(r) : {}), () => ({}));
  await setzeZustand(PREIS_STAND, JSON.stringify({ ...alt, ...neu, log: _log.slice(0, 15) }))
    .catch(logAndContinue('preis-job:stand'));
}

export { runPriceRefresh, refreshPriceForSet, fetchAndCachePrice,
         zustaendeJeSet, conditionsNeededFor };