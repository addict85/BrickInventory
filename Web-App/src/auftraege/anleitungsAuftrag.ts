import { mitVersion } from '../infra/setNummer';
import { zaehleArt, stelleAuftragEin, zieheVor } from './dienst';
import type { AuftraegeKontext } from './kontext';

/** Ein Set steht höchstens einmal offen. @returns die Kennung, oder null, wenn es schon offen steht */
export async function anleitungEinreihen(
  k: AuftraegeKontext,
  setNumber: string,
  o: { nurAusweichquelle?: boolean; jetzt?: boolean } = {},
): Promise<string | null> {
  const n = mitVersion(setNumber);
  if (o.jetzt) await zieheVor(k, 'anleitung', `anleitung:${n}`);
  return stelleAuftragEin(
    k,
    'anleitung',
    { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxVersuche: 3 },
  );
}

export async function offeneAnleitungen(k: AuftraegeKontext): Promise<number> {
  const z = await zaehleArt(k, 'anleitung');
  return z.offen + z.laeuft;
}
