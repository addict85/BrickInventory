/** Preise, die eine Bewertung im Cache nicht fand (src/finances/calculation/valuation.ts):
 * hier im Job-Prozess geholt, mit Kontingent und Abbruch, nicht in der Anfrage. */
import { fetchPrice, fetchPartPrice, fetchMinifigPrice } from './calculation/prices';
import { estimateMinifigsPrice } from './marketPrice';
import { checkAbort, JobMove, type JobContext, type Nutzlast } from '../jobQueue';
import { reportError } from '../infra/fehler';
import type { FinancesContext } from './context';

type Posten = Nutzlast<'preise_nachladen'>['posten'][number];

async function fetchOne(k: FinancesContext, p: Posten, uid: number, waehrung: string, ttl: string): Promise<void> {
  if (p.art === 'set') await fetchPrice(k, p.nummer, p.zustand, 'sold', waehrung, ttl);
  else if (p.art === 'teil') await fetchPartPrice(k, p.nummer, p.farbe, p.zustand, waehrung, ttl);
  else if (p.art === 'figur') await fetchMinifigPrice(k, p.nummer, p.zustand, waehrung, ttl);
  else await estimateMinifigsPrice(k, p.nummer, uid, p.zustand);
}

/** Ist das Tageskontingent erschöpft, wartet der Rest bis morgen; ein einzelner Fehlschlag hält die Liste nicht an. */
async function preiseNachladen(kx: FinancesContext, n: Nutzlast<'preise_nachladen'>, k: JobContext): Promise<void> {
  const ttl = (await kx.einstellungen.globalValue('price_cache_ttl', '24')) || '24';
  for (const [i, p] of n.posten.entries()) {
    checkAbort(k);
    if (!(await kx.externalSources.quotaFree('bricklink')).allowed)
      throw new JobMove(new Date(kx.uhr.jetzt() + 6 * 3600_000), 'BrickLink-Tageskontingent erschöpft');
    await fetchOne(kx, p, n.user_id, n.waehrung, ttl).catch((e: unknown) =>
      reportError(`preise-nachladen:${p.art} ${p.nummer}`, e),
    );
    if (i % 10 === 9) await k.fortschritt({ erledigt: i + 1, gesamt: n.posten.length });
  }
}

export { preiseNachladen };
