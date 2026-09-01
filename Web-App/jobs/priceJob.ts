'use strict';

const db      = require('../db/database');
import { checkAndIncrementRateLimit } from '../utils/financeCalc';
import { meldeUndWeiter, fehlertext } from '../utils/httpError';
const monitor = require('../utils/jobMonitor');
const { getPriceGuide } = require('../clients/bricklink');
const { DEFAULT_PRICE_CONDITION } = require('../utils/financeCalc');

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

async function getSetting(userId: number, key: string, fallback: any) {
  const u = await db.get('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
  if (u?.value) return u.value;
  const g = await db.get('SELECT value FROM global_settings WHERE key = $1', [key]);
  return g?.value || fallback;
}
/**
 * Es gab diese Funktion zweimal in derselben Datei — die zweite Definition
 * überschrieb die erste stillschweigend. Inhaltlich taten beide dasselbe;
 * TypeScript hat das Duplikat beim Umstellen aufgedeckt.
 */
async function getGlobalSetting(key: string, fallback: any) {
  return (await db.get('SELECT value FROM global_settings WHERE key = $1', [key]))?.value || fallback;
}

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
  const catalog = await db.get('SELECT is_gear, bl_type FROM catalog_cache WHERE set_number = $1', [setNumber]);
  if (catalog?.is_gear === 1 && catalog?.bl_type === 'NONE') return 'skipped_gear';

  const ttl = Math.max(1, parseInt(String(forceTtlHours ?? '')));
  const fresh = await db.get(
    `SELECT 1 FROM price_cache WHERE set_number = $1 AND condition = $2 AND currency_code = $3 AND fetched_at > NOW() - INTERVAL '${ttl} hours'`,
    [setNumber, condition, currency]);
  if (fresh) return 'skipped';

  const rl = await checkAndIncrementRateLimit('bricklink');
  if (!rl.allowed) { log(`BrickLink Tageslimit erreicht (${rl.limit}/Tag) — Job pausiert`); return 'rate_limited'; }

  const fallback = condition === 'N' ? 'U' : 'N';
  let g, usedCondition = condition;
  try { g = await getPriceGuide(setNumber, condition, guideType, currency); }
  catch (e) { log(`Error ${setNumber} (${condition}): ${fehlertext(e).substring(0,60)}`); return 'error'; }

  const avg = parseFloat(g?.avg_price||0), qavg = parseFloat(g?.qty_avg_price||0);
  if (avg === 0 && qavg === 0) {
    const rl2 = await checkAndIncrementRateLimit('bricklink');
    if (rl2.allowed) {
      try {
        const g2 = await getPriceGuide(setNumber, fallback, guideType, currency);
        const avg2 = parseFloat(g2?.avg_price||0), q2 = parseFloat(g2?.qty_avg_price||0);
        if (avg2 > 0 || q2 > 0) {
          await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET min_price=$4,avg_price=$5,max_price=$6,qty_avg_price=$7,total_quantity=$8,fetched_at=NOW()`,
            [setNumber, fallback, currency, parseFloat(g2.min_price||0), avg2, parseFloat(g2.max_price||0), q2, parseInt(g2.total_quantity||0)]);
          return 'updated';
        }
      } catch (e) { meldeUndWeiter('preis-job:rueckfall-zustand', e); }
    }
  }

  const min_p = parseFloat(g?.min_price||0), avg_p = parseFloat(g?.avg_price||0),
        max_p = parseFloat(g?.max_price||0), qavg_p = parseFloat(g?.qty_avg_price||0);
  await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET min_price=$4,avg_price=$5,max_price=$6,qty_avg_price=$7,total_quantity=$8,fetched_at=NOW()`,
    [setNumber, usedCondition, currency, min_p, avg_p, max_p, qavg_p, parseInt(g?.total_quantity||0)]);
  // Also write to price_history for chart (only when non-zero)
  if (avg_p > 0 || qavg_p > 0) {
    await db.run(
      'INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [setNumber, usedCondition, currency, avg_p, qavg_p, min_p, max_p]
    ).catch(()=>{});
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
    const allSets = await db.all('SELECT DISTINCT user_id, set_number FROM sets ORDER BY user_id');
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
      const ttlHours  = await getGlobalSetting('price_cache_ttl', '24');
      const valid = (setNumbers as string[]).filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));

      // Zustände je Set in EINER Abfrage vorab bestimmen, statt pro Set einzeln
      // nachzuschlagen. Gemischte Sets brauchen beide Preise (siehe
      // conditionsNeededFor), reine Sets nur einen — jeder überflüssige Abruf
      // ginge auf das BrickLink-Tageskontingent.
      const condRows = await db.all(
        `SELECT set_number, COALESCE(condition,'N') AS c
           FROM set_acquisitions WHERE user_id=$1 AND set_number = ANY($2)
          GROUP BY set_number, COALESCE(condition,'N')`,
        [userId, valid]).catch(() => []);
      const condBySet = new Map();
      for (const r of condRows) {
        if (!condBySet.has(r.set_number)) condBySet.set(r.set_number, new Set());
        condBySet.get(r.set_number).add(r.c === 'U' ? 'U' : 'N');
      }
      const storedCond = new Map(
        (await db.all('SELECT set_number, condition FROM sets WHERE user_id=$1', [userId]).catch(() => []))
          .map((r: { set_number: string; condition?: string | null }) =>
            [r.set_number, r.condition === 'U' ? 'U' : 'N']));

      const tasks = valid.map(sn => async () => {
        fortschritt.current++; fortschritt.set = sn;
        monitor.update('priceJob', { status:'running', progress:fortschritt.current, total:fortschritt.total, sub:`${sn} (${fortschritt.current}/${fortschritt.total})` });
        const conditions = condBySet.has(sn)
          ? [...condBySet.get(sn)]
          : [storedCond.get(sn) || DEFAULT_PRICE_CONDITION];
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
      log(`Daily snapshot: inserted price history entries`);
    } catch(e) { log(`Daily snapshot error: ${fehlertext(e)}`); }

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
 * Welche Zustände kommen in den Erfassungen dieses Sets vor?
 *
 * Seit der zustandsabhängigen Bewertung (utils/setValue.ts) braucht ein Set mit
 * einem neuen UND einem gebrauchten Exemplar BEIDE Preise im Cache. Vorher holte
 * der Job immer nur einen Zustand und wich nur dann auf den anderen aus, wenn
 * der erste gar keinen Preis lieferte — bei gemischten Sets fehlte damit dauerhaft
 * eine Hälfte, und die Bewertung fiel auf den jeweils anderen Zustand zurück.
 *
 * Bewusst nur die tatsächlich vorkommenden Zustände: Jeder zusätzliche Abruf geht
 * auf das BrickLink-Tageskontingent, und für ein reines Neu-Set ist der
 * Gebraucht-Preis wertlos.
 *
 * @returns {Promise<string[]>} z. B. ['N'], ['U'] oder ['N','U']
 */
async function conditionsNeededFor(setNumber: string, userId: number,
                                   hintCondition: string | null = null): Promise<string[]> {
  const rows = await db.all(
    `SELECT DISTINCT COALESCE(condition,'N') AS c
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
    [userId, setNumber]).catch(() => []);
  // Der Typ steht hier, weil `db.all(...).catch(() => [])` eine Union aus
  // any[] und never[] ergibt — darauf verliert .map() sein Ergebnis nach
  // unknown[], und die Zusage Promise<string[]> oben waere nicht mehr
  // einloesbar.
  const list: string[] = rows.map((r: { c?: string | null }) => (r.c === 'U' ? 'U' : 'N'));

  // Beim Anlegen eines NEUEN Sets existiert weder die sets- noch die
  // set_acquisitions-Zeile schon — getCurrentMarketPrice() ruft
  // refreshPriceForSet() auf, BEVOR recordAcquisition() geschrieben hat. Ohne
  // den Hinweis sah diese Funktion nichts, fiel auf 'N' zurück, und nur der
  // Neupreis wurde geholt. Die anschliessende Preisabfrage fand für 'U' noch
  // nichts im Cache und wich auf den gerade gecachten Neupreis aus — ein als
  // gebraucht importiertes Set bekam so den Neupreis als Kaufpreis, obwohl
  // „Gebraucht" gewählt war. Der hier übergebene Hinweis behebt genau das:
  // die Zeile existiert noch nicht, aber der GEWÜNSCHTE Zustand ist bekannt.
  if (hintCondition === 'U' || hintCondition === 'N') list.push(hintCondition);

  if (list.length) return [...new Set(list)];
  // Keine Erfassungen und kein Hinweis → der gespeicherte Zustand des Sets
  // entscheidet.
  const set = await db.get('SELECT condition FROM sets WHERE user_id=$1 AND set_number=$2',
    [userId, setNumber]).catch(() => null);
  return [set?.condition === 'U' ? 'U' : 'N'];
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
  getGlobalSetting('price_job_interval_minutes', '60').then(minutes => {
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

export { start, stop, reschedule, getJobStatus, triggerNow, refreshPriceForSet, fetchAndCachePrice };