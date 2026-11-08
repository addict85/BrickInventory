/** Preise, die eine Bewertung im Cache nicht fand (src/finanzen/rechnung/bewertung.ts):
 * hier im Job-Prozess geholt, mit Kontingent und Abbruch, nicht in der Anfrage. */
import { fetchPrice, fetchPartPrice, fetchMinifigPrice } from '../src/finanzen/rechnung/preise';
import { schaetzeFigurenpreis } from '../src/finanzen/marketPrice';
import { kontingentFrei } from '../src/katalog/apiKontingent';
import { getGlobalSetting } from '../src/einstellungen/settings';
import { pruefeAbbruch } from '../src/auftraege/auftraege';
import { meldeFehler } from '../src/infra/fehler';
import { AuftragVerschieben, type AuftragsKontext } from './auftragsWorker';
import type { Nutzlast } from '../src/auftraege/nutzlasten';

type Posten = Nutzlast<'preise_nachladen'>['posten'][number];

async function holeEinen(p: Posten, uid: number, waehrung: string, ttl: string): Promise<void> {
  if (p.art === 'set') await fetchPrice(p.nummer, p.zustand, 'sold', waehrung, ttl);
  else if (p.art === 'teil') await fetchPartPrice(p.nummer, p.farbe, p.zustand, waehrung, ttl);
  else if (p.art === 'figur') await fetchMinifigPrice(p.nummer, p.zustand, waehrung, ttl);
  else await schaetzeFigurenpreis(p.nummer, uid, p.zustand);
}

/** Ist das Tageskontingent erschöpft, wartet der Rest bis morgen; ein einzelner Fehlschlag hält die Liste nicht an. */
async function preiseNachladen(n: Nutzlast<'preise_nachladen'>, k: AuftragsKontext): Promise<void> {
  const ttl = (await getGlobalSetting('price_cache_ttl', '24')) || '24';
  for (const [i, p] of n.posten.entries()) {
    pruefeAbbruch(k);
    if (!(await kontingentFrei('bricklink')).allowed)
      throw new AuftragVerschieben(new Date(Date.now() + 6 * 3600_000), 'BrickLink-Tageskontingent erschöpft');
    await holeEinen(p, n.user_id, n.waehrung, ttl).catch((e: unknown) =>
      meldeFehler(`preise-nachladen:${p.art} ${p.nummer}`, e),
    );
    if (i % 10 === 9) await k.fortschritt({ erledigt: i + 1, gesamt: n.posten.length });
  }
}

export { preiseNachladen };
