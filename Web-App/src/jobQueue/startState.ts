import { logAndContinue, reportError } from '../infra/error';
import type { JobsContext } from './context';

/** Den Katalog lädt der Job-Prozess; der Web-Prozess liest den Stand aus
 * laufzustand nach. */
export interface StartState {
  ready: boolean;
  step: string;
  progress: number;
  total: number;
  sub?: string | null;
}

/** Je Satz Dienste: Der Job-Prozess schreibt, der Web-Prozess liest nach, bis bereit. */
const gemerkt = (k: JobsContext) =>
  k.faecher.fach<{ stand: StartState }>('startZustand', () => ({
    stand: { ready: false, step: 'Datenbank wird initialisiert...', progress: 0, total: 6 },
  }));

export async function reportStartState(k: JobsContext, s: StartState): Promise<void> {
  gemerkt(k).stand = s;
  await k.laufzustand
    .setzeZustand('startup_status', JSON.stringify(s))
    .catch(logAndContinue('start:zustand schreiben'));
}

/** Gekürzt; Schritt und Unterstand nur angemeldet, sonst sieht jeder, woran der Start hängt. */
export function publicStartState(
  s: StartState,
  angemeldet = false,
): Omit<StartState, 'step'> & { step: string | null } {
  return {
    ready: s.ready === true,
    step: angemeldet ? String(s.step ?? '').slice(0, 80) : null,
    progress: Number(s.progress) || 0,
    total: Number(s.total) || 0,
    sub: angemeldet && typeof s.sub === 'string' ? s.sub.slice(0, 40) : null,
  };
}

/** Bereit bleibt bereit — darum endet das Nachlesen danach. */
export async function currentStartState(k: JobsContext): Promise<StartState> {
  const g = gemerkt(k);
  if (g.stand.ready) return g.stand;
  try {
    const roh = await k.laufzustand.liesZustand('startup_status');
    if (roh) g.stand = JSON.parse(roh) as StartState;
  } catch (e) {
    // Ausnahme: Der Gesundheitsweg zeigt dann den letzten bekannten Stand statt eines Fehlers.
    reportError('start:zustand lesen', e);
  }
  return g.stand;
}
