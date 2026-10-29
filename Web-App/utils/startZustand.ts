import { setzeZustand } from './laufzustand';
import { logAndContinue } from './httpError';

/**
 * Wie weit der Start ist — für /api/v1/startup-status und /api/v1/health.
 * Ein Modul statt `global.startupStatus`: Der Stand hat einen Typ, und wer ihn
 * setzt, ist über den Import zu finden. Andere Worker lesen ihn aus
 * laufzustand ('startup_status'), wohin meldeStartZustand() ihn schreibt.
 */
export interface StartZustand { ready: boolean; step: string; progress: number; total: number; sub?: string | null }

let _stand: StartZustand = { ready: false, step: 'Datenbank wird initialisiert...', progress: 0, total: 6 };

export function startZustand(): StartZustand { return _stand; }

/** Nur in diesem Prozess, etwa mit dem Stand, den ein anderer Worker geschrieben hat. */
export function setzeStartZustand(s: StartZustand): void { _stand = s; }

/** Setzen und für die anderen Worker in laufzustand schreiben. */
export async function meldeStartZustand(s: StartZustand): Promise<void> {
  _stand = s;
  await setzeZustand('startup_status', JSON.stringify(s)).catch(logAndContinue('start:zustand schreiben'));
}
