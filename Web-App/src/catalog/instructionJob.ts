import { withVersion } from '../infra/setNumber';
import type { CatalogContext } from './context';

/** A set is open at most once. @returns the identifier, or null if it is already open */
export async function enqueueInstruction(
  k: CatalogContext,
  setNumber: string,
  o: { fallbackOnly?: boolean; now?: boolean } = {},
): Promise<string | null> {
  const n = withVersion(setNumber);
  if (o.now) await k.jobQueue.resubmission.now('instructions', `instructions:${n}`);
  return k.jobQueue.placeJobOne(
    'instructions',
    { set_number: n, ...(o.fallbackOnly ? { nur_ausweichquelle: true } : {}) },
    { key: `instructions:${n}`, maxAttempts: 3 },
  );
}
