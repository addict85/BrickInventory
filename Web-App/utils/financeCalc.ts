/**
 * Finance-Berechnungen: Preis-Fetching (BrickLink), Bewertungen (Sets/Teile/
 * Minifigs), G&V und API-Rate-Limiting.
 *
 * Aus routes/finance.js herausgelöst — die Routen-Datei ist jetzt ein dünner
 * HTTP-Adapter, die Fachlogik lebt hier und wird ausserdem von api_v1,
 * brickset, parts, minifigs, rebrickable und den Jobs direkt genutzt.
 * routes/finance.js re-exportiert alle Funktionen weiterhin, bestehende
 * require('./finance')-Konsumenten funktionieren unverändert.
 */

import * as db from '../db/database';
import { getSetting, getGlobalSetting } from './settings';
import { resolveImageLocal, proxyImageUrl } from './images';
import { asIds } from './household';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct, PNL_EPS } from './setValue';
import { REBRICKABLE_DEFAULT_DAILY } from './rateLimiter';
import { bricklinkRequest, getPriceGuide } from '../clients/bricklink';
import { fehlertext } from '../utils/httpError';

/**
 * Zustand eines Sets nach derselben Regel wie die Anzeige
 * (utils/handlers.ts → getSetConditionAggregate):
 * Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht; gibt es
 * Erfassungen ohne Gebraucht-Eintrag, ist es neu; ohne Erfassungen zählt der
 * gespeicherte Wert in sets.condition.
 *
 * Vorher richtete sich die Bewertung allein nach sets.condition. Weicht der
 * gespeicherte Wert von den Erfassungen ab — etwa weil ein Set nachträglich auf
 * „Neu" korrigiert wurde — zeigte die Kachel „Neu", der Marktpreis stammte aber
 * aus dem Gebraucht-Eintrag. Genau diese Abweichung war die Ursache für den
 * wiederholt zu niedrigen Preis.
 */
function effectiveCondition(set: any): 'N' | 'U' {
  const acqCount  = parseInt(set?.acq_count) || 0;
  const usedCount = parseInt(set?.used_count) || 0;
  if (usedCount > 0) return 'U';
  if (acqCount > 0)  return 'N';
  return set?.condition === 'U' ? 'U' : 'N';
}


/**
 * Die drei Fremd-Schnittstellen, deren Tagesbudget hier gezaehlt wird.
 *
 * Eine Union und KEIN string: Alle acht Aufrufstellen im Baum uebergeben eines
 * dieser drei Literale, nie einen Wert von aussen. Damit prueft der Uebersetzer
 * `defaults[apiName]` selbst — der Indexzugriff braucht hier weder ausTabelle()
 * noch einen Rueckfall gegen geerbte Mitglieder, weil gar kein fremder
 * Schluessel hineinkommen kann. (Anders als in routes/mailer.ts, wo der
 * Schluessel aus der Datenbank stammt.)
 */
type ApiName = 'bricklink' | 'rebrickable' | 'brickset';

/**
 * Blickfeld: wessen DATEN gerechnet werden. Getrennt von `viewerId`, wessen
 * EINSTELLUNGEN gelten — die beiden fallen auseinander, sobald der Kontofilter
 * auf „Unterkonten" steht (siehe computeSetsValuation).
 */
type Blickfeld = number[];

/** Eine Preis-Cache-Zeile, soweit hier gelesen. */
type PreisZeile = { avg_price?: number | string | null; fetched_at?: string | Date | null } | null | undefined;

/**
 * Cache-Dauer in Stunden — `string | number`, und das ist NACHGEMESSEN:
 *
 *   getGlobalSetting('price_cache_ttl', '24')  ->  Zeichenkette (DB-Textspalte,
 *                                                  Rueckfall '24')
 *   routes/minifigs.ts:201                     ->  die Zahl 24
 *
 * Deshalb bleibt `parseInt(String(ttlHours))` in den vier Rechnern stehen: Es
 * ist tragend, nicht Zierde. Ein blosses `number` waere dieselbe falsche
 * Annahme wie bei getPartAcquisitions im vorigen Commit.
 */
type Stunden = string | number;

/**
 * DIE Zustandsauflösung für ein einzelnes Set — per Datenbankabfrage, für
 * Aufrufer ohne bereits geladene acq_count/used_count-Felder.
 *
 * Fünfter Fundort desselben Fehlers in dieser Sitzung: computeSetsValuation(),
 * getCurrentMarketPrice(), computePnl() und die Preisverlauf-Route der Webapp
 * hatten alle ihre EIGENE, leicht abweichende Zustandsermittlung — mehrere
 * davon lasen dabei `DEFAULT_PRICE_CONDITION` (fest 'U') statt des
 * tatsächlichen Zustands. Diese Funktion ist jetzt die EINE Quelle; jeder neue
 * Aufrufer sollte sie benutzen statt die Abfrage zu wiederholen.
 */
async function resolveSetCondition(uid: number | number[], setNumber: string): Promise<'N' | 'U'> {
  // Auch hier das Blickfeld: Der Hauptaccount fragt den Zustand eines Sets ab,
  // das einem Unterkonto gehört — mit einer nackten ID fände er es nicht.
  const uids = asIds(uid as any);
  const row = await db.get(
    `SELECT s.condition,
            COUNT(a.id)                                 AS acq_count,
            COUNT(a.id) FILTER (WHERE a.condition='U')  AS used_count
       FROM sets s LEFT JOIN set_acquisitions a
         ON a.user_id = s.user_id AND a.set_number = s.set_number
      WHERE s.user_id = ANY($1) AND s.set_number=$2
      GROUP BY s.condition`,
    [uids, setNumber]
  ).catch(() => null);
  return effectiveCondition(row);
}


// Nenner-Untergrenze für die %-Wertsteigerung: Bei einem erfassten Kaufpreis
// von 0 (z. B. Geschenk/Gratisteil) wäre die prozentuale Steigerung sonst
// unendlich bzw. nicht berechenbar. Statt den Marktpreis zu unterstellen,
// rechnen wir die % gegen diese sehr kleine Zahl — der Kaufpreis bleibt 0.
// Ein leeres (nicht erfasstes) Kaufpreisfeld ergibt weiterhin keine % (null).
//
// Aus utils/setValue.ts, wo calcPnlPct() damit rechnet. Hier stand vorher eine
// eigene Kopie derselben Zahl — zwei Konstanten mit derselben Bedeutung
// driften irgendwann auseinander.

