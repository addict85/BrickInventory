/** Einzelne Schritte statt eines Laufs: Ein scheiternder Schritt hält die übrigen nicht auf. */
import { tokensAufraeumen } from './geraeteToken';
import { meldeAusstehendeAdressen, meldeUngueltigeAdressen, raeumeOffeneRegistrierungenAuf } from './konten';
import { raeumeAnmeldezaehlerAuf } from './loginLimiter';
import { fuehreFaelligeUebernahmenAus } from './verwalterAktionen';
import type { KontoKontext } from './kontext';

type Schritt = [name: string, lauf: () => Promise<unknown>];

export function aufraeumSchritte(k: KontoKontext, takt: 'stuendlich' | 'taeglich'): Schritt[] {
  if (takt === 'stuendlich')
    return [
      ['abgelaufene Tokens', () => tokensAufraeumen(k)],
      ['Anmeldezähler', () => raeumeAnmeldezaehlerAuf(k)],
      ['Verwalterübernahmen', () => fuehreFaelligeUebernahmenAus(k)],
    ];
  return [
    ['unbestätigte Registrierungen', () => raeumeOffeneRegistrierungenAuf(k)],
    ['Verwaltungsprotokoll', () => k.protokoll.raeumeProtokollAuf()],
  ];
}

/** Nur Hinweise ins Protokoll: Welche Adresse gemeint war, weiss nur der Inhaber. */
export function adressHinweise(k: KontoKontext): Schritt[] {
  return [
    ['start:adressen', () => meldeUngueltigeAdressen(k)],
    ['start:ausstehende-adressen', () => meldeAusstehendeAdressen(k)],
  ];
}
