import { logAndContinue, reportError } from '../infra/error';
import type { JobsContext } from './context';

/** The job process loads the catalog; the web process re-reads the state from
 * laufzustand. */
export interface StartState {
  ready: boolean;
  step: string;
  progress: number;
  total: number;
  sub?: string | null;
}

/** Per set of services: the job process writes, the web process re-reads until ready. */
const remembered = (k: JobsContext) =>
  k.compartments.slot<{ state: StartState }>('startZustand', () => ({
    state: { ready: false, step: 'Datenbank wird initialisiert...', progress: 0, total: 6 },
  }));

export async function reportStartState(k: JobsContext, s: StartState): Promise<void> {
  remembered(k).state = s;
  await k.runState.setState('startup_status', JSON.stringify(s)).catch(logAndContinue('start:zustand schreiben'));
}

/** Shortened; step and sub-state only when logged in, otherwise everyone sees what startup is stuck on. */
export function publicStartState(s: StartState, signedIn = false): Omit<StartState, 'step'> & { step: string | null } {
  return {
    ready: s.ready === true,
    step: signedIn ? String(s.step ?? '').slice(0, 80) : null,
    progress: Number(s.progress) || 0,
    total: Number(s.total) || 0,
    sub: signedIn && typeof s.sub === 'string' ? s.sub.slice(0, 40) : null,
  };
}

/** Ready stays ready — that is why re-reading ends afterwards. */
export async function currentStartState(k: JobsContext): Promise<StartState> {
  const g = remembered(k);
  if (g.state.ready) return g.state;
  try {
    const raw = await k.runState.readState('startup_status');
    if (raw) g.state = JSON.parse(raw) as StartState;
  } catch (e) {
    // Exception: the health path then shows the last known state instead of an error.
    reportError('start:zustand lesen', e);
  }
  return g.state;
}