async function checkAndIncrementRateLimit(apiName: ApiName, _defaultLimit = 4000) {
  const key  = `api_calls_${apiName}`;
  const dateKey = `api_calls_date_${apiName}`;
  const today = new Date().toISOString().slice(0, 10);
  const limit = await getLimitForApi(apiName);

  return db.transaction(async (tx) => {
    // Zeilen anlegen, falls sie noch nicht existieren (erster Aufruf überhaupt)
    await tx.run(
      `INSERT INTO global_settings (key, value) VALUES ($1, '0'), ($2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, dateKey, today]);
    // ORDER BY key → deterministische Lock-Reihenfolge, verhindert Deadlocks
    // zwischen konkurrierenden Transaktionen auf denselben zwei Zeilen.
    const rows = await tx.all(
      `SELECT key, value FROM global_settings WHERE key IN ($1, $2) ORDER BY key FOR UPDATE`,
      [key, dateKey]);
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const count = (byKey[dateKey] === today) ? parseInt(byKey[key] || '0') : 0;
    if (count >= limit) return { allowed: false, count, limit, remaining: 0 };
    const newCount = count + 1;
    await tx.run('UPDATE global_settings SET value = $1 WHERE key = $2', [String(newCount), key]);
    await tx.run('UPDATE global_settings SET value = $1 WHERE key = $2', [today, dateKey]);
    return { allowed: true, count: newCount, limit, remaining: limit - newCount };
  });
}

async function getLimitForApi(apiName: ApiName) {
  // Rückfallwerte, falls global_settings nichts sagt.
  //
  // rebrickable stand hier auf 4000, während utils/rateLimiter.ts 25'000 als
  // Standard führt (REBRICKABLE_DEFAULT_DAILY, auch der Seed in db/database.ts).
  // Das fiel nicht auf, solange Rebrickable seinen eigenen Zähler hatte und
  // diese Tabelle nie sah — seit beide über checkAndIncrementRateLimit laufen,
  // wäre es eine stille Kürzung auf ein Sechstel gewesen. Der Wert kommt
  // deshalb aus derselben Quelle wie dort.
  const defaults = { bricklink: 4000, rebrickable: REBRICKABLE_DEFAULT_DAILY, brickset: 100 };
  const row = await db.get('SELECT value FROM global_settings WHERE key=$1', [`api_limit_${apiName}`]).catch(()=>null);
  return parseInt(row?.value) || defaults[apiName] || 4000;
}

async function getRateLimitStatus(apiName: ApiName) {
  const key = `api_calls_${apiName}`;
  const dateKey = `api_calls_date_${apiName}`;
  const today = new Date().toISOString().slice(0, 10);
  const [dateRow, countRow, limit] = await Promise.all([
    db.get('SELECT value FROM global_settings WHERE key = $1', [dateKey]),
    db.get('SELECT value FROM global_settings WHERE key = $1', [key]),
    getLimitForApi(apiName),
  ]);
  const storedDate  = dateRow?.value;
  const storedCount = parseInt(countRow?.value || '0');
  const count = (storedDate === today) ? storedCount : 0;
  return { count, limit, remaining: Math.max(0, limit - count), date: today };
}

// ── Price fetch with fallback ─────────────────────────────────────────────────
// Optionales `pre` erlaubt Batch-Aufrufern (computeSetsValuation), Katalog- und
// Preiscache-Zeilen vorab in EINER Query zu laden statt pro Set einzeln:
//   pre = { catalog: Map<set_number, row>, cache: Map<`${set}|${cond}`, row> }
// ── Preis-Zustand ─────────────────────────────────────────────────────────────
// Alle BrickLink-Preisabfragen laufen primär mit diesem Zustand; der jeweils
// andere Zustand ('N' ↔ 'U') dient als Fallback, wenn kein Preis gefunden wird.
// 'U' = gebraucht: entspricht dem realistischen Wiederverkaufswert der Sammlung.
const DEFAULT_PRICE_CONDITION = 'U';

const PRICE_CACHE_COLS = 'set_number, condition, min_price, avg_price, max_price, qty_avg_price, fetched_at';

/**
 * Wie lange ein Eintrag OHNE Preis (avg_price = 0) als endgültig gilt.
 *
 * Vorher wurde ein gecachter 0-Preis für das volle TTL-Fenster als „für dieses
 * Set gibt es keinen Preis" behandelt — ohne je erneut zu fragen. Damit lief
 * der neue Rückfall von 'sold' auf 'stock' nie an, denn er greift erst beim
 * Abruf. Und weil die Logik dann auf den ANDEREN Zustand auswich, zeigte ein
 * neues Set den Gebraucht-Preis.
 *
 * Kürzeres Fenster statt gar keinem: Artikel, die wirklich nirgends gehandelt
 * werden, werden ein paar Mal am Tag erneut versucht — nicht bei jedem
 * Seitenaufruf.
 */
const ZERO_PRICE_TTL_HOURS = 6;

/** Ist der Cache-Eintrag brauchbar, oder soll neu geholt werden? */
function cacheUsable(row: PreisZeile, ttlHours: number) {
  if (!row) return false;
  // parseFloat(String(...)): avg_price ist eine numeric-Spalte, und der
  // pg-Treiber gibt numeric als Zeichenkette zurueck. Der Typ macht das
  // sichtbar, statt es der JS-Umwandlung zu ueberlassen.
  if (parseFloat(String(row.avg_price ?? '')) > 0) return true;
  // 0-Eintrag: nur kurz vertrauen, danach neu versuchen.
  if (!row.fetched_at) return false;
  const ageH = (Date.now() - new Date(row.fetched_at).getTime()) / 3600000;
  return ageH < Math.min(ZERO_PRICE_TTL_HOURS, ttlHours);
}

async function fetchPrice(setNumber: string, condition: string, guideType: string, currency: string, ttlHours: Stunden, pre: { catalog: Map<any, any>; cache: Map<string, any> } | null = null) {
  const catalogRow = pre?.catalog
    ? (pre.catalog.get(setNumber) || null)
    : await db.get('SELECT is_gear, bl_type FROM catalog_cache WHERE set_number = $1', [setNumber]);
  if (catalogRow?.is_gear === 1 && catalogRow?.bl_type === 'NONE')
    return { min_price:0, avg_price:0, max_price:0, qty_avg_price:0, from_cache:true, no_price:true };

  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const cached = pre?.cache
    ? (pre.cache.get(`${setNumber}|${condition}`) || null)
    : await db.get(
        `SELECT ${PRICE_CACHE_COLS} FROM price_cache WHERE set_number = $1 AND condition = $2 AND currency_code = $3 AND fetched_at > NOW() - make_interval(hours => $4)`,
        [setNumber, condition, currency, ttl]);
  if (cached && parseFloat(cached.avg_price) > 0)
    return { min_price: cached.min_price, avg_price: cached.avg_price, max_price: cached.max_price, qty_avg_price: cached.qty_avg_price, from_cache: true };

  // 0-Eintrag, der noch frisch genug ist: erst den anderen Zustand aus dem
  // Cache versuchen, sonst als preislos melden. Ist er älter, fällt er durch
  // und unten wird neu geholt — dort greift dann der sold→stock-Rückfall.
  if (cached && parseFloat(cached.avg_price) === 0 && cacheUsable(cached, ttl)) {
    const cachedFb = pre?.cache
      ? (pre.cache.get(`${setNumber}|${fallbackCondition}`) || null)
      : await db.get(
          `SELECT ${PRICE_CACHE_COLS} FROM price_cache WHERE set_number = $1 AND condition = $2 AND currency_code = $3 AND fetched_at > NOW() - make_interval(hours => $4)`,
          [setNumber, fallbackCondition, currency, ttl]);
    if (cachedFb && (parseFloat(cachedFb.avg_price) > 0 || parseFloat(cachedFb.avg_price) > 0))
      return { min_price: cachedFb.min_price, avg_price: cachedFb.avg_price, max_price: cachedFb.max_price, qty_avg_price: cachedFb.qty_avg_price, from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    return { min_price:0, avg_price:0, max_price:0, qty_avg_price:0, from_cache:true, no_price:true };
  }

  async function tryFetch(cond: string) {
    try {
      // Lazy-Require: Top-Level würde einen Require-Zyklus utils ↔ routes
      // erzeugen (bricklink.js nutzt den Rate-Limiter von hier).
      const g = await getPriceGuide(setNumber, cond, guideType, currency);
      const min = parseFloat(g?.min_price||0), avg = parseFloat(g?.avg_price||0),
            max = parseFloat(g?.max_price||0), qavg = parseFloat(g?.qty_avg_price||0),
            qty = parseInt(g?.total_quantity||0);
      await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET min_price=$4,avg_price=$5,max_price=$6,qty_avg_price=$7,total_quantity=$8,fetched_at=NOW()`,
        [setNumber, cond, currency, min, avg, max, qavg, qty]);
      console.log(`  Price ${setNumber} cond=${cond}: avg=${avg} qty_avg=${qavg}`);
      // Record in price history only when we have actual prices
      if (avg > 0 || qavg > 0) {
        await db.run(
          'INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
          [setNumber, cond, currency, avg, qavg, min, max]).catch(()=>{});
      }
      return { min_price:min, avg_price:avg, max_price:max, qty_avg_price:qavg, from_cache:false };
    } catch (e) { console.log(`  Price ${setNumber} cond=${cond} error: ${fehlertext(e)}`); return null; }
  }

  const rl1 = await checkAndIncrementRateLimit('bricklink');
  if (!rl1.allowed) throw new Error(`BrickLink Tageslimit erreicht (${rl1.limit} Aufrufe/Tag)`);

  const pd = await tryFetch(condition);
  // Preis-Vorhandensein an avg_price festmachen — das ist der Wert, den alle
  // Verbraucher lesen. Vorher genügte ein qty_avg_price > 0, womit ein Datensatz
  // mit avg_price = 0 als "hat einen Preis" durchging und überall 0 ergab.
  if (pd && pd.avg_price > 0) return { ...pd, condition_used: condition };

  const cachedFallback = await db.get(
    `SELECT ${PRICE_CACHE_COLS} FROM price_cache WHERE set_number = $1 AND condition = $2 AND currency_code = $3 AND fetched_at > NOW() - make_interval(hours => $4)`,
    [setNumber, fallbackCondition, currency, ttl]);
  if (cachedFallback && (parseFloat(cachedFallback.avg_price) > 0 || parseFloat(cachedFallback.avg_price) > 0))
    return { min_price: cachedFallback.min_price, avg_price: cachedFallback.avg_price, max_price: cachedFallback.max_price, qty_avg_price: cachedFallback.qty_avg_price, from_cache: true, condition_used: fallbackCondition, is_fallback: true };

  const rl2 = await checkAndIncrementRateLimit('bricklink');
  if (!rl2.allowed) { if (pd) return { ...pd, condition_used: condition }; throw new Error('BrickLink Tageslimit erreicht'); }

  const pd2 = await tryFetch(fallbackCondition);
  if (pd2 && pd2.avg_price > 0) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd) return { ...pd, condition_used: condition };
  throw new Error(`${setNumber} — kein BrickLink-Preis gefunden`);
}

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results = new Array(tasks.length); let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; const t = tasks[i]; if (t) results[i] = await t(); } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ── Compute the price valuation for all of a user's sets ────────────────────
// Shared by the session route (/finance/valuation) and the token API
// (/api/v1/finance/valuation) so the logic exists exactly once.
async function computeSetsValuation(viewerId: number, ids: Blickfeld) {
  // ZWEI Grössen, bewusst getrennt:
  //   viewerId — wessen EINSTELLUNGEN gelten (Währung, Cache-Dauer, Preisart)
  //   ids      — WESSEN DATEN gerechnet werden (Blickfeld, ggf. gefiltert)
  //
  // Sie fallen auseinander, sobald der Kontofilter auf „Unterkonten" steht:
  // Dann enthält ids das fragende Konto gar nicht. Die Einstellungen mit
  // ids[0] zu holen hiesse dort, die Währung eines Kindes zu benutzen.
  const uids = asIds(ids);
  const [currency, ttlHours, guideType] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getSetting(viewerId, 'price_cache_ttl', '24'),
    getSetting(viewerId, 'price_guide_type', 'sold'),
  ]);
  const defaultCondition = DEFAULT_PRICE_CONDITION;

  const sets = await db.all(
    // Kaufpreis/Zustand kommen NICHT mehr aus dieser Abfrage zusammengefasst,
    // sondern aus den Erfassungen weiter unten — eine Zeile je Kaufpreis.
    // s.purchase_price und s.condition bleiben als Rückfall für Altbestände
    // ohne Erfassungen.
    `SELECT s.set_number, s.name, s.year, s.quantity, s.image_local, s.image_url,
            s.added_at, s.condition, s.purchase_price
       FROM sets s
      WHERE s.user_id = ANY($1)`, [uids]);
  if (!sets.length) return { currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours, sets: [], totals: { min:'0.00', avg:'0.00', max:'0.00', qty_avg:'0.00' } };

  // Batch-Prefetch: Katalog-Flags, Preiscache (beide Zustände) und ALLE
  // Erfassungen in je einer Query — sonst wäre das eine Abfrage je Set.
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const [catRows, cacheRows, acqRows] = await Promise.all([
    db.all('SELECT set_number, is_gear, bl_type FROM catalog_cache WHERE set_number = ANY($1)', [setNumbers]),
    db.all(
      `SELECT ${PRICE_CACHE_COLS} FROM price_cache
       WHERE set_number = ANY($1) AND currency_code = $2 AND fetched_at > NOW() - make_interval(hours => $3)`,
      [setNumbers, currency, ttl]),
    db.all(
      `SELECT id, set_number, quantity, purchase_price,
              COALESCE(condition, 'N') AS condition, created_at
         FROM set_acquisitions
        WHERE user_id = ANY($1)
        ORDER BY created_at ASC, id ASC`, [uids]),
  ]);
  const pre = {
    catalog: new Map(catRows.map(r => [r.set_number, r])),
    cache:   new Map(cacheRows.map(r => [`${r.set_number}|${r.condition}`, r])),
  };
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const list = acqBySet.get(a.set_number);
    if (list) list.push(a); else acqBySet.set(a.set_number, [a]);
  }

  const tasks = sets.map(set => async () => {
    const acqs = acqBySet.get(set.set_number) || [];
    const imgLocal = resolveImageLocal(set.image_local);
    const imgUrl   = proxyImageUrl(set.image_url);
    const base = {
      set_number: set.set_number, name: set.name, year: set.year,
      image_local: imgLocal, image_url: imgUrl, added_at: set.added_at,
    };

    // ── Preise NUR für die tatsächlich vorkommenden Zustände holen ───────────
    //
    // Vorher wurde je Set genau ein Preis geholt, für den einen Zustand, den
    // effectiveCondition() ausgerechnet hat. Ein gemischtes Set braucht beide.
    // Ein reines Neu- oder Gebraucht-Set holt weiterhin nur einen Preis — die
    // Zahl der BrickLink-Abrufe steigt also ausschliesslich für gemischte Sets.
    // Zustand NUR als Rückfall für Sets ohne Erfassungen — und dann über die
    // gemeinsame Regel, nicht mit einer eigenen Auswertung von sets.condition.
    const fallbackCond: 'N' | 'U' = effectiveCondition(set);
    const needed: Array<'N' | 'U'> = acqs.length
      ? [...new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')))] as Array<'N'|'U'>
      : [fallbackCond];

    const priceByCond: Record<string, any> = {};
    const errors: string[] = [];
    for (const cond of needed) {
      try {
        priceByCond[cond] = await fetchPrice(set.set_number, cond, guideType, currency, ttlHours, pre);
      } catch (e: any) {
        priceByCond[cond] = null;
        errors.push(e.message);
      }
    }

    // Preise als Map "setNummer|Zustand" → avg_price: dieselbe Form, die
    // loadConditionPrices() liefert, damit valueSet() unverändert benutzt
    // werden kann — die Bewertungsregel bleibt an EINER Stelle.
    const priceMapForSet = new Map<string, number>();
    for (const cond of needed) {
      const v = parseFloat(String(priceByCond[cond]?.avg_price || 0));
      if (v > 0) priceMapForSet.set(`${set.set_number}|${cond}`, v);
    }

    // Set-Zeile: derselbe gewichtete Stückpreis wie überall sonst.
    const valued = valueSet(set.set_number, acqs, priceMapForSet, fallbackCond, set.quantity || 1);
    // Einzelzeilen: eine je Kaufpreis, jede mit dem Preis IHRES Zustands.
    const rows = valueAcquisitionRows(set.set_number, acqs, priceMapForSet);
    const purchase = acqs.length
      ? weightedPurchase(rows)
      : (set.purchase_price != null ? parseFloat(set.purchase_price) : null);

    // Min/Max analog gewichtet — sie speisen nur die Min/Max-Kacheln oben,
    // müssen aber zur selben Mengenaufteilung passen wie der Schnitt.
    const qty = valued.quantity || 1;
    const weighted = (key: 'min_price' | 'max_price' | 'qty_avg_price') => {
      const parts = valued.by_condition.map(bc => {
        const raw = parseFloat(String(priceByCond[bc.condition]?.[key] || 0)) || 0;
        return raw * bc.quantity;
      });
      return parts.reduce((a, b) => a + b, 0) / qty;
    };

    const anyPrice = needed.map(c => priceByCond[c]).find(p => p);
    const unitAvg = valued.unit_price ?? 0;
    // Fehlerfall nur, wenn KEIN Zustand einen Preis geliefert hat — bei einem
    // gemischten Set soll die eine gelungene Hälfte nicht an der anderen
    // scheitern.
    const failedAll = errors.length === needed.length;
    const conditions = valued.by_condition.map(bc => bc.condition);

    return {
      ...base,
      quantity: qty,
      // Zustand des Bestandes wie bisher (gebraucht, sobald eine Erfassung
      // gebraucht ist) — für Aufrufer, die eine einzelne Angabe erwarten.
      // Die BEWERTUNG hängt nicht mehr daran; die Einzelzeilen tragen ihren
      // eigenen Zustand.
      condition: conditions.includes('U') ? 'U' : 'N',
      conditions,
      mixed: conditions.length > 1,
      purchase_price: purchase,
      min_price: weighted('min_price'),
      avg_price: unitAvg,
      max_price: weighted('max_price'),
      qty_avg_price: weighted('qty_avg_price'),
      total_avg:     (unitAvg * qty).toFixed(2),
      total_qty_avg: (weighted('qty_avg_price') * qty).toFixed(2),
      pnl_pct: calcPnlPct(purchase, unitAvg),
      acquisitions: rows,
      from_cache: anyPrice ? !!anyPrice.from_cache : true,
      is_fallback: anyPrice ? !!anyPrice.is_fallback : false,
      no_price: !failedAll && valued.unit_price == null,
      ...(failedAll ? { error: errors[0] } : {}),
    };
  });

  const results = await parallelLimit(tasks, 5);
  let totalMin=0, totalAvg=0, totalMax=0, totalQtyAvg=0;
  for (const r of results) { const q=r.quantity||1; totalMin+=(r.min_price||0)*q; totalAvg+=(r.avg_price||0)*q; totalMax+=(r.max_price||0)*q; totalQtyAvg+=(r.qty_avg_price||0)*q; }
  return {
    currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours, sets: results,
    totals: { min:totalMin.toFixed(2), avg:totalAvg.toFixed(2), max:totalMax.toFixed(2), qty_avg:totalQtyAvg.toFixed(2) },
  };
}

