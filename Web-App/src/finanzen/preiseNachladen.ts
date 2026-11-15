/** Preise, die eine Bewertung im Cache nicht fand (src/finanzen/rechnung/bewertung.ts):
 * hier im Job-Prozess geholt, mit Kontingent und Abbruch, nicht in der Anfrage. */
import { z } from 'zod';
import { fetchPrice, fetchPartPrice, fetchMinifigPrice } from './rechnung/preise';
import { schaetzeFigurenpreis } from './marketPrice';
import {
  pruefeAbbruch,
  AuftragVerschieben,
  type AuftragsKontext,
  type Nutzlast,
  type NutzlastEingabe,
} from '../auftraege';
import { meldeFehler } from '../infra/fehler';
import type { FinanzenKontext } from './kontext';

const SETNR = z.string().min(1).max(64);
const ZUSTAND = z.enum(['N', 'U']);
const PreisPosten = z.discriminatedUnion('art', [
  z.object({ art: z.literal('set'), nummer: SETNR, zustand: ZUSTAND }),
  z.object({ art: z.literal('teil'), nummer: SETNR, farbe: z.number().int(), zustand: ZUSTAND }),
  z.object({ art: z.literal('figur'), nummer: SETNR, zustand: ZUSTAND }),
  z.object({ art: z.literal('schaetzung'), nummer: SETNR, zustand: ZUSTAND }),
]);
export const PREISPOSTEN_HOECHSTENS = 2000;
export const PreiseNachladen = z.object({
  user_id: z.number().int().positive(),
  waehrung: z.string().min(3).max(3),
  posten: z.array(PreisPosten).max(PREISPOSTEN_HOECHSTENS),
});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    preise_nachladen: typeof PreiseNachladen;
  }
}

/** Fehlende Preise eines Kontos in einer Währung: höchstens ein wartender Auftrag, der jede neue Meldung aufnimmt. */
export function merkePreiseVor(k: FinanzenKontext, n: NutzlastEingabe<'preise_nachladen'>): Promise<string> {
  return k.auftraege.ergaenzeListenAuftrag('preise_nachladen', n, {
    schluessel: `preise_nachladen:${n.user_id}:${n.waehrung}`,
    liste: 'posten',
    hoechstens: PREISPOSTEN_HOECHSTENS,
    userId: n.user_id,
  });
}

type Posten = Nutzlast<'preise_nachladen'>['posten'][number];

async function holeEinen(k: FinanzenKontext, p: Posten, uid: number, waehrung: string, ttl: string): Promise<void> {
  if (p.art === 'set') await fetchPrice(k, p.nummer, p.zustand, 'sold', waehrung, ttl);
  else if (p.art === 'teil') await fetchPartPrice(k, p.nummer, p.farbe, p.zustand, waehrung, ttl);
  else if (p.art === 'figur') await fetchMinifigPrice(k, p.nummer, p.zustand, waehrung, ttl);
  else await schaetzeFigurenpreis(k, p.nummer, uid, p.zustand);
}

/** Ist das Tageskontingent erschöpft, wartet der Rest bis morgen; ein einzelner Fehlschlag hält die Liste nicht an. */
async function preiseNachladen(
  kx: FinanzenKontext,
  n: Nutzlast<'preise_nachladen'>,
  k: AuftragsKontext,
): Promise<void> {
  const ttl = (await kx.einstellungen.globalerWert('price_cache_ttl', '24')) || '24';
  for (const [i, p] of n.posten.entries()) {
    pruefeAbbruch(k);
    if (!(await kx.fremdquellen.kontingentFrei('bricklink')).allowed)
      throw new AuftragVerschieben(new Date(kx.uhr.jetzt() + 6 * 3600_000), 'BrickLink-Tageskontingent erschöpft');
    await holeEinen(kx, p, n.user_id, n.waehrung, ttl).catch((e: unknown) =>
      meldeFehler(`preise-nachladen:${p.art} ${p.nummer}`, e),
    );
    if (i % 10 === 9) await k.fortschritt({ erledigt: i + 1, gesamt: n.posten.length });
  }
}

export { preiseNachladen };
