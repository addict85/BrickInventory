/** Individual steps instead of one run: a failing step does not hold up the others. */
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

/** Only hints in the log: which address was meant is known only to the owner. */
export function adressHints(k: AccountContext): Schritt[] {
  return [
    ['start:adressen', () => reportInvalidAddresses(k)],
    ['start:ausstehende-adressen', () => reportPendingAddresses(k)],
  ];
}