async function resolveBlColorId(rbColorId: number) {
  if (rbColorId == null || rbColorId === 0) return rbColorId;
  try {
    const row = await db.get('SELECT bl_color_id FROM rb_colors WHERE id=$1', [rbColorId]);
    return (row?.bl_color_id != null) ? row.bl_color_id : rbColorId;
  } catch (_) { return rbColorId; }
}

// Rebrickable-Teilenummer → BrickLink-Teilenummer (rb_bl_mapping, gepflegt
// durch syncBlPartNumbers/fetchMissingBlIds nach dem CSV-Sync). Ohne diese
// Übersetzung antwortet BrickLink für RB-Nummern mit 404 RESOURCE_NOT_FOUND —
// analog zu resolveBlColorId für die Farben. Unbekannte Nummern (oder bereits
// BL-Nummern) laufen unverändert durch.
async function resolveBlPartNumber(partNumber: string) {
  try {
    const row = await db.get('SELECT bl_part_num FROM rb_bl_mapping WHERE part_num=$1', [partNumber]);
    return row?.bl_part_num || partNumber;
  } catch (_) { return partNumber; }
}

// ── Fetch price for a single part from BrickLink ─────────────────────────────
// Spiegelt die Fallback-Logik von fetchPrice (Sets): Liefert der gewünschte
// Zustand (neu/gebraucht) keinen Preis, wird der jeweils andere Zustand
// versucht — viele ältere Teile werden nur noch gebraucht angeboten.
async function fetchPartPrice(partNumber: string, rbColorId: number, condition: string, currency: string, ttlHours: Stunden) {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const colorId = await resolveBlColorId(rbColorId);
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const readCache = (cond: string) => db.get(
    `SELECT avg_price, avg_price FROM part_price_cache WHERE part_number=$1 AND color_id=$2 AND condition=$3 AND currency_code=$4 AND fetched_at > NOW() - make_interval(hours => $5)`,
    [partNumber, colorId, cond, currency, ttl]);

  // Frischer Cache-Treffer mit echtem Preis → fertig
  const cached = await readCache(condition);
  if (cached && (parseFloat(cached.avg_price) > 0 || parseFloat(cached.avg_price) > 0))
    return { avg_price: parseFloat(cached.avg_price), qty_avg_price: parseFloat(cached.avg_price), from_cache: true };

  // Frische 0 gecacht: Fallback-Zustand aus dem Cache probieren. Ist der
  // Fallback ebenfalls frisch gecacht (und 0), gibt es wirklich keinen Preis.
  // Wurde der Fallback aber noch nie geholt, NICHT aufgeben, sondern unten
  // live nachholen — nur den (bekannt leeren) Primärzustand überspringen.
  let skipPrimaryFetch = false;
  if (cached && parseFloat(cached.avg_price) === 0 && parseFloat(cached.avg_price) === 0) {
    const cachedFb = await readCache(fallbackCondition);
    if (cachedFb && (parseFloat(cachedFb.avg_price) > 0 || parseFloat(cachedFb.avg_price) > 0))
      return { avg_price: parseFloat(cachedFb.avg_price), qty_avg_price: parseFloat(cachedFb.avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    if (cachedFb) return { avg_price: 0, qty_avg_price: 0, from_cache: true, no_price: true };
    skipPrimaryFetch = true;
  }

  const blPartNumber = await resolveBlPartNumber(partNumber);

  async function tryFetch(cond: string) {
    try {
      const qp: Record<string, any> = { guide_type: 'sold', new_or_used: cond, currency_code: currency, vat: 'N' };
      if (colorId && colorId !== 0) qp.color_id = String(colorId);
      // BrickLink part price: /items/part/{blPartNumber}/price?color_id={colorId}
      let g = await bricklinkRequest('GET', `/items/part/${blPartNumber}/price`, qp);
      // Kein Verkauf in sechs Monaten → aktuelle Angebote heranziehen. Bei
      // einzelnen Teilen in seltenen Farben ist das der Normalfall.
      if (!(parseFloat(g?.avg_price || 0) > 0)) {
        const alt = await bricklinkRequest('GET', `/items/part/${blPartNumber}/price`,
          { ...qp, guide_type: 'stock' }).catch(() => null);
        if (parseFloat(alt?.avg_price || 0) > 0) g = alt;
      }
      const avg  = parseFloat(g?.avg_price || 0);
      const qavg = parseFloat(g?.qty_avg_price || 0);
      await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (part_number,color_id,condition,currency_code)
        DO UPDATE SET avg_price=$5, qty_avg_price=$6, fetched_at=NOW()`,
        [partNumber, colorId || 0, cond, currency, avg, qavg]);
      // Verlaufspunkt mitschreiben — nur bei echtem Preis.
      //
      // Der Cache oben speichert über sein UNIQUE nur den ZULETZT abgerufenen
      // Wert; ohne diesen Eintrag gäbe es keine Vergangenheit, aus der sich ein
      // Diagramm zeichnen liesse. Gleiches Muster wie bei Sets
      // (jobs/priceJob.ts schreibt dort in price_history).
      //
      // ON CONFLICT DO NOTHING wie dort: Die Tabelle hat bewusst keinen
      // eindeutigen Schlüssel, die Klausel schützt nur gegen künftige.
      // Nullwerte werden ausgelassen — ein Nullpunkt sähe im Diagramm aus wie
      // ein Kurssturz.
      if (avg > 0 || qavg > 0) {
        await db.run(
          `INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [partNumber, colorId || 0, cond, currency, avg, qavg]
        ).catch(() => {});
      }
      return { avg_price: avg, qty_avg_price: qavg, from_cache: false };
    } catch (e) {
      console.log(`  Part price failed ${partNumber}${blPartNumber !== partNumber ? ` (bl ${blPartNumber})` : ''} color ${colorId} (rb color ${rbColorId}) cond=${cond}: ${fehlertext(e)}`);
      return null;
    }
  }

  let pd: any = null;
  if (!skipPrimaryFetch) {
    const rl1 = await checkAndIncrementRateLimit('bricklink');
    if (!rl1.allowed) throw new Error('BrickLink Tageslimit erreicht');
    pd = await tryFetch(condition);
    if (pd && pd.avg_price > 0) return { ...pd, condition_used: condition };

    const cachedFallback = await readCache(fallbackCondition);
    if (cachedFallback && (parseFloat(cachedFallback.avg_price) > 0 || parseFloat(cachedFallback.avg_price) > 0))
      return { avg_price: parseFloat(cachedFallback.avg_price), qty_avg_price: parseFloat(cachedFallback.avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
  }

  const rl2 = await checkAndIncrementRateLimit('bricklink');
  if (!rl2.allowed) {
    if (pd) return { ...pd, condition_used: condition };
    throw new Error('BrickLink Tageslimit erreicht');
  }

  const pd2 = await tryFetch(fallbackCondition);
  if (pd2 && pd2.avg_price > 0) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd2) return { ...pd2, condition_used: fallbackCondition };
  if (pd)  return { ...pd, condition_used: condition };
  return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'kein BrickLink-Preis gefunden' };
}

