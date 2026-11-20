/** Als Auftrag, damit ein Fehlschlag wiederholt wird und sichtbar bleibt. */
import type { JobRun } from '../auftraege';
import {
  ECB_HISTORY,
  ECB_DAILY_RATES,
  firstZipFile,
  readHistory,
  readDailyRates,
  type Abruf,
  type Kurs,
} from '../externalSources';
import type { FinancesContext } from './context';

const BLOCK = 5000;

/** Ein vorhandener Tag wird überschrieben: Die EZB korrigiert selten, aber sie tut es. */
export async function saveRates(kx: FinancesContext, rates: Kurs[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rates.length; i += BLOCK) {
    const teil = rates.slice(i, i + BLOCK);
    const r = await kx.wechselkurse.writeRates(
      teil.map(k => k.tag),
      teil.map(k => k.waehrung),
      teil.map(k => String(k.je_eur)),
    );
    n += r?.changes ?? 0;
  }
  return n;
}

export async function reloadRates(
  k: FinancesContext,
  abruf: Abruf = k.externalSources.quellen.ecbFetch,
  signal?: AbortSignal,
): Promise<{ quelle: 'historie' | 'tag'; rates: number }> {
  const leer = !(await k.wechselkurse.givesEsRates());
  const rates = leer
    ? readHistory(firstZipFile(await abruf(ECB_HISTORY, signal)).toString('utf8'))
    : readDailyRates((await abruf(ECB_DAILY_RATES, signal)).toString('utf8'));
  if (!rates.length) throw new Error(`EZB lieferte keine Kurse (${leer ? 'Historie' : 'Tageskurse'})`);
  return { quelle: leer ? 'historie' : 'tag', rates: await saveRates(k, rates) };
}

/** 15:30 UTC liegt nach der Veröffentlichung der EZB. Je Tag ein eigener
 * Schlüssel: Ein gescheiterter Versuch darf den nächsten Tag nicht sperren. */
export async function planeKursabruf(
  k: FinancesContext,
  jetzt = k.uhr.datum(),
  morgen = false,
): Promise<string | null> {
  const ziel = new Date(
    Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() + (morgen ? 1 : 0), 15, 30),
  );
  const sek = Math.max(0, Math.round((ziel.getTime() - jetzt.getTime()) / 1000));
  return k.auftraege.placeJobOne(
    'wechselkurse',
    {},
    {
      schluessel: `wechselkurse:${ziel.toISOString().slice(0, 10)}`,
      afterSeconds: morgen ? sek : 0,
      maxAttempts: 6,
    },
  );
}

/** Erst den nächsten Tag einplanen, dann laden: Scheitert das Laden, steht der Plan schon. */
export async function kursauftrag(
  k: FinancesContext,
  abruf: Abruf = k.externalSources.quellen.ecbFetch,
  lauf?: JobRun,
): Promise<void> {
  await planeKursabruf(k, k.uhr.datum(), true);
  const r = await reloadRates(k, abruf, lauf?.signal);
  console.log(`[wechselkurse] ${r.rates} Kurse aus der EZB-${r.quelle === 'historie' ? 'Historie' : 'Tagesdatei'}`);
}
