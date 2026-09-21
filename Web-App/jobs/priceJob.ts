'use strict';

const db      = require('../db/database');
import { checkAndIncrementRateLimit, speicherePreis, cacheUsable, preisAusCache } from '../utils/financeCalc';
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
 *
 * ── Warum state.running nicht reicht ────────────────────────────────────────
 * `state.running` liegt im Speicher EINES Prozesses. Geplant läuft der Job nur
 * im Primary-Worker, aber es gibt zwei manuelle Auslöser
 * (POST /api/finance/job-trigger und POST /api/v1/admin/trigger-price-job), und
 * die laufen in dem Worker, der die Anfrage gerade bearbeitet. Dort war
 * state.running false — also startete ein vollständiger Preislauf, unabhängig
 * davon, ob im Primary gerade einer lief. Zwei Klicks auf verschiedenen Workern
 * ergaben zwei komplette Durchgänge über alle Sets, jeder mit eigenen
 * BrickLink-Aufrufen, und beide schrieben in dasselbe Fortschrittsfeld — die
 * Anzeige sprang zwischen den Ständen hin und her.
 *
 * Dieselbe Sache war beim Login-Zähler, beim Bild-Cache-Aufräumlauf und beim
 * Rebrickable-Tageskontingent schon behoben. Die Werkzeuge dafür liegen im
 * Projekt bereit; dem Preis-Job fehlte nur die Sperre.
 *
 * KEIN pg_try_advisory_xact_lock: Der Lauf dauert Minuten, eine Transaktion so
 * lange offen zu halten wäre falsch. Deshalb eine eigene Verbindung aus dem
 * Pool, die bis zum Ende gehalten und im finally freigegeben wird — sonst
 * blockiert ein abgestürzter Lauf alle folgenden bis zum Neustart.
 *
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
// aendert (Zwischenspeicher, Umbenennung einer Spalte), soll das an EINER
// Stelle tun und nicht danach suchen muessen.
//
// Ein Unterschied bleibt zu beachten: Die zentrale Fassung nimmt den
// Ersatzwert nur bei NULL (`??`), die hiesige Kopie nahm ihn auch bei einem
// leeren Eintrag (`||`). Fuer die beiden Zahlenwerte unten haengt daran, ob
// parseInt('') ein NaN liefert — deshalb steht dort jeweils ein
// ausgeschriebenes `||`.

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

  const rl = await checkAndIncrementRateLimit('bricklink');
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
    const rl2 = await checkAndIncrementRateLimit('bricklink');
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
    // ── Bestand UND Merkliste ──────────────────────────────────────────
    //
    // Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?"
    //
    // Weil dieser Lauf bis hierher nur `sets` kannte. Ein Merkposten ist kein
    // Bestand, hatte also nie einen Preis im Cache — und /price-history LIEST
    // den Cache nur, es holt nichts. Das Merkposten-Detail zeigte deshalb „—",
    // und der Preisverlauf blieb leer, weil nie jemand einen Punkt schrieb.
    //
    // Ausgerechnet fuer einen MERKPOSTEN ist die Preisentwicklung das
    // Wichtigste: Man wartet ja darauf. Ein Set, das man schon hat, braucht
    // sie weniger dringend als eines, das man kaufen will.
    //
    // ── Was der Merklisten-Anteil kostet (Marcos Frage) ────────────────────
    //
    // Ein Merkposten bringt eine zusaetzliche Zeile in diese Liste, also einen
    // zusaetzlichen Durchgang durch fetchAndCachePrice() je gewuenschtem
    // Zustand. Ein BrickLink-Abruf wird daraus aber nur, wenn der Cache
    // nichts Frisches hat — und price_cache ist ueber
    // (set_number, condition, currency_code) verschluesselt, NICHT ueber den
    // Nutzer (db/schema.sql). Daraus folgt die Obergrenze:
    //
    //   Abrufe/Tag  =  Anzahl verschiedener (Set, Zustand, Waehrung) ueber
    //                  ALLE Merklisten, die nicht ohnehin im Bestand sind
    //                  +  einer je Antwort ganz ohne Preis (Rueckfall auf den
    //                     anderen Zustand, siehe fetchAndCachePrice)
    //
    // Zwei Nutzer mit demselben Merkposten in derselben Waehrung kosten also
    // EINEN Abruf, nicht zwei; ein Merkposten auf ein Set, das jemand schon
    // besitzt, kostet nichts. Der Takt ist price_cache_ttl (Vorgabe 24 h),
    // nicht das Job-Intervall — ein stuendlicher Lauf fragt denselben Merkposten
    // trotzdem nur einmal am Tag. Nur Sets, zu denen BrickLink gar keinen
    // Preis kennt, werden oefter versucht (ZERO_PRICE_TTL_HOURS = 6 h).
    //
    // Wer das nicht will, nimmt die zweite Haelfte wieder heraus; dann bleibt
    // das Merkposten-Detail auf den Preis angewiesen, den es beim Oeffnen selbst
    // holt (routes/api_v1/wanted.ts) — und es entsteht kein Verlauf.
    //
    // `.catch`: Ein Aufbau, der nur initSchema() gelaufen ist, hat die
    // Tabelle nicht (siehe db/schema.sql). Dann bleibt es beim Bestand.
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
    // laufenden Job nachgezählt). Weil jeder gefeuerte Timer wieder einen Lauf
    // startet und der wieder Timer stellt, wächst die Zahl der geplanten Läufe
    // mit der Zeit — der Job liefe irgendwann viel häufiger als eingestellt und
    // verbrennt das BrickLink-Tageskontingent. Im Test hielten die
    // überzähligen Timer ausserdem den Prozess am Leben, bis der Runner nach
    // 60 s abbrach.
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
      //
      // Hier stand die Regel vorher ein ZWEITES Mal (Erfassungen, sonst
      // sets-Zeile, sonst DEFAULT_PRICE_CONDITION) — und diese Fassung kannte
      // die Merkliste nicht. Ein Merkposten hat weder Erfassung noch sets-Zeile,
      // fiel also auf den Vorgabewert durch, und der ist 'U'
      // (utils/finance/preise.ts). Gemessen hiess das: JEDER Merkposten wurde als
      // GEBRAUCHT geholt — auch der auf ein neues Set. Der Preisverlauf im
      // Merkposten-Detail füllte sich damit für den falschen Zustand, und für den
      // gewünschten blieb er leer.
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

    // ── Preisalarme (Nachtrag 176) ──────────────────────────────────────────
    //
    // Hier und nicht in fetchAndCachePrice(): Dort wird JE SET UND ZUSTAND
    // geholt, oft auch ohne dass sich etwas geaendert hat (Cache-Treffer).
    // Eine Pruefung dort liefe pro Lauf tausendfach und meldete dieselbe
    // Schwelle mehrfach je Durchgang.
    //
    // Am Ende des Laufs steht dagegen fest, was heute gilt — und die Pruefung
    // geht nur noch die Sets durch, auf die ueberhaupt jemand wartet.
    //
    // Der ganze Block ist gekapselt: Ein nicht erreichbarer SMTP-Server oder
    // eine fehlende Tabelle darf den Preislauf nicht abbrechen. Die Preise
    // sind dann geholt, nur die Meldung fehlt — und sie wird beim naechsten
    // Lauf erneut versucht, weil der Merker ungesetzt bleibt.
    try {
      const { pruefeSet } = require('../utils/preisalarm');
      const wartende = await db.all(
        'SELECT DISTINCT set_number FROM price_alerts').catch(() => []);
      let gemeldet = 0;
      for (const z of wartende || []) gemeldet += await pruefeSet(String(z.set_number));
      if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
    } catch (e) { log(`Preisalarm error: ${fehlertext(e)}`); }

    // Der Portfolio-Schnappschuss je Konto ist entfallen (Nachtrag 82).
    //
    // Er legte täglich einen Gesamtwert unter dem Pseudo-Set
    // '__portfolio__<id>' ab, und die Kurve las für ein einzelnes Konto daraus.
    // Ein Schnappschuss hält aber fest, was AN JENEM TAG erfasst war — die
    // Frage „was wäre der heutige Bestand damals wert gewesen" lässt sich
    // daraus nicht beantworten, und genau daran hingen Marcos +850 %. Die
    // Kurve rekonstruiert jetzt aus dem Verlauf JE SET, für jede
    // Kontoauswahl gleich.
    //
    // Nebenbei gespart: eine price_cache-Abfrage je Set und Konto bei JEDEM
    // Lauf, plus eine Zeile je Konto und Tag in price_history.

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
 *
 * ── Die eine Fassung der Regel ─────────────────────────────────────────────
 * Sie stand zweimal im Baum: einmal hier als conditionsNeededFor() für EIN Set
 * (Sofort-Abruf beim Erfassen) und einmal ausgeschrieben in der Schleife des
 * Nachtlaufs, dort gebündelt über alle Sets eines Nutzers. Zwei Fassungen,
 * und sie waren nicht gleich: Die Schleife kannte die Merkliste nicht.
 * Deshalb steht die Regel jetzt EINMAL, gebündelt — der Einzelfall ist eine
 * Liste mit einem Eintrag.
 *
 * ── Die Staffelung ─────────────────────────────────────────────────────────
 *
 *   Bestand    die vorkommenden Zustände der Erfassungen, plus der Hinweis;
 *              sonst der gespeicherte Zustand der sets-Zeile
 *   Merkposten     die gewünschten Zustände — sie treten IMMER hinzu
 *   sonst      'N'
 *
 * Seit der zustandsabhängigen Bewertung (utils/setValue.ts) braucht ein Set mit
 * einem neuen UND einem gebrauchten Exemplar BEIDE Preise im Cache. Vorher holte
 * der Job immer nur einen Zustand und wich nur dann auf den anderen aus, wenn
 * der erste gar keinen Preis lieferte — bei gemischten Sets fehlte damit dauerhaft
 * eine Hälfte, und die Bewertung fiel auf den jeweils anderen Zustand zurück.
 *
 * ── Warum der Merkposten HINZUTRITT statt zu verlieren ─────────────────────────
 * Wer ein Set neu besitzt und ein gebrauchtes zweites sucht, wartet auf den
 * Gebraucht-Preis — den Neu-Preis hat er schon. Beide Fragen sind echt, also
 * werden beide beantwortet. Das kostet einen zusätzlichen Abruf, aber nur für
 * Sets, die jemand besitzt UND in einem ANDEREN Zustand wünscht.
 *
 * Bewusst nur die tatsächlich vorkommenden Zustände: Jeder zusätzliche Abruf geht
 * auf das BrickLink-Tageskontingent, und für ein reines Neu-Set ist der
 * Gebraucht-Preis wertlos.
 *
 * `.catch`: Ein Aufbau, der nur initSchema() gelaufen ist, hat die
 * wanted-Tabelle nicht (siehe db/schema.sql). Dann bleibt es beim Bestand.
 *
 * @param hintCondition Zustand einer Erfassung, die es noch nicht GIBT (siehe
 *        conditionsNeededFor) — gilt für alle übergebenen Sets, wird deshalb
 *        nur mit einem einzelnen aufgerufen.
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
  const bestand = await sammle(
    `SELECT set_number, COALESCE(condition,'N') AS c
       FROM sets WHERE user_id=$1 AND set_number = ANY($2)`);
  const gewuenscht = await sammle(
    `SELECT DISTINCT set_number, COALESCE(condition,'N') AS c
       FROM wanted WHERE user_id=$1 AND set_number = ANY($2)`);

  for (const sn of setNumbers) {
    // Der Hinweis tritt neben die Erfassungen und verdrängt die sets-Zeile:
    // Beim Anlegen eines NEUEN Sets existiert noch keine von beiden.
    const eigene = new Set<string>(erfasst.get(sn) ?? []);
    if (hintCondition === 'U' || hintCondition === 'N') eigene.add(hintCondition);
    if (!eigene.size) for (const c of bestand.get(sn) ?? []) eigene.add(c);
    for (const c of gewuenscht.get(sn) ?? []) eigene.add(c);
    ergebnis.set(sn, eigene.size ? [...eigene] : ['N']);
  }
  return ergebnis;
}