// ── Fetch price for a single minifig from BrickLink ─────────────────────────
// Gleiche Fallback-Logik wie fetchPartPrice: erst der gewünschte Zustand,
// bei leerem Price Guide der jeweils andere ('U' ↔ 'N').
async function fetchMinifigPrice(figNumber: string, condition: string, currency: string, ttlHours: Stunden) {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const readCache = (cond: string) => db.get(
    `SELECT avg_price, avg_price FROM minifig_price_cache WHERE fig_number=$1 AND condition=$2 AND currency_code=$3 AND fetched_at > NOW() - make_interval(hours => $4)`,
    [figNumber, cond, currency, ttl]);

  const cached = await readCache(condition);
  if (cached && (parseFloat(cached.avg_price) > 0 || parseFloat(cached.avg_price) > 0))
    return { avg_price: parseFloat(cached.avg_price), qty_avg_price: parseFloat(cached.avg_price), from_cache: true };

  let skipPrimaryFetch = false;
  if (cached && parseFloat(cached.avg_price) === 0 && parseFloat(cached.avg_price) === 0) {
    const cachedFb = await readCache(fallbackCondition);
    if (cachedFb && (parseFloat(cachedFb.avg_price) > 0 || parseFloat(cachedFb.avg_price) > 0))
      return { avg_price: parseFloat(cachedFb.avg_price), qty_avg_price: parseFloat(cachedFb.avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    if (cachedFb) return { avg_price: 0, qty_avg_price: 0, from_cache: true, no_price: true };
    skipPrimaryFetch = true;
  }

  async function tryFetch(cond: string) {
    try {
      const qp = { guide_type: 'sold', new_or_used: cond, currency_code: currency, vat: 'N' };
      let g = await bricklinkRequest('GET', `/items/minifig/${figNumber}/price`, qp);
      // Wie bei Teilen: ohne Verkauf in sechs Monaten auf Angebote ausweichen.
      if (!(parseFloat(g?.avg_price || 0) > 0)) {
        const alt = await bricklinkRequest('GET', `/items/minifig/${figNumber}/price`,
          { ...qp, guide_type: 'stock' }).catch(() => null);
        if (parseFloat(alt?.avg_price || 0) > 0) g = alt;
      }
      const avg  = parseFloat(g?.avg_price || 0);
      const qavg = parseFloat(g?.qty_avg_price || 0);
      await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fig_number,condition,currency_code)
        DO UPDATE SET avg_price=$4, qty_avg_price=$5, fetched_at=NOW()`,
        [figNumber, cond, currency, avg, qavg]);
      // Verlaufspunkt mitschreiben — nur bei echtem Preis.
      //
      // Der Cache oben speichert über sein UNIQUE nur den ZULETZT abgerufenen
      // Wert; ohne diesen Eintrag gäbe es keine Vergangenheit, aus der sich ein
      // Diagramm zeichnen liesse. Gleiches Muster wie bei Sets
      // (jobs/priceJob.ts schreibt dort in price_history).
      //
      // ON CONFLICT DO NOTHING wie dort: Die Tabelle hat bewusst keinen
      // eindeutigen Schlüssel, die Klausel schützt nur gegen künftige.
      // Nullwerte werden ausgelassen — ein Nullpunkt sähe im Diagramm aus wie
      // ein Kurssturz.
      if (avg > 0 || qavg > 0) {
        await db.run(
          `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [figNumber, cond, currency, avg, qavg]
        ).catch(() => {});
      }
      return { avg_price: avg, qty_avg_price: qavg, from_cache: false };
    } catch (e) {
      console.log(`  Minifig price failed ${figNumber} cond=${cond}: ${fehlertext(e)}`);
      return null;
    }
  }

  let pd: any = null;
  if (!skipPrimaryFetch) {
    const rl1 = await checkAndIncrementRateLimit('bricklink');
    if (!rl1.allowed) throw new Error('BrickLink Tageslimit erreicht');
    pd = await tryFetch(condition);
    if (pd && pd.avg_price > 0) return { ...pd, condition_used: condition };

    const cachedFallback = await readCache(fallbackCondition);
    if (cachedFallback && (parseFloat(cachedFallback.avg_price) > 0 || parseFloat(cachedFallback.avg_price) > 0))
      return { avg_price: parseFloat(cachedFallback.avg_price), qty_avg_price: parseFloat(cachedFallback.avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
  }

  const rl2 = await checkAndIncrementRateLimit('bricklink');
  if (!rl2.allowed) {
    if (pd) return { ...pd, condition_used: condition };
    throw new Error('BrickLink Tageslimit erreicht');
  }

  const pd2 = await tryFetch(fallbackCondition);
  if (pd2 && pd2.avg_price > 0) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd2) return { ...pd2, condition_used: fallbackCondition };
  if (pd)  return { ...pd, condition_used: condition };
  return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'kein BrickLink-Preis gefunden' };
}


