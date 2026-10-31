/**
 *  Warum das hier steht und nicht in den Clients
 * Die App prüfte das selbst (ein `getSetDetail`-Aufruf vor
 * dem Anlegen), die Webapp gar nicht — sie schickte unbesehen ab, der Server
 * erhöhte die Menge und meldete „aktualisiert". Dieselbe Eingabe, zwei …
 * Ausführlich: docs/begruendungen/src/sets/setAdd.ts.md#abschnitt
 */
import { meldeUndLiefere } from '../infra/httpError';
import { scopeIds } from '../haushalt/haushalt';
import { normalisiereSetNummer } from './setNummer';
import * as repo from './repository/sets';

/**
 * Setnummer normalisieren — dieselbe Regel wie sanitizeSetNumber() in
 * routes/sets.ts, die addSet() vor dem Schreiben anwendet.
 * Ausführlich: docs/begruendungen/src/sets/setAdd.ts.md#normalizesetnumber
 */
export function normalizeSetNumber(input: string): string {
  return normalisiereSetNummer(input);
}

export interface VorhandenesSet {
  set_number: string;
  owner_user_id: number;
  /** true, wenn es dem fragenden Konto selbst gehört (sonst einem anderen im Haushalt). */
  is_self: boolean;
}

/**
 * Sucht das Set im BLICKFELD des Fragenden (eigenes Konto + Haushalt).
 * Ausführlich: docs/begruendungen/src/sets/setAdd.ts.md#findsetinscope
 * @returns die gefundene Zeile oder null
 */
export async function findSetInScope(
  viewerId: number, setNumber: string
): Promise<VorhandenesSet | null> {
  const sn  = normalizeSetNumber(setNumber);
  const ids = await scopeIds(viewerId);
  const row = await repo.setImBlickfeld(ids, sn, viewerId).catch(meldeUndLiefere('set-anlegen:row', null));
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}
