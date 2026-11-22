/** Individual steps instead of one run: a failing step does not hold up the others. */
import { tokensCleanup } from './deviceToken';
import { reportPendingAddresses, reportInvalidAddresses, cleanOpenRegistrationsOn } from './accounts';
import { cleanLoginCounterOn } from './loginLimiter';
import { runDueTakeoversFrom } from './adminActions';
import type { AccountContext } from './context';

type Step = [name: string, lauf: () => Promise<unknown>];

export function onCleanupSteps(k: AccountContext, tick: 'stuendlich' | 'taeglich'): Step[] {
  if (tick === 'stuendlich')
    return [
      ['abgelaufene Tokens', () => tokensCleanup(k)],
      ['Anmeldezähler', () => cleanLoginCounterOn(k)],
      ['Verwalterübernahmen', () => runDueTakeoversFrom(k)],
    ];
  return [
    ['unbestätigte Registrierungen', () => cleanOpenRegistrationsOn(k)],
    ['Verwaltungsprotokoll', () => k.log.cleanLogOn()],
  ];
}

/** Only hints in the log: which address was meant is known only to the owner. */
export function addressHints(k: AccountContext): Step[] {
  return [
    ['start:adressen', () => reportInvalidAddresses(k)],
    ['start:ausstehende-adressen', () => reportPendingAddresses(k)],
  ];
}
