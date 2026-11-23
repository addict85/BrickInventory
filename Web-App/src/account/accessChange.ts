import { event } from '../infra/event';
import { processWide } from '../infra/processWide';
/** Open streams check their access on each tick; if an access ends in this
 * process (revocation, logout, new session version, foreign revocation via
 * NOTIFY), they should notice immediately and not only at the next tick. */
const accessChange = processWide('accessListeners', () => event('zugangsAenderung'));

export function atAccessChange(f: () => unknown): () => void {
  return accessChange.listen(f);
}

export function reportAccessChange(): void {
  void accessChange.report();
}
