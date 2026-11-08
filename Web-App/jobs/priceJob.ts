import { kontingentFrei, speicherePreis, cacheUsable, preisAusCache, parallelLimit, bestandsPlaetze, merklistenPlaetze,
  erfassteZustaende, gewuenschteZustaende, schreibeTagesstand, setsMitAlarm } from '../src/finanzen/financeCalc';
import { meldeFehler, fehlertext, einzeilig, meldeUndLiefere, logAndContinue } from '../src/infra/fehler';
import { liesZustand, setzeZustand } from '../src/auftraege/laufzustand';
import { AuftragVerschieben, type AuftragsKontext } from './auftragsWorker';
import { getGlobalSetting, getSetting } from '../src/einstellungen/settings';
import { ohneBricklinkPreis } from '../src/infra/setNummer';
import { katalogEintrag, getPriceGuide } from '../src/katalog/bricklinkPreise';
import { BricklinkNichtErreichbar } from '../src/katalog/quellen';
import { belegeSitzungsSperre } from '../db/txLock';
import { LOCKS } from '../src/infra/lockNamespaces';
import { pruefeSet } from '../src/finanzen/preisalarm';

/** Der Job läuft im Job-Prozess, gelesen wird im Web-Prozess — darum in laufzustand. */
export const PREIS_STAND = 'preis_job_stand';
const _log: string[] = [];

const PRICE_JOB_LOCK = LOCKS.PREIS_JOB;

/** Auf einer EIGENEN Verbindung über die ganze Laufzeit: Manuelle Auslöser
 * laufen in anderen Prozessen, `state.running` sieht sie nicht.
 * Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#acquirerunlock
 * @returns Freigabefunktion, oder null wenn anderswo bereits ein Lauf läuft */
async function acquireRunLock(): Promise<(() => Promise<void>) | null> {
  let freigabe: (() => Promise<void>) | null;
  try { freigabe = await belegeSitzungsSperre(PRICE_JOB_LOCK); }
  catch (e) {
    // Ohne Verbindung keine Sperre — dann lieber laufen als gar nicht
    // aktualisieren; im eigenen Prozess schützt die Exklusivität der Art.
    log(`Sperre nicht verfügbar (${fehlertext(e)}) — Lauf ohne prozessübergreifenden Schutz`);
    return async () => {};
  }
  if (!freigabe) return null;
  const f = freigabe;
  return () => f().catch(e => log(`Sperre konnte nicht freigegeben werden: ${fehlertext(e)}`));
}

function log(msg: string) {
  const line = `[${new Date().toISOString().replace('T',' ').substring(0,19)}] ${msg}`;
  console.log(einzeilig(`  PriceJob: ${msg}`));
  _log.unshift(line);
  if (_log.length > 50) _log.length = 50;
}

// `string | number`: getGlobalSetting() liefert Text, andere Aufrufer eine Zahl.
async function fetchAndCachePrice(setNumber: string, condition: string, guideType: string,
                                  currency: string, forceTtlHours?: string | number) {
  if (ohneBricklinkPreis(await katalogEintrag(setNumber))) return 'skipped_gear';

  const ttl = Math.max(1, parseInt(String(forceTtlHours ?? '')));
  // Dieselbe Frisch-Regel wie im Anfrageweg: Auch eine Null-Zeile wird nach
  // sechs Stunden erneut versucht.
  const vorhanden = await preisAusCache(setNumber, condition, currency, ttl);
  if (cacheUsable(vorhanden, ttl)) return 'skipped';

  const rl = await kontingentFrei('bricklink');
  if (!rl.allowed) return 'rate_limited';

  const fallback = condition === 'N' ? 'U' : 'N';
  let g;
  try { g = await getPriceGuide(setNumber, condition, guideType, currency); }
  catch (e) {
    if (e instanceof BricklinkNichtErreichbar) return 'nicht_erreichbar';
    log(`Error ${setNumber} (${condition}): ${fehlertext(e).substring(0,60)}`); return 'error';
  }

  // Auch eine Antwort mit lauter Nullen wird geschrieben: Sie hält den nächsten
  // Lauf zurück, sonst kostete dasselbe Set jedes Mal zwei Abrufe.
  const p = await speicherePreis(setNumber, condition, currency, g);

  if (p.avg === 0 && p.qavg === 0) {
    const rl2 = await kontingentFrei('bricklink');
    if (rl2.allowed) {
      try {
        const g2 = await getPriceGuide(setNumber, fallback, guideType, currency);
        await speicherePreis(setNumber, fallback, currency, g2);
      } catch (e) { meldeFehler('preis-job:rueckfall-zustand', e); }
    }
  }
  return 'updated';
}

