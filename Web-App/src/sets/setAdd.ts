/** Die Regel „schon im Blickfeld? dann nicht aufstocken" steht im Server, damit
 * Webapp und App dieselbe Eingabe gleich behandeln. Ausführlich: docs/begruendungen/src/sets/setAdd.ts.md#abschnitt */
import { scopeIds } from '../haushalt/haushalt';
import { normalisiereSetNummer } from '../infra/setNummer';
import * as repo from './repository/sets';

// Dieselbe Regel wie beim Schreiben, sonst prüfte die Suche eine andere Nummer.
// Ausführlich: docs/begruendungen/src/sets/setAdd.ts.md#normalizesetnumber
export function normalizeSetNumber(input: string): string {
  return normalisiereSetNummer(input);
}

export interface VorhandenesSet {
  set_number: string;
  owner_user_id: number;
  /** Sonst gehört es einem anderen Konto im Haushalt. */
  is_self: boolean;
}

/** Im BLICKFELD, nicht nur im eigenen Konto. Ausführlich: docs/begruendungen/src/sets/setAdd.ts.md#findsetinscope */
export async function findSetInScope(
  viewerId: number, setNumber: string
): Promise<VorhandenesSet | null> {
  const sn  = normalizeSetNumber(setNumber);
  const ids = await scopeIds(viewerId);
  // Ohne Fang: Nach einem Lesefehler hiesse null „nicht im Blickfeld“, und ein zweites Exemplar entstünde.
  const row = await repo.setImBlickfeld(ids, sn, viewerId);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}
