import { mitVersion } from '../infra/setNummer';
import { zaehleArt, stelleAuftragEin } from './dienst';

/** Ein Set steht höchstens einmal offen. */
export async function anleitungEinreihen(setNumber: string, o: { nurAusweichquelle?: boolean } = {}): Promise<void> {
  const n = mitVersion(setNumber);
  await stelleAuftragEin('anleitung', { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxVersuche: 3 });
}

export async function offeneAnleitungen(): Promise<number> {
  const z = await zaehleArt('anleitung');
  return z.offen + z.laeuft;
}