/**
 * Erfassungen manueller Teile bzw. Minifiguren, gruppiert nach Eintrag.
 *
 * Eine Abfrage für den ganzen Bestand statt einer je Kachel — dasselbe Muster
 * wie applyManualCondition() in utils/handlers.ts.
 *
 * @param {'part'|'fig'} kind
 * @returns Map key → Erfassungszeilen; key ist `nummer|farbe` bzw. `nummer`
 */
async function loadManualAcquisitions(uid: Blickfeld, kind: 'part' | 'fig') {
  // Blickfeld: Ein Hauptkonto bewertet den ganzen Haushalt. Die Währung ist
  // beim Verknüpfen erzwungen gleich (utils/household.ts) — sonst summierte
  // diese Rechnung zwei Währungen, ohne dass man es der Zahl ansähe.
  const uids = asIds(uid as any);
  const rows = await db.all(
    kind === 'part'
      ? `SELECT id, part_number, color_id, quantity, unit_price,
                COALESCE(condition,'N') AS condition, created_at
           FROM part_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`
      : `SELECT id, fig_number, quantity, unit_price,
                COALESCE(condition,'N') AS condition, created_at
           FROM minifig_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`,
    [uids]
  ).catch(() => []);
  const out = new Map<string, any[]>();
  for (const r of rows) {
    const key = kind === 'part' ? `${r.part_number}|${r.color_id || 0}` : String(r.fig_number);
    const list = out.get(key);
    if (list) list.push(r); else out.set(key, [r]);
  }
  return out;
}

/**
 * Zustände eines manuellen Eintrags — aus den Erfassungen, ersatzweise aus der
 * Stammzeile.
 */
