import { withVersion } from '../infra/setNumber';
import type { CatalogContext } from './context';

/** A set is open at most once. @returns the identifier, or null if it is already open */
export async function enqueueInstruction(
  k: CatalogContext,
  setNumber: string,
  o: { nurAusweichquelle?: boolean; jetzt?: boolean } = {},
): Promise<string | null> {
  const n = withVersion(setNumber);
  if (o.jetzt) await k.jobQueue.wiedervorlage.now('anleitung', `anleitung:${n}`);
  return k.jobQueue.placeJobOne(
    'anleitung',
    { set_number: n, ...(o.nurAusweichquelle ? { nur_ausweichquelle: true } : {}) },
    { schluessel: `anleitung:${n}`, maxAttempts: 3 },
  );
}
