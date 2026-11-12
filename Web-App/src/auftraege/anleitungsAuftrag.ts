import { mitVersion } from '../infra/setNummer';
import { zaehleArt, stelleAuftragEin, zieheVor } from './dienst';

/** Ein Set steht höchstens einmal offen. @returns die Kennung, oder null, wenn es schon offen steht */
export async function anleitungEinreihen(
  setNumber: string,
  o: { nurAusweichquelle?: boolean; jetzt?: boolean } = {},
): Promise<string | null> {
  const n = mitVersion(setNumber);
  if (o.jetzt) await zieheVor('anleitung', `anleitung:${n}`);
  return stelleAuftragEin(
    'anleitung',
    { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxVersuche: 3 },
  );
}

export async function offeneAnleitungen(): Promise<number> {
  const z = await zaehleArt('anleitung');
  return z.offen + z.laeuft;
}
