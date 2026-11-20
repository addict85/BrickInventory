import { savePrice, cacheUsable, priceFromCache, parallelLimit } from './financeCalc';
import { reportError, fehlertext, logAndContinue } from '../infra/fehler';
import { JobMove, type JobContext } from '../auftraege';
import { withoutBricklinkPrice } from '../infra/setNummer';
import { hatPrice } from '../katalog';
import { BricklinkNotReachable } from '../externalSources';
import { receiptsSessionLock } from '../../db/txLock';
import { LOCKS } from '../infra/lockNamespaces';
import { versuche } from '../infra/ergebnis';
import { zustand } from '../infra/validate';
import type { FinancesContext } from './kontext';
import { checkSet } from './preisalarm';

/** Der Job läuft im Job-Prozess, gelesen wird im Web-Prozess — darum in laufzustand. */
export const PRICE_STATUS = 'preis_job_stand';
const _log: string[] = [];

const PRICE_JOB_LOCK = LOCKS.PRICE_JOB;

/** Auf einer EIGENEN Verbindung über die ganze Laufzeit: Manuelle Auslöser
 * laufen in anderen Prozessen, `state.running` sieht sie nicht.
 * @returns Freigabefunktion, oder null wenn anderswo bereits ein Lauf läuft */
async function acquireRunLock(k: FinancesContext): Promise<(() => Promise<void>) | null> {
  let freigabe: (() => Promise<void>) | null;
  try {
    freigabe = await receiptsSessionLock(k.db, PRICE_JOB_LOCK);
  } catch (e) {
    // Ausnahme: Lieber ohne Sperre laufen als gar nicht; im Prozess schützt die Exklusivität der Art.
    log(`Sperre nicht verfügbar (${fehlertext(e)}) — Lauf ohne prozessübergreifenden Schutz`);
    return async () => {};
  }
  if (!freigabe) return null;
  const f = freigabe;
  return () => f().catch(e => log(`Sperre konnte nicht freigegeben werden: ${fehlertext(e)}`));
}

