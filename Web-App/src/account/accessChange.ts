import { ereignis } from '../infra/event';
import { prozessweit } from '../infra/prozessweit';
/** Open streams check their access on each tick; if an access ends in this
 * process (revocation, logout, new session version, foreign revocation via
 * NOTIFY), they should notice immediately and not only at the next tick. */
const zugangsAenderung = prozessweit('zugangsHoerer', () => ereignis('zugangsAenderung'));

export function atAccessChange(f: () => unknown): () => void {
  return zugangsAenderung.horche(f);
}

export function reportAccessChange(): void {
  void zugangsAenderung.melde();
}
