import { withVersion } from '../infra/setNummer';
import type { CatalogContext } from './kontext';

/** Ein Set steht höchstens einmal offen. @returns die Kennung, oder null, wenn es schon offen steht */
export async function anleitungEinreihen(
  k: CatalogContext,
  setNumber: string,
  o: { nurAusweichquelle?: boolean; jetzt?: boolean } = {},
): Promise<string | null> {
  const n = withVersion(setNumber);
  if (o.jetzt) await k.auftraege.wiedervorlage.jetzt('anleitung', `anleitung:${n}`);
  return k.auftraege.placeJobOne(
    'anleitung',
    { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxAttempts: 3 },
  );
}
