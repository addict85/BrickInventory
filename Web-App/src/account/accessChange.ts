import { event } from '../infra/event';
import { processWide } from '../infra/prozessweit';
/** Open streams check their access on each tick; if an access ends in this
 * process (revocation, logout, new session version, foreign revocation via
 * NOTIFY), they should notice immediately and not only at the next tick. */
const accessChange = processWide('zugangsHoerer', () => event('zugangsAenderung'));

export function atAccessChange(f: () => unknown): () => void {
  return accessChange.horche(f);
}

export function reportAccessChange(): void {
  void accessChange.melde();
}
