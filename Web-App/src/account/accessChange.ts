import { ereignis } from '../infra/event';
import { prozessweit } from '../infra/prozessweit';
/** Offene Ströme prüfen ihren Zugang im Takt; endet ein Zugang in diesem
 * Prozess (Widerruf, Abmelden, neue Sitzungsversion, fremder Widerruf per
 * NOTIFY), sollen sie es sofort merken und nicht erst beim nächsten Takt. */
const zugangsAenderung = prozessweit('zugangsHoerer', () => ereignis('zugangsAenderung'));

export function atAccessChange(f: () => unknown): () => void {
  return zugangsAenderung.horche(f);
}

export function reportAccessChange(): void {
  void zugangsAenderung.melde();
}
