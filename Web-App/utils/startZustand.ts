import { liesZustand, setzeZustand } from './laufzustand';
import { logAndContinue, meldeUndWeiter } from './httpError';

/**
 * Wie weit der Start ist — für /api/v1/startup-status und /api/v1/health.
 * Den Katalog lädt der Job-Prozess; er schreibt den Stand nach laufzustand
 * ('startup_status'), und der Web-Prozess liest ihn dort bei Bedarf nach.
 */
export interface StartZustand { ready: boolean; step: string; progress: number; total: number; sub?: string | null }

let _stand: StartZustand = { ready: false, step: 'Datenbank wird initialisiert...', progress: 0, total: 6 };

export function startZustand(): StartZustand { return _stand; }

/** Nur in diesem Prozess. */
export function setzeStartZustand(s: StartZustand): void { _stand = s; }

/** Setzen und für den anderen Prozess in laufzustand schreiben. */
export async function meldeStartZustand(s: StartZustand): Promise<void> {
  _stand = s;
  await setzeZustand('startup_status', JSON.stringify(s)).catch(logAndContinue('start:zustand schreiben'));
}

/**
 * Der Stand aus Sicht dieses Prozesses: Ist er hier noch nicht bereit, gilt
 * der gespeicherte. Bereit bleibt bereit — darum endet das Nachlesen danach.
 */
export async function aktuellerStartZustand(): Promise<StartZustand> {
  if (_stand.ready) return _stand;
  try {
    const roh = await liesZustand('startup_status');
    if (roh) _stand = JSON.parse(roh) as StartZustand;
  } catch (e) { meldeUndWeiter('start:zustand lesen', e); }
  return _stand;
}