function log(msg: string) {
  const line = `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] ${msg}`;
  console.log(`  PriceJob: ${msg}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
  _log.unshift(line);
  if (_log.length > 50) _log.length = 50;
}

// `string | number`: getGlobalSetting() liefert Text, andere Aufrufer eine Zahl.
async function fetchAndCachePrice(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  guideType: string,
  currency: string,
  forceTtlHours?: string | number,
) {
  if (withoutBricklinkPrice(await k.katalog.catalogEntry(setNumber))) return 'skipped_gear';

  const ttl = Math.max(1, parseInt(String(forceTtlHours ?? ''), 10));
  // Dieselbe Frisch-Regel wie im Anfrageweg: Auch eine Null-Zeile wird nach sechs Stunden erneut versucht.
  const vorhanden = await priceFromCache(k, setNumber, condition, currency, ttl);
  if (cacheUsable(vorhanden, ttl, k.uhr.jetzt())) return 'skipped';

  const rl = await k.externalSources.quotaFree('bricklink');
  if (!rl.allowed) return 'rate_limited';

  const fallback = condition === 'N' ? 'U' : 'N';
  let g: Awaited<ReturnType<typeof k.katalog.priceGuide>>;
  try {
    g = await k.katalog.priceGuide(setNumber, condition, guideType, currency);
  } catch (e) {
    if (e instanceof BricklinkNotReachable) return 'nicht_erreichbar';
    log(`Error ${setNumber} (${condition}): ${fehlertext(e).substring(0, 60)}`);
    return 'error';
  }

  // Auch eine Antwort mit lauter Nullen wird geschrieben: Sie hält den nächsten Lauf zurück, sonst kostete
  // dasselbe Set jedes Mal zwei Abrufe.
  const p = await savePrice(k, setNumber, condition, currency, g);

  if (!hatPrice({ avg_price: p.avg, qty_avg_price: p.qavg })) {
    const rl2 = await k.externalSources.quotaFree('bricklink');
    if (rl2.allowed) {
      try {
        const g2 = await k.katalog.priceGuide(setNumber, fallback, guideType, currency);
        await savePrice(k, setNumber, fallback, currency, g2);
      } catch (e) {
        reportError('preis-job:rueckfall-zustand', e);
      }
    }
  }
  return 'updated';
}

/** Zähler und Abbruchgründe eines Laufs, geteilt von allen parallelen Sets. */
interface Laufstand {
  updated: number;
  skipped: number;
  errors: number;
  omitted: number;
  // Ist das Kontingent aufgebraucht, käme jedes weitere Set mit derselben Antwort zurück.
  limitReached?: boolean;
  notReachable?: boolean;
  current: number;
  total: number;
}

/** Auch Merkposten: /price-history liest den Cache nur, ohne diesen Lauf bliebe ihr Verlauf leer. */
async function pricePlacesJeAccount(k: FinancesContext): Promise<Map<number, string[]>> {
  const eigene = await k.preisLauf.inventoryPlaces();
  const gewuenschte = await versuche('preis-job:gewuenschte', k.preisLauf.wantedListsPlaces());
  if (!gewuenschte.ok) log('Merkliste nicht lesbar — nur eigene Sets');
  const jeAccount = new Map<number, string[]>();
  for (const r of [...eigene, ...(gewuenschte.ok ? gewuenschte.wert : [])].sort((a, b) => a.user_id - b.user_id)) {
    const liste = jeAccount.get(r.user_id) ?? [];
    if (!liste.includes(r.set_number)) liste.push(r.set_number);
    jeAccount.set(r.user_id, liste);
  }
  return jeAccount;
}

/** Ein Set in allen Zuständen, die es braucht; das Ergebnis zählt in `st`. */
async function refreshSet(
  k: FinancesContext,
  sn: string,
  states: string[],
  currency: string,
  ttl: string,
  st: Laufstand,
) {
  let last = 'skipped';
  for (const c of states) {
    try {
      const r = await fetchAndCachePrice(k, sn, c, 'sold', currency, ttl);
      if (r === 'updated') {
        st.updated++;
        last = 'updated';
      } else if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        const limit = r === 'rate_limited';
        if (limit ? !st.limitReached : !st.notReachable)
          log(
            `${limit ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — die übrigen Sets folgen im nächsten Lauf`,
          );
        if (limit) st.limitReached = true;
        else st.notReachable = true;
        st.omitted++;
        return 'rate_limited';
      } else if (last !== 'updated') st.skipped++;
    } catch (e) {
      st.errors++;
      log(`Error ${sn} (${c}): ${fehlertext(e).substring(0, 80)}`);
      last = 'error';
    }
  }
  return last;
}

/** 'sold' = tatsächlich erzielte Preise der letzten sechs Monate; fünf Sets parallel. */
async function refreshAccount(
  kx: FinancesContext,
  userId: number,
  setNumbers: string[],
  st: Laufstand,
  k?: JobContext,
) {
  const currency = await kx.einstellungen.userValue(userId, 'currency', 'EUR');
  const ttlHours = (await kx.einstellungen.globalValue('price_cache_ttl', '24')) || '24';
  const valid = setNumbers.filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));
  // Drei Abfragen je Konto statt je Set.
  const states = await statesJeSet(kx, userId, valid);
  const tasks = valid.map(sn => async () => {
    st.current++;
    k?.signal.throwIfAborted();
    if (st.limitReached || st.notReachable) {
      st.omitted++;
      return 'rate_limited';
    }
    if (k && st.current % 10 === 1)
      await k.fortschritt({ erledigt: st.current, gesamt: st.total, text: `${sn} (${st.current}/${st.total})` });
    return refreshSet(kx, sn, states.get(sn) ?? ['N'], currency, ttlHours, st);
  });
  await parallelLimit(tasks, 5);
}

/** Einmal je Lauf, nicht je Abruf; ein Fehlschlag steht im Stand, ihn zu werfen wiederholte den ganzen Lauf. */
async function afterTheRun(k: FinancesContext, auftrag?: JobContext) {
  log('Writing daily price_history snapshot from price_cache...');
  const stand = await versuche('preis-job:tagesstand', k.preisLauf.writeDailyStatus());
  if (stand.ok) log(`Daily snapshot: ${stand.wert} price history entries inserted`);
  const alarme = await versuche('preis-job:preisalarme', async () => {
    const wartende = await k.preisLauf.setsWithAlarm();
    let gemeldet = 0;
    for (const sn of wartende) gemeldet += await checkSet(k, sn, k.mail);
    if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
  });
  const ohne = [stand.ok ? null : 'tagesstand', alarme.ok ? null : 'preisalarme'].filter(x => x !== null);
  if (ohne.length) await auftrag?.fortschritt({ text: `ohne ${ohne.join(', ')}`, ohne });
}

async function reportResult(kx: FinancesContext, st: Laufstand, duration: number, k?: JobContext) {
  const grund = st.notReachable ? 'BrickLink nicht erreichbar' : 'Tageslimit';
  log(
    `Done: ${st.updated} updated, ${st.skipped} skipped, ${st.errors} errors${st.omitted ? `, ${st.omitted} wegen ${grund} ausgelassen` : ''} — ${(duration / 1000).toFixed(1)}s`,
  );
  await rememberStatus(kx, {
    lastRun: kx.uhr.datum().toISOString(),
    lastDuration: duration,
    lastUpdated: st.updated,
    lastErrors: st.errors,
  });
  await k?.fortschritt({
    erledigt: st.total,
    gesamt: st.total,
    text: `${st.updated} aktualisiert, ${st.errors} Fehler — ${(duration / 1000).toFixed(1)}s`,
  });
}

/** Hält ein anderer Prozess die Sperre, wird der Auftrag eine Minute später neu versucht. */
async function runPriceRefresh(kx: FinancesContext, k?: JobContext) {
  if (!(await kx.einstellungen.globalValue('bricklink_consumer_key', ''))) {
    log('BrickLink credentials not configured, skipping');
    await rememberStatus(kx, {});
    return;
  }
  const releaseLock = await acquireRunLock(kx);
  if (!releaseLock) throw new JobMove(new Date(kx.uhr.jetzt() + 60_000), 'Läuft bereits in einem anderen Prozess');
  const t0 = kx.uhr.jetzt();
  const st: Laufstand = { updated: 0, skipped: 0, errors: 0, omitted: 0, current: 0, total: 0 };
  await k?.fortschritt({ erledigt: 0, gesamt: 0, text: 'Starte…' });
  try {
    const jeAccount = await pricePlacesJeAccount(kx);
    st.total = [...jeAccount.values()].reduce((n, l) => n + l.length, 0);
    if (!st.total) {
      log('No sets, nothing to do');
      await rememberStatus(kx, { lastRun: kx.uhr.datum().toISOString() });
      return;
    }
    log(`Starting: ${st.total} set-slots`);
    await k?.fortschritt({ erledigt: 0, gesamt: st.total, text: `0/${st.total} Sets` });
    for (const [userId, setNumbers] of jeAccount) await refreshAccount(kx, userId, setNumbers, st, k);
    await reportResult(kx, st, kx.uhr.jetzt() - t0, k);
    await afterTheRun(kx, k);
  } catch (e) {
    log(`Fatal: ${fehlertext(e)}`);
    await rememberStatus(kx, {});
    throw e;
  } finally {
    await releaseLock(); // MUSS hier stehen: sonst blockiert ein abgestürzter
  }
}

/** Gemischte Sets brauchen beide Preise, reine einen; eine Fassung für Nachtlauf und Erfassen.
 * @param hintCondition Zustand einer Erfassung, die es noch nicht gibt */
async function statesJeSet(
  k: FinancesContext,
  userId: number,
  setNumbers: string[],
  hintCondition: string | null = null,
): Promise<Map<string, string[]>> {
  const ergebnis = new Map<string, string[]>();
  if (!setNumbers.length) return ergebnis;

  type StateRow = { set_number: string; c?: string | null };
  const collect = async (abfrage: Promise<StateRow[]>): Promise<Map<string, Set<string>>> => {
    // Ohne Fang: Ohne die Zustände fiele jedes Set auf 'N', und der Gebrauchtpreis fehlte still.
    const zeilen = await abfrage;
    const m = new Map<string, Set<string>>();
    for (const r of zeilen) {
      if (!m.has(r.set_number)) m.set(r.set_number, new Set<string>());
      m.get(r.set_number)!.add(zustand(r.c));
    }
    return m;
  };

  const erfasst = await collect(k.preisLauf.recordedStates(userId, setNumbers));
  const gewuenscht = await collect(k.preisLauf.desiredStates(userId, setNumbers));

  for (const sn of setNumbers) {
    // Ohne Erfassung ist der Hinweis die einzige Quelle: Die Erfassung des neuen Sets ist noch nicht
    // geschrieben (conditionsNeededFor).
    const eigene = new Set<string>(erfasst.get(sn) ?? []);
    if (hintCondition === 'U' || hintCondition === 'N') eigene.add(hintCondition);
    for (const c of gewuenscht.get(sn) ?? []) eigene.add(c);
    ergebnis.set(sn, eigene.size ? [...eigene] : ['N']);
  }
  return ergebnis;
}

/** Beim Erfassen gibt es die Erfassung noch nicht; ohne den Hinweis fiele die
 * Regel auf 'N' zurück.
 * @returns z. B. ['N'], ['U'] oder ['N','U'] */
async function conditionsNeededFor(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
): Promise<string[]> {
  return (await statesJeSet(k, userId, [setNumber], hintCondition)).get(setNumber) ?? ['N'];
}

async function preisFuerSetHolen(
  k: FinancesContext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
) {
  if (!/^[a-zA-Z0-9]+-\d+$/.test(setNumber)) {
    log(`Skipping invalid: ${setNumber}`);
    return;
  }
  const ck = await k.einstellungen.globalValue('bricklink_consumer_key', '');
  if (!ck) return;
  try {
    const currency = await k.einstellungen.userValue(userId, 'currency', 'EUR');
    const guideType = 'sold';
    // Alle Zustände, die das Set führt — sonst fehlt bei gemischten Sets eine Hälfte.
    const conditions = await conditionsNeededFor(k, setNumber, userId, hintCondition);
    log(`Immediate price fetch: ${setNumber} (${conditions.join('+')})`);
    for (const c of conditions) {
      const r = await fetchAndCachePrice(k, setNumber, c, guideType, currency, 0);
      if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        log(
          `${r === 'rate_limited' ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — ${setNumber} folgt im nächsten Lauf`,
        );
        break;
      }
    }
    log(`Immediate price done: ${setNumber}`);
  } catch (e) {
    // Verbindungsfehler lösen sich beim nächsten Versuch.
    const isConnErr =
      fehlertext(e).includes('timeout') || fehlertext(e).includes('terminated') || fehlertext(e).includes('connect');
    if (!isConnErr) log(`Immediate price failed for ${setNumber}: ${fehlertext(e).substring(0, 80)}`);
  }
}

async function rememberStatus(k: FinancesContext, neu: Record<string, unknown>): Promise<void> {
  const alt = await k.auftraege.liesZustand(PRICE_STATUS).then(
    r => (r ? JSON.parse(r) : {}),
    () => ({}),
  );
  await k.auftraege
    .setzeZustand(PRICE_STATUS, JSON.stringify({ ...alt, ...neu, log: _log.slice(0, 15) }))
    .catch(logAndContinue('preis-job:stand'));
}

export { runPriceRefresh, preisFuerSetHolen, fetchAndCachePrice, statesJeSet, conditionsNeededFor };