function conditionsOf(acqs: any[], stored: string): ('N' | 'U')[] {
  if (!acqs?.length) return [stored === 'U' ? 'U' : 'N'];
  const set = new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

// ── Compute valuation for all manually captured minifigs of a user ──────────
// Shared by the session route (/finance/minifigs-valuation) and the token API
// (/api/v1/finance/minifigs-valuation) so the logic exists exactly once.
async function computeMinifigsValuation(viewerId: number, ids: Blickfeld) {
  // ZWEI Grössen, bewusst getrennt:
  //   viewerId — wessen EINSTELLUNGEN gelten (Währung, Cache-Dauer, Preisart)
  //   ids      — WESSEN DATEN gerechnet werden (Blickfeld, ggf. gefiltert)
  //
  // Sie fallen auseinander, sobald der Kontofilter auf „Unterkonten" steht:
  // Dann enthält ids das fragende Konto gar nicht. Die Einstellungen mit
  // ids[0] zu holen hiesse dort, die Währung eines Kindes zu benutzen.
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const defaultCondition = DEFAULT_PRICE_CONDITION;
  const manualFigs = await db.all(`SELECT *, COALESCE(condition,'N') AS condition FROM minifigs WHERE user_id = ANY($1) AND source='manual'`, [uids]);
  if (!manualFigs.length) return { currency, figs: [], total_value: '0.00' };

  const acqByFig = await loadManualAcquisitions(uids, 'fig');

  const tasks = manualFigs.map(fig => async () => {
    // Marktpreis kommt immer live von BrickLink (globaler, geteilter Preiscache
    // mit TTL — analog zu Sets). Preis/Stk bzw. Kaufpreis beeinflussen nur die
    // G&V-Basis, nicht mehr den angezeigten Marktpreis/aktuellen Wert.
    //
    // NEU: je vorkommendem Zustand ein Preis. Vorher gab es genau einen — und
    // sobald EINE Erfassung gebraucht war, wurde auch das neu gekaufte
    // Exemplar mit dem Gebrauchtpreis bewertet.
    const key  = String(fig.fig_number);
    const acqs = acqByFig.get(key) || [];
    const stored = (fig.condition === 'U') ? 'U' : defaultCondition;
    const conds  = conditionsOf(acqs, stored);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      if (fig.bl_fig_number) {
        try { pd = await fetchMinifigPrice(fig.bl_fig_number, cond, currency, ttlHours); }
        catch (e: any) { pd = { avg_price: 0, qty_avg_price: 0, error: e.message }; }
      } else {
        // Keine BrickLink-Nummer hinterlegt: Marktpreis aus den einzelnen
        // BrickLink-Teilepreisen der Minifigur schätzen (Rebrickable→BrickLink-
        // Zuordnung existiert zuverlässig für Teile, nicht für Minifiguren).
        //
        // JE ZUSTAND: Die Teilepreise werden im Zustand DIESER Erfassung
        // geholt. Vorher lief die Schätzung fest im Standardzustand und galt
        // für beide — eine gebraucht erfasste Figur bekam den Neupreis ihrer
        // Teile, und zwei Zeilen mit verschiedenen Zuständen zeigten
        // denselben Marktpreis.
        const { estimateFigPriceFromParts } = require('../routes/minifigs');
        const estimated = await estimateFigPriceFromParts(fig.fig_number, viewerId, cond).catch(() => null);
        pd = estimated != null
          ? { avg_price: estimated, qty_avg_price: estimated, from_cache: false, estimated_from_parts: true }
          : { avg_price: 0, qty_avg_price: 0 };
      }
      // avg_price zuerst: BrickLinks angezeigter "Avg Price". qty_avg_price ist
      // der mengengewichtete Schnitt und liegt systematisch darunter. Zusätzlich
      // ist "0.00" aus Postgres truthy und hätte avg_price verdeckt.
      const v = parseFloat(String(pd.avg_price || 0)) || parseFloat(String(pd.qty_avg_price || 0)) || 0;
      if (v > 0) priceMap.set(`${key}|${cond}`, v);
      if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
    }

    const qty = fig.quantity || 1;
    // Gewichteter Stückwert über die Erfassungen — dieselbe Regel wie bei Sets.
    const valued  = valueSet(key, acqs, priceMap, stored, qty);
    const rows    = valueAcquisitionRows(key, acqs, priceMap);
    const unitVal = valued.unit_price ?? 0;
    const totalQty = acqs.length ? valued.quantity : qty;
    // Kaufpreis ebenfalls mengengewichtet; ohne Erfassungen die Stammzeile.
    const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
    const hasCost = acqPurchase != null || fig.purchase_price != null;   // 0 zählt als erfasst
    const purchasePrice = acqPurchase != null ? acqPurchase : parseFloat(fig.purchase_price || 0);
    return { ...fig, ...priceData,
      condition: valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions: valued.by_condition.map(b => b.condition),
      // Eine Zeile je Kaufpreis — dieselbe Form wie bei Sets, damit die
      // Finanztabelle für alle drei Arten gleich aussieht.
      acquisitions: rows,
      avg_price: unitVal, qty_avg_price: unitVal,
      purchase_price: hasCost ? purchasePrice : null,
      pnl_pct: hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      total_value: (unitVal * totalQty).toFixed(4), display_value: (unitVal * totalQty).toFixed(2) };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
  return { currency, figs: results, total_value: total.toFixed(2) };
}

/**
 * Besitzer-Namen an Bewertungszeilen hängen — nur im Haushalt.
 *
 * Manuell erfasste Teile und Minifiguren werden bewusst NICHT verdichtet: Zwei
 * Konten mit demselben Teil sind zwei Bestände mit eigener Menge und eigenem
 * Kaufpreis. Ohne die Plakette sähe die Finanztabelle wie eine doppelte Zeile
 * aus.
 */
async function withOwnerNames(uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await db.all('SELECT id, username FROM users WHERE id = ANY($1)', [uids])
    .catch(() => []);
  const nameById = new Map<number, any>(owners.map((u: any) => [parseInt(u.id), u.username] as [number, any]));
  return rows.map(r => r.user_id == null ? r : {
    ...r,
    owners: [{ id: parseInt(r.user_id), username: nameById.get(parseInt(r.user_id)) || String(r.user_id) }],
  });
}

// ── GET /api/finance/minifigs-valuation ───────────────────────────────────────
async function computePartsValuation(viewerId: number, ids: Blickfeld) {
  // ZWEI Grössen, bewusst getrennt:
  //   viewerId — wessen EINSTELLUNGEN gelten (Währung, Cache-Dauer, Preisart)
  //   ids      — WESSEN DATEN gerechnet werden (Blickfeld, ggf. gefiltert)
  //
  // Sie fallen auseinander, sobald der Kontofilter auf „Unterkonten" steht:
  // Dann enthält ids das fragende Konto gar nicht. Die Einstellungen mit
  // ids[0] zu holen hiesse dort, die Währung eines Kindes zu benutzen.
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const defaultCondition = DEFAULT_PRICE_CONDITION;
  const manualParts = await db.all(
    `SELECT *, COALESCE(condition,'N') AS condition FROM parts WHERE user_id = ANY($1) AND source = 'manual'`, [uids]);

  if (!manualParts.length) return { currency, parts: [], total_value: '0.00' };

  const acqByPart = await loadManualAcquisitions(uids, 'part');

  const tasks = manualParts.map(part => async () => {
    // Marktpreis kommt immer live von BrickLink (globaler, geteilter Preiscache
    // mit TTL — analog zu Sets). Preis/Stk bzw. Kaufpreis beeinflussen nur die
    // G&V-Basis, nicht mehr den angezeigten Marktpreis/aktuellen Wert.
    //
    // NEU: je vorkommendem Zustand ein Preis, danach mengengewichtet
    // zusammengefasst — wie bei Sets (utils/setValue.ts). Vorher entschied ein
    // einzelner Zustand über den Wert ALLER Exemplare.
    const key    = `${part.part_number}|${part.color_id || 0}`;
    const acqs   = acqByPart.get(key) || [];
    const stored = (part.condition === 'U') ? 'U' : defaultCondition;
    const conds  = conditionsOf(acqs, stored);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      try {
        pd = await fetchPartPrice(part.bl_part_number || part.part_number, part.color_id || 0, cond, currency, ttlHours);
      } catch (e: any) {
        pd = { avg_price: 0, qty_avg_price: 0, error: e.message };
      }
      // avg_price zuerst: BrickLinks angezeigter "Avg Price". qty_avg_price ist
      // der mengengewichtete Schnitt und liegt systematisch darunter. Zusätzlich
      // ist "0.00" aus Postgres truthy und hätte avg_price verdeckt.
      const v = parseFloat(String(pd.avg_price || 0)) || parseFloat(String(pd.qty_avg_price || 0)) || 0;
      if (v > 0) priceMap.set(`${key}|${cond}`, v);
      if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
    }

    const qty     = part.quantity || 1;
    const valued  = valueSet(key, acqs, priceMap, stored, qty);
    const rows    = valueAcquisitionRows(key, acqs, priceMap);
    const unitVal = valued.unit_price ?? 0;
    const totalQty = acqs.length ? valued.quantity : qty;
    const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
    const hasCost = acqPurchase != null || part.purchase_price != null;  // 0 zählt als erfasst
    const purchasePrice = acqPurchase != null ? acqPurchase : parseFloat(part.purchase_price || 0);
    return {
      id:           part.id,
      part_number:  part.part_number,
      bl_part_number: part.bl_part_number,
      part_name:    part.part_name,
      color_id:     part.color_id,
      color_name:   part.color_name,
      color_hex:    part.color_hex,
      quantity:     qty,
      image_url:    part.image_url,
      image_local:  part.image_local,
      note:         part.note,
      unit_price:   part.unit_price,
      purchase_price: hasCost ? purchasePrice : null,
      condition:    valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions:   valued.by_condition.map(b => b.condition),
      // Eine Zeile je Kaufpreis — wie bei Sets.
      acquisitions: rows,
      pnl_pct:      hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      ...priceData,
      // Nach ...priceData, damit der gewichtete Wert den Einzelpreis des
      // zuletzt geholten Zustands überschreibt und nicht umgekehrt.
      avg_price:    unitVal,
      qty_avg_price: unitVal,
      total_value:  (unitVal * totalQty).toFixed(4),
      display_value: (unitVal * totalQty).toFixed(2),
    };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((sum, r) => sum + parseFloat(r.total_value || 0), 0);
  return { currency, condition: defaultCondition, parts: results, total_value: total.toFixed(2) };
}

// ── GET /api/finance/parts-valuation ─────────────────────────────────────────────
async function computePnl(viewerId: number, ids: Blickfeld) {
  // ZWEI Grössen, bewusst getrennt:
  //   viewerId — wessen EINSTELLUNGEN gelten (Währung, Cache-Dauer, Preisart)
  //   ids      — WESSEN DATEN gerechnet werden (Blickfeld, ggf. gefiltert)
  //
  // Sie fallen auseinander, sobald der Kontofilter auf „Unterkonten" steht:
  // Dann enthält ids das fragende Konto gar nicht. Die Einstellungen mit
  // ids[0] zu holen hiesse dort, die Währung eines Kindes zu benutzen.
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const defaultCondition = DEFAULT_PRICE_CONDITION;

  const sets = await db.all(
    `SELECT s.set_number, s.name, s.year, s.quantity, s.image_local, s.image_url, s.added_at, s.condition,
            -- Ø-Kaufpreis pro Stück aus der Erfassungs-Historie (Fallback: alter
            -- Einzelwert). Frontend/Apps rechnen weiterhin purchase_price × quantity,
            -- die Summe stimmt damit auch bei unterschiedlich teuren Erfassungen.
            COALESCE(a.total_price / NULLIF(a.total_qty, 0), s.purchase_price) AS purchase_price,
            -- acq_count/used_count fehlten hier komplett — effectiveCondition()
            -- weiter unten braucht sie, um den Zustand aus den Erfassungen
            -- abzuleiten. Ohne sie war set.acq_count/used_count immer
            -- undefined, effectiveCondition() fiel IMMER auf sets.condition
            -- zurück, egal was die Erfassungen tatsächlich sagten. Für ein Set
            -- mit gemischten Erfassungen (z. B. 1× Neu, 1× Gebraucht) oder
            -- einem veralteten sets.condition zeigte der P&L-Pfad — und damit
            -- die Galerie-Kachel und der Detail-Dialog — dadurch den falschen
            -- Marktpreis, während computeSetsValuation() (Finanzen-Reiter)
            -- längst korrekt über die Erfassungen entschied. Zwei Wahrheiten
            -- für denselben Zustand.
            COALESCE(a.acq_count, 0)  AS acq_count,
            COALESCE(a.used_count, 0) AS used_count
     FROM sets s
     LEFT JOIN (
       SELECT user_id, set_number,
              SUM(COALESCE(purchase_price, 0) * quantity) AS total_price,
              SUM(quantity) AS total_qty,
              COUNT(*)                                AS acq_count,
              COUNT(*) FILTER (WHERE condition = 'U')  AS used_count
       FROM set_acquisitions GROUP BY user_id, set_number
     ) a ON a.user_id = s.user_id AND a.set_number = s.set_number
     WHERE s.user_id = ANY($1)`, [uids]);

  // Statt 2 Queries pro Set: aktuelle Cache-Preise und ältester History-Eintrag
  // für ALLE Sets in je einer Batch-Query (nutzt UNIQUE-Index bzw. idx_price_history_set).
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const priceMap = new Map(), firstHistMap = new Map();
  // Kaufpreis und Menge kommen jetzt ebenfalls aus den Erfassungen, damit
  // Galerie/Detail und der Finanzen-Reiter dieselben Zahlen zeigen.
  const purchaseMap = new Map(), qtyMap = new Map();
  const acqRows = setNumbers.length ? await db.all(
    `SELECT id, set_number, quantity, purchase_price,
            COALESCE(condition, 'N') AS condition, created_at
       FROM set_acquisitions WHERE user_id = ANY($1)
      ORDER BY created_at ASC, id ASC`, [uids]) : [];
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const list = acqBySet.get(a.set_number);
    if (list) list.push(a); else acqBySet.set(a.set_number, [a]);
  }
  if (setNumbers.length) {
    // DIESE Abfrage speist die P&L-Antwort und damit den in der Galerie und im
    // Detail-Dialog angezeigten „Marktpreis". Sie hatte zwei Fehler, die beim
    // ersten Preis-Fix in routes/ behoben wurden, hier aber stehen blieben:
    //
    //   1. Sie las nur qty_avg_price. Die Zuweisungszeile darunter griff auf
    //      r.avg_price zu — das war undefined, also gewann immer der
    //      mengengewichtete Schnitt.
    //   2. ORDER BY (qty_avg_price > 0) DESC, (condition = …) DESC stellte
    //      „hat einen Preis" VOR „passender Zustand". Mit DISTINCT ON gewann
    //      damit der Gebraucht-Preis, auch für ein neues Set.
    //
    // Neu: beide Zustände holen und je Set nach dessen eigenem Zustand wählen —
    // der globale Standardzustand passt nicht für eine gemischte Sammlung.
    const [cachedRows, firstRows] = await Promise.all([
      db.all(
        `SELECT set_number, condition, avg_price, qty_avg_price FROM price_cache
         WHERE set_number = ANY($1) AND condition IN ('U','N') AND currency_code=$2
           AND fetched_at > NOW() - make_interval(hours => $3)`,
        [setNumbers, currency, ttl]),
      db.all(
        `SELECT DISTINCT ON (set_number, condition) set_number, condition, avg_price, qty_avg_price
         FROM price_history
         WHERE set_number = ANY($1) AND currency_code=$2 AND condition IN ('U','N')
         ORDER BY set_number, condition, recorded_at ASC`,
        [setNumbers, currency]),
    ]);

    /** avg_price zuerst; qty_avg_price nur als Rückfall. */
    const val = (r: { avg_price?: any; qty_avg_price?: any } | undefined) =>
      parseFloat(r?.avg_price || 0) || parseFloat(r?.qty_avg_price || 0) || 0;
    const byKey = (rows: any[]) => {
      const m = new Map();
      for (const r of rows) m.set(`${r.set_number}|${r.condition}`, r);
      return m;
    };
    const cacheByKey = byKey(cachedRows), histByKey = byKey(firstRows);

    // Je Erfassung mit dem Preis IHRES Zustands bewerten und erst danach
    // verdichten — dieselbe Rechnung wie im Finanzen-Reiter
    // (utils/acquisitionValue.ts).
    //
    // Vorher galt hier EIN Zustand fürs ganze Set: eine einzige
    // Gebraucht-Erfassung liess den Marktpreis aller Exemplare auf den
    // Gebrauchtpreis fallen. Galerie-Kachel und Detail-Dialog lesen genau
    // diese Antwort — die Sammlung wurde damit schlagartig weniger wert, ohne
    // dass sich am Markt etwas geändert hätte.
    for (const set of sets) {
      const acqs = acqBySet.get(set.set_number) || [];
      const fallbackCond = effectiveCondition(set);
      // Map in der Form, die valueSet() erwartet — das Ausweichen auf den
      // anderen Zustand steckt dort schon drin (priceFor).
      const asPriceMap = (m: Map<string, any>) => {
        const out = new Map();
        for (const cond of ['N', 'U']) {
          const v = val(m.get(`${set.set_number}|${cond}`));
          if (v > 0) out.set(`${set.set_number}|${cond}`, v);
        }
        return out;
      };
      const cur  = valueSet(set.set_number, acqs, asPriceMap(cacheByKey), fallbackCond, set.quantity || 1);
      const hist = valueSet(set.set_number, acqs, asPriceMap(histByKey),  fallbackCond, set.quantity || 1);
      if (cur.unit_price)  priceMap.set(set.set_number, cur.unit_price);
      if (hist.unit_price) firstHistMap.set(set.set_number, hist.unit_price);
      // Kaufpreis ebenfalls aus den Erfassungen (nur die mit erfasstem Preis).
      const rows = valueAcquisitionRows(set.set_number, acqs, asPriceMap(cacheByKey));
      const purchase = weightedPurchase(rows);
      if (purchase != null) purchaseMap.set(set.set_number, purchase);
      qtyMap.set(set.set_number, cur.quantity);
    }
  }

  const setResults = sets.map(set => {
    const setCondition = effectiveCondition(set);
    const currentPrice = priceMap.get(set.set_number) || 0;
    // Kaufpreis aus den Erfassungen; die sets-Spalte nur noch als Rückfall für
    // Altbestände ohne Erfassungen.
    const acqPurchase = purchaseMap.get(set.set_number);
    const hasCost = acqPurchase != null || set.purchase_price != null;  // 0 zählt als erfasst
    const purchasePrice = acqPurchase != null ? acqPurchase : parseFloat(set.purchase_price || 0);
    const qty = qtyMap.get(set.set_number) || set.quantity || 1;
    const pnlAbs = hasCost ? (currentPrice - purchasePrice) * qty : null;
    const pnlPct = (hasCost && currentPrice > 0) ? ((currentPrice - purchasePrice) / Math.max(purchasePrice, PNL_EPS)) * 100 : null;
    // First price recorded = baseline if no purchase_price (0 zählt als erfasst)
    const baselineHas = hasCost || firstHistMap.has(set.set_number);
    const baselinePrice = hasCost ? purchasePrice : (firstHistMap.get(set.set_number) || 0);
    const baselinePnlPct = (baselineHas && currentPrice > 0) ? ((currentPrice - baselinePrice) / Math.max(baselinePrice, PNL_EPS)) * 100 : null;
    return {
      set_number: set.set_number, name: set.name, year: set.year,
      image_local: set.image_local, image_url: set.image_url,
      quantity: qty, current_price: currentPrice, purchase_price: purchasePrice,
      condition: setCondition, baseline_price: baselinePrice, added_at: set.added_at,
      pnl_abs: pnlAbs?.toFixed(2) ?? null,
      pnl_pct: pnlPct?.toFixed(1) ?? null,
      baseline_pnl_pct: baselinePnlPct?.toFixed(1) ?? null,
    };
  });

  // Manuell erfasste Teile und Minifiguren fliessen mit ihrem eigenen Kaufpreis
  // (bzw. dem Marktpreis als Ersatz) ebenfalls in die Finanzen-Gesamtsumme ein.
  const [partsVal, figsVal] = await Promise.all([
    computePartsValuation(viewerId, uids),
    computeMinifigsValuation(viewerId, uids),
  ]);

  const partsResults = partsVal.parts.map(p => {
    const qty = p.quantity || 1;
    const currentPrice = parseFloat(p.avg_price || 0);
    const hasCost = p.purchase_price != null;
    const purchasePrice = parseFloat(p.purchase_price || 0);
    const pnlPct = (hasCost && currentPrice > 0) ? ((currentPrice - purchasePrice) / Math.max(purchasePrice, PNL_EPS)) * 100 : null;
    return { purchase_price: purchasePrice, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });
  const figsResults = figsVal.figs.map(f => {
    const qty = f.quantity || 1;
    const currentPrice = parseFloat(f.avg_price || 0);
    const hasCost = f.purchase_price != null;
    const purchasePrice = parseFloat(f.purchase_price || 0);
    const pnlPct = (hasCost && currentPrice > 0) ? ((currentPrice - purchasePrice) / Math.max(purchasePrice, PNL_EPS)) * 100 : null;
    return { purchase_price: purchasePrice, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });

  // Portfolio totals — Sets + manuell erfasste Teile + Minifiguren zusammen
  const totalPurchase =
    setResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0) +
    partsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0) +
    figsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0);
  const totalCurrent =
    setResults.reduce((s,r) => s + (r.current_price||0)*(r.quantity||1), 0) +
    partsResults.reduce((s,r) => s + (r.current_price||0)*(r.quantity||1), 0) +
    figsResults.reduce((s,r) => s + (r.current_price||0)*(r.quantity||1), 0);
  const totalPnlPct = totalPurchase > 0 ? ((totalCurrent - totalPurchase) / totalPurchase * 100).toFixed(1) : null;

  return {
    currency, sets: setResults,
    totals: {
      purchase: totalPurchase.toFixed(2), current: totalCurrent.toFixed(2), pnl_pct: totalPnlPct,
      /**
       * Der Gesamtwert des Portfolios — Sets + manuell erfasste Teile +
       * Minifiguren.
       *
       * ── Warum ausdrücklich (Nachtrag 145) ────────────────────────────────
       *
       * Marcos Frage: „Ist sichergestellt, dass die ganze Logik im Server
       * zentral ist und beide Clients nur rendern?"
       *
       * Für diese Zahl war sie es NICHT: Webapp und Android addierten je selbst
       * `sets.totals.avg + parts.total_value + figs.total_value`. Die Regel
       * „was zählt zum Gesamtwert" stand damit an drei Stellen.
       *
       * Derselbe Wert steckte schon in `current` — der wird aber aus den
       * Preisen JE ZEILE gebildet und ist damit die belastbarere Quelle als
       * eine Addition dreier gerundeter Endsummen. Er bekommt hier nur einen
       * Namen, der sagt, wofür er da ist. Kein zusätzlicher Abruf: Beide
       * Clients holen /finance/pnl ohnehin.
       */
      grand_total: totalCurrent.toFixed(2),
      sets_purchase: setResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0).toFixed(2),
      parts_purchase: partsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0).toFixed(2),
      figs_purchase: figsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0).toFixed(2),
    },
  };
}


export {
  DEFAULT_PRICE_CONDITION,
  checkAndIncrementRateLimit, getLimitForApi, getRateLimitStatus,
  fetchPrice, parallelLimit, resolveBlColorId, resolveBlPartNumber, fetchPartPrice, fetchMinifigPrice,
  computeSetsValuation, computeMinifigsValuation, computePartsValuation, computePnl,
  resolveSetCondition,
};
