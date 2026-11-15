/** Die Aufträge der Finanzen: Wechselkurse, der volle Preislauf und Preise, die eine Bewertung nicht fand. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { PreiseNachladen } from './preiseNachladen';
import type { FinanzenDienste } from './bereich';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    wechselkurse: typeof LEER;
    preise: typeof LEER;
  }
}

export function finanzenAuftragsarten(d: FinanzenDienste): Anmeldung[] {
  return [
    auftragsart({ art: 'wechselkurse', nutzlast: LEER, ausfuehren: (_n, k) => d.kursauftrag(undefined, k) }),
    auftragsart({
      art: 'preise',
      nutzlast: LEER,
      ausfuehren: (_n, k) => d.preislauf(k),
      exklusiv: true,
      kontouebergreifend: 'Preise aller Sets',
      zeitplan: { minuten: { einstellung: 'price_job_interval_minutes', vorgabe: 60, mindestens: 5 } },
    }),
    auftragsart({
      art: 'preise_nachladen',
      nutzlast: PreiseNachladen,
      ausfuehren: (n, k) => d.preiseNachladen(n, k),
      exklusiv: true,
    }),
  ];
}