/** Hält ein anderer Prozess die Sperre, wird der Auftrag eine Minute später neu versucht. */
async function runPriceRefresh(k?: AuftragsKontext) {
  const ck = await getGlobalSetting('bricklink_consumer_key', '');
  if (!ck) { log('BrickLink credentials not configured, skipping'); await merkeStand({}); return; }

  const releaseLock = await acquireRunLock();
  if (!releaseLock) throw new AuftragVerschieben(new Date(Date.now() + 60_000), 'Läuft bereits in einem anderen Prozess');

  const t0 = Date.now(); let updated=0, skipped=0, errors=0, ausgelassen=0;
  // Ist das Kontingent aufgebraucht, käme jedes weitere Set mit derselben Antwort zurück.
  let limitErreicht = false, nichtErreichbar = false;
  const fortschritt = { current:0, total:0, set:null as string | null };
  await k?.fortschritt({ erledigt: 0, gesamt: 0, text: 'Starte…' });
  try {
    // Auch Merkposten: /price-history liest den Cache nur, und ohne diesen Lauf
    // bliebe ihr Preisverlauf leer. Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh-eigene
    const eigene = await bestandsPlaetze();
    const gewuenschte = await merklistenPlaetze().catch(meldeUndLiefere('preis-job:gewuenschte', []));
    const allSets = [...eigene, ...(gewuenschte || [])]
      .filter((r, i, a) => a.findIndex(x =>
        x.user_id === r.user_id && x.set_number === r.set_number) === i)
      .sort((a, b) => a.user_id - b.user_id);
    if (!allSets.length) { log('No sets, nothing to do'); await merkeStand({ lastRun: new Date().toISOString() }); return; }
    log(`Starting: ${allSets.length} set-slots`);
    fortschritt.total = allSets.length;
    await k?.fortschritt({ erledigt: 0, gesamt: allSets.length, text: `0/${allSets.length} Sets` });
    const byUser: Record<string, string[]> = {};
    for (const row of allSets) (byUser[row.user_id] = byUser[row.user_id] || []).push(row.set_number);
    for (const [userId, setNumbers] of Object.entries(byUser)) {
      // Number(): Object.entries() liefert Schlüssel als Zeichenketten.
      const currency  = await getSetting(Number(userId), 'currency', 'EUR');
      // 'sold' = tatsächlich erzielte Preise der letzten sechs Monate.
      const guideType = 'sold';
      const ttlHours  = (await getGlobalSetting('price_cache_ttl', '24')) || '24';
      const valid = setNumbers.filter(sn => /^[a-zA-Z0-9]+-\d+$/.test(sn));

      // Drei Abfragen je Nutzer statt je Set; jeder überflüssige Abruf ginge auf
      // das BrickLink-Tageskontingent.
      const zustaende = await zustaendeJeSet(Number(userId), valid);

      const tasks = valid.map(sn => async () => {
        fortschritt.current++; fortschritt.set = sn;
        k?.signal.throwIfAborted();
        if (limitErreicht || nichtErreichbar) { ausgelassen++; return 'rate_limited'; }
        if (k && fortschritt.current % 10 === 1)
          await k.fortschritt({ erledigt: fortschritt.current, gesamt: fortschritt.total, text: `${sn} (${fortschritt.current}/${fortschritt.total})` });
        const conditions = zustaende.get(sn) ?? ['N'];
        let last = 'skipped';
        for (const c of conditions) {
          try {
            const r = await fetchAndCachePrice(sn, c, guideType, currency, ttlHours);
            if (r === 'updated') { updated++; last = 'updated'; }
            else if (r === 'rate_limited') {
              if (!limitErreicht) log('BrickLink-Tageslimit erreicht — die übrigen Sets folgen im nächsten Lauf');
              limitErreicht = true; ausgelassen++; return 'rate_limited';
            }
            else if (r === 'nicht_erreichbar') {
              if (!nichtErreichbar) log('BrickLink nicht erreichbar (Wartung) — die übrigen Sets folgen im nächsten Lauf');
              nichtErreichbar = true; ausgelassen++; return 'rate_limited';
            }
            else if (last !== 'updated') { skipped++; }
          } catch (e) { errors++; log(`Error ${sn} (${c}): ${fehlertext(e).substring(0,80)}`); last = 'error'; }
        }
        return last;
      });
      await parallelLimit(tasks, 5);
    }
    const dur = Date.now() - t0;
    const grund = nichtErreichbar ? 'BrickLink nicht erreichbar' : 'Tageslimit';
    log(`Done: ${updated} updated, ${skipped} skipped, ${errors} errors${ausgelassen ? `, ${ausgelassen} wegen ${grund} ausgelassen` : ''} — ${(dur/1000).toFixed(1)}s`);
    const lastRun = new Date().toISOString();
    await merkeStand({ lastRun, lastDuration: dur, lastUpdated: updated, lastErrors: errors });
    await k?.fortschritt({ erledigt: fortschritt.total, gesamt: fortschritt.total, text: `${updated} aktualisiert, ${errors} Fehler — ${(dur/1000).toFixed(1)}s` });

    log('Writing daily price_history snapshot from price_cache...');
    try {
      log(`Daily snapshot: ${await schreibeTagesstand()} price history entries inserted`);
    } catch(e) { log(`Daily snapshot error: ${fehlertext(e)}`); }

    // Preisalarme hier und nicht je Abruf: Dort liefe die Prüfung tausendfach und
    // meldete dasselbe mehrmals. Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#runpricerefresh-2
    try {
      const wartende = await setsMitAlarm().catch(meldeUndLiefere('preis-job:wartende', []));
      let gemeldet = 0;
      for (const sn of wartende) gemeldet += await pruefeSet(sn);
      if (wartende?.length) log(`Preisalarm: ${wartende.length} Sets geprueft, ${gemeldet} gemeldet`);
    } catch (e) { log(`Preisalarm error: ${fehlertext(e)}`); }

  } catch (e) { log(`Fatal: ${fehlertext(e)}`); await merkeStand({}); throw e; }
  finally {
    await releaseLock();   // MUSS hier stehen: sonst blockiert ein abgestürzter
  }
}

