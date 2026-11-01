import { liesZustand, setzeZustand } from '../auftraege/laufzustand';
import { logAndContinue, meldeUndWeiter } from './httpError';

/** Den Katalog lädt der Job-Prozess; der Web-Prozess liest den Stand aus
 * laufzustand nach. */
export interface StartZustand { ready: boolean; step: string; progress: number; total: number; sub?: string | null }

let _stand: StartZustand = { ready: false, step: 'Datenbank wird initialisiert...', progress: 0, total: 6 };

export function startZustand(): StartZustand { return _stand; }

export function setzeStartZustand(s: StartZustand): void { _stand = s; }

export async function meldeStartZustand(s: StartZustand): Promise<void> {
  _stand = s;
  await setzeZustand('startup_status', JSON.stringify(s)).catch(logAndContinue('start:zustand schreiben'));
}

/** Bereit bleibt bereit — darum endet das Nachlesen danach. */
export async function aktuellerStartZustand(): Promise<StartZustand> {
  if (_stand.ready) return _stand;
  try {
    const roh = await liesZustand('startup_status');
    if (roh) _stand = JSON.parse(roh) as StartZustand;
  } catch (e) { meldeUndWeiter('start:zustand lesen', e); }
  return _stand;
}