/**
 * Derselbe Beschluss für ein EINZELNES Set — der Weg beim Erfassen.
 *
 * Der Hinweis ist hier das Entscheidende: Beim Anlegen eines neuen Sets
 * existiert weder die sets- noch die set_acquisitions-Zeile schon, denn
 * getCurrentMarketPrice() ruft refreshPriceForSet() auf, BEVOR
 * recordAcquisition() geschrieben hat. Ohne den Hinweis sah diese Funktion
 * nichts, fiel auf 'N' zurück, und nur der Neupreis wurde geholt. Die
 * anschliessende Preisabfrage fand für 'U' noch nichts im Cache und wich auf
 * den gerade gecachten Neupreis aus — ein als gebraucht importiertes Set
 * bekam so den Neupreis als Kaufpreis, obwohl „Gebraucht" gewählt war.
 *
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
 *
 * Holt die Sperre SELBST, statt sie dem Lauf zu überlassen: Nur so kann die
 * Antwort ehrlich sein. Vorher meldete die Route `started: true`, sobald der
 * eigene Prozess nicht beschäftigt war — lief anderswo schon ein Durchgang,
 * stimmte die Meldung nicht, und ein zweiter Klick startete tatsächlich einen
 * zweiten kompletten Lauf über alle Sets.
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