/** Gemischte Sets brauchen beide Preise, reine nur einen — eine Fassung für
 * den Nachtlauf und das Erfassen. Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#zustaendejeset
 * @param hintCondition Zustand einer Erfassung, die es noch nicht GIBT
 * @returns Map mit einem Eintrag je übergebenem Set, nie leer je Eintrag */
async function zustaendeJeSet(userId: number, setNumbers: string[],
                              hintCondition: string | null = null): Promise<Map<string, string[]>> {
  const ergebnis = new Map<string, string[]>();
  if (!setNumbers.length) return ergebnis;

  type ZustandsZeile = { set_number: string; c?: string | null };
  const sammle = async (abfrage: Promise<ZustandsZeile[]>): Promise<Map<string, Set<string>>> => {
    const zeilen = await abfrage.catch(meldeUndLiefere('preis-job:all', []));
    const m = new Map<string, Set<string>>();
    for (const r of zeilen) {
      if (!m.has(r.set_number)) m.set(r.set_number, new Set<string>());
      m.get(r.set_number)!.add(r.c === 'U' ? 'U' : 'N');
    }
    return m;
  };

  const erfasst = await sammle(erfassteZustaende(userId, setNumbers));
  const gewuenscht = await sammle(gewuenschteZustaende(userId, setNumbers));

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

/** Beim Erfassen gibt es die Erfassung noch nicht; ohne den Hinweis fiele die
 * Regel auf 'N' zurück. Ausführlich: docs/begruendungen/jobs/priceJob.ts.md#conditionsneededfor
 * @returns z. B. ['N'], ['U'] oder ['N','U'] */
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
    const guideType = 'sold';
    // Alle Zustände, die das Set führt — sonst fehlt bei gemischten Sets eine Hälfte.
    const conditions = await conditionsNeededFor(setNumber, userId, hintCondition);
    log(`Immediate price fetch: ${setNumber} (${conditions.join('+')})`);
    for (const c of conditions) {
      const r = await fetchAndCachePrice(setNumber, c, guideType, currency, 0);
      if (r === 'rate_limited' || r === 'nicht_erreichbar') {
        log(`${r === 'rate_limited' ? 'BrickLink-Tageslimit erreicht' : 'BrickLink nicht erreichbar (Wartung)'} — ${setNumber} folgt im nächsten Lauf`);
        break;
      }
    }
    log(`Immediate price done: ${setNumber}`);
  } catch (e) {
    // Verbindungsfehler lösen sich beim nächsten Versuch.
    const isConnErr = fehlertext(e).includes('timeout') || fehlertext(e).includes('terminated') || fehlertext(e).includes('connect');
    if (!isConnErr) log(`Immediate price failed for ${setNumber}: ${fehlertext(e).substring(0, 80)}`);
  }
}

async function merkeStand(neu: Record<string, unknown>): Promise<void> {
  const alt = await liesZustand(PREIS_STAND).then(r => (r ? JSON.parse(r) : {}), () => ({}));
  await setzeZustand(PREIS_STAND, JSON.stringify({ ...alt, ...neu, log: _log.slice(0, 15) }))
    .catch(logAndContinue('preis-job:stand'));
}

export { runPriceRefresh, refreshPriceForSet, fetchAndCachePrice,
         zustaendeJeSet, conditionsNeededFor };