import { mitVersion } from '../sets/setNummer';
import { stelleAuftragEin, zaehleArt } from './auftraege';

/**
 * Der Anleitungsabruf je Set ist ein Auftrag der Art 'anleitung'
 * (jobs/instructionQueue.ts). Ein Set steht höchstens einmal offen.
 */
export async function anleitungEinreihen(setNumber: string, o: { nurAusweichquelle?: boolean } = {}): Promise<void> {
  const n = mitVersion(setNumber);
  await stelleAuftragEin('anleitung', { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxVersuche: 3 });
}

/** Wie viele Anleitungsabrufe noch warten oder laufen. */
export async function offeneAnleitungen(): Promise<number> {
  const z = await zaehleArt('anleitung');
  return z.offen + z.laeuft;
}
