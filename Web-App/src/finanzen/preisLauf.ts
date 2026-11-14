import { speicherePreis, cacheUsable, preisAusCache, parallelLimit } from './financeCalc';
import { meldeFehler, fehlertext, logAndContinue } from '../infra/fehler';
import { AuftragVerschieben, type AuftragsKontext } from '../auftraege';
import { ohneBricklinkPreis } from '../infra/setNummer';
import { BricklinkNichtErreichbar, hatPreis } from '../katalog';
import { belegeSitzungsSperre } from '../../db/txLock';
import { LOCKS } from '../infra/lockNamespaces';
import { versuche } from '../infra/ergebnis';
import { zustand } from '../infra/validate';
import type { FinanzenKontext } from './kontext';

/** Der Job läuft im Job-Prozess, gelesen wird im Web-Prozess — darum in laufzustand. */
export const PREIS_STAND = 'preis_job_stand';
const _log: string[] = [];

const PRICE_JOB_LOCK = LOCKS.PREIS_JOB;

/** Auf einer EIGENEN Verbindung über die ganze Laufzeit: Manuelle Auslöser
 * laufen in anderen Prozessen, `state.running` sieht sie nicht.
 * @returns Freigabefunktion, oder null wenn anderswo bereits ein Lauf läuft */
async function acquireRunLock(k: FinanzenKontext): Promise<(() => Promise<void>) | null> {
  let freigabe: (() => Promise<void>) | null;
  try {
    freigabe = await belegeSitzungsSperre(k.db, PRICE_JOB_LOCK);
  } catch (e) {
    // Ohne Verbindung keine Sperre — dann lieber laufen als gar nicht aktualisieren; im eigenen Prozess
    // schützt die Exklusivität der Art.
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
  k: FinanzenKontext,
  setNumber: string,
  condition: string,
  guideType: string,
  currency: string,
  forceTtlHours?: string | number,
) {
  if (ohneBricklinkPreis(await k.katalog.katalogEintrag(setNumber))) return 'skipped_gear';

  const ttl = Math.max(1, parseInt(String(forceTtlHours ?? ''), 10));
  // Dieselbe Frisch-Regel wie im Anfrageweg: Auch eine Null-Zeile wird nach sechs Stunden erneut versucht.
  const vorhanden = await preisAusCache(k, setNumber, condition, currency, ttl);
  if (cacheUsable(vorhanden, ttl)) return 'skipped';

  const rl = await k.katalog.kontingentFrei('bricklink');
  if (!rl.allowed) return 'rate_limited';

  const fallback = condition === 'N' ? 'U' : 'N';
  let g: Awaited<ReturnType<typeof k.katalog.getPriceGuide>>;
  try {
    g = await k.katalog.getPriceGuide(setNumber, condition, guideType, currency);
  } catch (e) {
    if (e instanceof BricklinkNichtErreichbar) return 'nicht_erreichbar';
    log(`Error ${setNumber} (${condition}): ${fehlertext(e).substring(0, 60)}`);
    return 'error';
  }

  // Auch eine Antwort mit lauter Nullen wird geschrieben: Sie hält den nächsten Lauf zurück, sonst kostete
  // dasselbe Set jedes Mal zwei Abrufe.
  const p = await speicherePreis(k, setNumber, condition, currency, g);

  if (!hatPreis({ avg_price: p.avg, qty_avg_price: p.qavg })) {
    const rl2 = await k.katalog.kontingentFrei('bricklink');
    if (rl2.allowed) {
      try {
        const g2 = await k.katalog.getPriceGuide(setNumber, fallback, guideType, currency);
        await speicherePreis(k, setNumber, fallback, currency, g2);
      } catch (e) {
        meldeFehler('preis-job:rueckfall-zustand', e);
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
  ausgelassen: number;
  // Ist das Kontingent aufgebraucht, käme jedes weitere Set mit derselben Antwort zurück.
  limitErreicht?: boolean;
  nichtErreichbar?: boolean;
  current: number;
  total: number;
}

/** Auch Merkposten: /price-history liest den Cache nur, ohne diesen Lauf bliebe ihr Verlauf leer. */
async function preisPlaetzeJeKonto(k: FinanzenKontext): Promise<Map<number, string[]>> {
  const eigene = await k.preisLauf.bestandsPlaetze();
  const gewuenschte = await versuche('preis-job:gewuenschte', k.preisLauf.merklistenPlaetze());
  if (!gewuenschte.ok) log('Merkliste nicht lesbar — nur eigene Sets');
  const jeKonto = new Map<number, string[]>();
  for (const r of [...eigene, ...(gewuenschte.ok ? gewuenschte.wert : [])].sort((a, b) => a.user_id - b.user_id)) {
    const liste = jeKonto.get(r.user_id) ?? [];
    if (!liste.includes(r.set_number)) liste.push(r.set_number);
    jeKonto.set(r.user_id, liste);
  }
  return jeKonto;
}

/** Ein Set in allen Zuständen, die es braucht; das Ergebnis zählt in `st`. */
async function aktualisiereSet(
  k: FinanzenKontext,
  sn: string,
  zustaende: string[],
  currency: string,
  ttl: string,
  st: Laufstand,
) {
  let last = 'skipped';
  for (const c of zustaende) {
    try {
      const r = await fetchAndCachePrice(k, sn, c, 'sold', currency, ttl);
      if (r === 'updated') {
        st.updated++;
        last = 'updated';
      } else if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        const limit = r === 'rate_limited';
        if (limit ? !st.limitErreicht : !st.nichtErreichbar)
          log(
            `${limit ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — die übrigen Sets folgen im nächsten Lauf`,
          );
        if (limit) st.limitErreicht = true;
        else st.nichtErreichbar = true;
        st.ausgelassen++;
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
async function aktualisiereKonto(
  kx: FinanzenKontext,
  userId: number,
  setNumbers: string[],
  st: Laufstand,
  k?: AuftragsKontext,
) {
  const currency = await kx.einstellungen.getSetting(userId, 'currency', 'EUR');
  const ttlHours = (await kx.einstellungen.getGlobalSetting('price_cache_ttl', '24')) || '24';
  const valid = setNumbers.filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));
  // Drei Abfragen je Konto statt je Set.
  const zustaende = await zustaendeJeSet(kx, userId, valid);
  const tasks = valid.map(sn => async () => {
    st.current++;
    k?.signal.throwIfAborted();
    if (st.limitErreicht || st.nichtErreichbar) {
      st.ausgelassen++;
      return 'rate_limited';
    }
    if (k && st.current % 10 === 1)
      await k.fortschritt({ erledigt: st.current, gesamt: st.total, text: `${sn} (${st.current}/${st.total})` });
    return aktualisiereSet(kx, sn, zustaende.get(sn) ?? ['N'], currency, ttlHours, st);
  });
  await parallelLimit(tasks, 5);
}

/** Tagespunkt und Preisalarme einmal je Lauf: Je Abruf liefe die Prüfung tausendfach und meldete doppelt. */
async function nachDemLauf(k: FinanzenKontext) {
  log('Writing daily price_history snapshot from price_cache...');
  try {
    log(`Daily snapshot: ${await k.preisLauf.schreibeTagesstand()} price history entries inserted`);
  } catch (e) {
    log(`Daily snapshot error: ${fehlertext(e)}`);
  }
  try {
    const wartende = await k.preisLauf.setsMitAlarm();
    let gemeldet = 0;
    for (const sn of wartende) gemeldet += await k.preisalarm.pruefeSet(sn, k.mail);
    if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
  } catch (e) {
    log(`Preisalarm error: ${fehlertext(e)}`);
  }
}

async function meldeErgebnis(kx: FinanzenKontext, st: Laufstand, dur: number, k?: AuftragsKontext) {
  const grund = st.nichtErreichbar ? 'BrickLink nicht erreichbar' : 'Tageslimit';
  log(
    `Done: ${st.updated} updated, ${st.skipped} skipped, ${st.errors} errors${st.ausgelassen ? `, ${st.ausgelassen} wegen ${grund} ausgelassen` : ''} — ${(dur / 1000).toFixed(1)}s`,
  );
  await merkeStand(kx, {
    lastRun: new Date().toISOString(),
    lastDuration: dur,
    lastUpdated: st.updated,
    lastErrors: st.errors,
  });
  await k?.fortschritt({
    erledigt: st.total,
    gesamt: st.total,
    text: `${st.updated} aktualisiert, ${st.errors} Fehler — ${(dur / 1000).toFixed(1)}s`,
  });
}

/** Hält ein anderer Prozess die Sperre, wird der Auftrag eine Minute später neu versucht. */
async function runPriceRefresh(kx: FinanzenKontext, k?: AuftragsKontext) {
  if (!(await kx.einstellungen.getGlobalSetting('bricklink_consumer_key', ''))) {
    log('BrickLink credentials not configured, skipping');
    await merkeStand(kx, {});
    return;
  }
  const releaseLock = await acquireRunLock(kx);
  if (!releaseLock)
    throw new AuftragVerschieben(new Date(Date.now() + 60_000), 'Läuft bereits in einem anderen Prozess');
  const t0 = Date.now();
  const st: Laufstand = { updated: 0, skipped: 0, errors: 0, ausgelassen: 0, current: 0, total: 0 };
  await k?.fortschritt({ erledigt: 0, gesamt: 0, text: 'Starte…' });
  try {
    const jeKonto = await preisPlaetzeJeKonto(kx);
    st.total = [...jeKonto.values()].reduce((n, l) => n + l.length, 0);
    if (!st.total) {
      log('No sets, nothing to do');
      await merkeStand(kx, { lastRun: new Date().toISOString() });
      return;
    }
    log(`Starting: ${st.total} set-slots`);
    await k?.fortschritt({ erledigt: 0, gesamt: st.total, text: `0/${st.total} Sets` });
    for (const [userId, setNumbers] of jeKonto) await aktualisiereKonto(kx, userId, setNumbers, st, k);
    await meldeErgebnis(kx, st, Date.now() - t0, k);
    await nachDemLauf(kx);
  } catch (e) {
    log(`Fatal: ${fehlertext(e)}`);
    await merkeStand(kx, {});
    throw e;
  } finally {
    await releaseLock(); // MUSS hier stehen: sonst blockiert ein abgestürzter
  }
}

/** Gemischte Sets brauchen beide Preise, reine nur einen — eine Fassung für
 * den Nachtlauf und das Erfassen.
 * @param hintCondition Zustand einer Erfassung, die es noch nicht GIBT
 * @returns Map mit einem Eintrag je übergebenem Set, nie leer je Eintrag */
async function zustaendeJeSet(
  k: FinanzenKontext,
  userId: number,
  setNumbers: string[],
  hintCondition: string | null = null,
): Promise<Map<string, string[]>> {
  const ergebnis = new Map<string, string[]>();
  if (!setNumbers.length) return ergebnis;

  type ZustandsZeile = { set_number: string; c?: string | null };
  const sammle = async (abfrage: Promise<ZustandsZeile[]>): Promise<Map<string, Set<string>>> => {
    // Ohne Fang: Ohne die Zustände fiele jedes Set auf 'N', und der Gebrauchtpreis fehlte still.
    const zeilen = await abfrage;
    const m = new Map<string, Set<string>>();
    for (const r of zeilen) {
      if (!m.has(r.set_number)) m.set(r.set_number, new Set<string>());
      m.get(r.set_number)!.add(zustand(r.c));
    }
    return m;
  };

  const erfasst = await sammle(k.preisLauf.erfassteZustaende(userId, setNumbers));
  const gewuenscht = await sammle(k.preisLauf.gewuenschteZustaende(userId, setNumbers));

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
  k: FinanzenKontext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
): Promise<string[]> {
  return (await zustaendeJeSet(k, userId, [setNumber], hintCondition)).get(setNumber) ?? ['N'];
}

async function refreshPriceForSet(
  k: FinanzenKontext,
  setNumber: string,
  userId: number,
  hintCondition: string | null = null,
) {
  if (!/^[a-zA-Z0-9]+-\d+$/.test(setNumber)) {
    log(`Skipping invalid: ${setNumber}`);
    return;
  }
  const ck = await k.einstellungen.getGlobalSetting('bricklink_consumer_key', '');
  if (!ck) return;
  try {
    const currency = await k.einstellungen.getSetting(userId, 'currency', 'EUR');
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

async function merkeStand(k: FinanzenKontext, neu: Record<string, unknown>): Promise<void> {
  const alt = await k.auftraege.liesZustand(PREIS_STAND).then(
    r => (r ? JSON.parse(r) : {}),
    () => ({}),
  );
  await k.auftraege
    .setzeZustand(PREIS_STAND, JSON.stringify({ ...alt, ...neu, log: _log.slice(0, 15) }))
    .catch(logAndContinue('preis-job:stand'));
}

export { runPriceRefresh, refreshPriceForSet, fetchAndCachePrice, zustaendeJeSet, conditionsNeededFor };
