import { mitVersion } from '../infra/setNummer';
import type { KatalogKontext } from './kontext';

/** Ein Set steht höchstens einmal offen. @returns die Kennung, oder null, wenn es schon offen steht */
export async function anleitungEinreihen(
  k: KatalogKontext,
  setNumber: string,
  o: { nurAusweichquelle?: boolean; jetzt?: boolean } = {},
): Promise<string | null> {
  const n = mitVersion(setNumber);
  if (o.jetzt) await k.auftraege.wiedervorlage.jetzt('anleitung', `anleitung:${n}`);
  return k.auftraege.stelleAuftragEin(
    'anleitung',
    { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxVersuche: 3 },
  );
}
