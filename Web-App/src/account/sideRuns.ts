/** Einzelne Schritte statt eines Laufs: Ein scheiternder Schritt hält die übrigen nicht auf. */
import { tokensCleanup } from './deviceToken';
import { reportPendingAddresses, reportInvalidAddresses, cleanOpenRegistrationsOn } from './accounts';
import { cleanLoginCounterOn } from './loginLimiter';
import { runDueTakeoversFrom } from './adminActions';
import type { AccountContext } from './context';

type Schritt = [name: string, lauf: () => Promise<unknown>];

export function onRaeumSteps(k: AccountContext, takt: 'stuendlich' | 'taeglich'): Schritt[] {
  if (takt === 'stuendlich')
    return [
      ['abgelaufene Tokens', () => tokensCleanup(k)],
      ['Anmeldezähler', () => cleanLoginCounterOn(k)],
      ['Verwalterübernahmen', () => runDueTakeoversFrom(k)],
    ];
  return [
    ['unbestätigte Registrierungen', () => cleanOpenRegistrationsOn(k)],
    ['Verwaltungsprotokoll', () => k.protokoll.cleanLogOn()],
  ];
}

/** Nur Hinweise ins Protokoll: Welche Adresse gemeint war, weiss nur der Inhaber. */
export function adressHints(k: AccountContext): Schritt[] {
  return [
    ['start:adressen', () => reportInvalidAddresses(k)],
    ['start:ausstehende-adressen', () => reportPendingAddresses(k)],
  ];
}
