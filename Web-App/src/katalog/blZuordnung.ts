// BrickLink-Nummern stehen nur in bl_mapping.

import type { BlArt } from '../../db/blZuordnungSql';
import { writeBlNumbers } from './repository/blZuordnung';
import type { CatalogContext } from './kontext';

/** Die Art wird in SQL-Schnipsel EINGESETZT (dort lässt sich kein Wert binden);
 * der Typ verhindert, dass dort je etwas anderes landet. */
export type { BlArt };
/** In db/, damit Repositories sie einsetzen können. */

/** Nur für geprüfte Quellen (Rebrickable, BrickLink); gleiche Nummer heisst
 * „keine abweichende". Was ein Konto einträgt, geht an rememberOwnBlNumber. */
export function rememberBlNumber(k: CatalogContext, art: BlArt, rbId: string, blId: string): Promise<void> {
  return k.blZuordnung.writeBlNumber(art, rbId, blId);
}

/** Gilt nur für dieses Konto, in allen Lesewegen vor der gemeinsamen Zuordnung. */
export function rememberOwnBlNumber(
  k: CatalogContext,
  uid: number,
  art: BlArt,
  rbId: string,
  blId: string,
): Promise<void> {
  return k.blZuordnung.writeBlNumberOwn(uid, art, rbId, blId || rbId);
}

const konten = (k: number | number[] | null | undefined): number[] => (k == null ? [] : Array.isArray(k) ? k : [k]);

/** Je Nummer die letzte Angabe. */
export async function rememberBlNumbers(
  k: CatalogContext,
  art: BlArt,
  pairs: { rbId: string; blId: string }[],
  dbh?: { run: (sql: string, p?: unknown[]) => Promise<unknown> },
) {
  const eindeutig = [...new Map(pairs.filter(p => p.rbId && p.blId).map(p => [p.rbId, p])).values()];
  if (!eindeutig.length) return;
  await writeBlNumbers(
    dbh ?? k.db,
    art,
    eindeutig.map(p => p.rbId),
    eindeutig.map(p => p.blId),
  );
}

/** Damit dasselbe Teil nicht immer wieder abgefragt wird; eine gefundene
 * Zuordnung bleibt stehen. */
export function merkeBlNummerUnveraendert(k: CatalogContext, art: BlArt, rbId: string): Promise<void> {
  return k.blZuordnung.noteLookedUp(art, rbId);
}

/** null für „keine abweichende bekannt" — ohne Zeile und Zeile ohne Wert
 * zusammen. Wer beides trennen muss, fragt blFetchNumber. */
export function blNumberOf(
  k: CatalogContext,
  art: BlArt,
  rbId: string,
  konto?: number | number[] | null,
): Promise<string | null> {
  return k.blZuordnung.differingNumber(art, rbId, konten(konto));
}

/** null nur, wenn noch nie nachgesehen wurde: Das Vorladen der Preise merkt
 * sich keine Fehlschläge und braucht diesen Unterschied. */
export function blFetchNumber(
  k: CatalogContext,
  art: BlArt,
  rbId: string,
  konto?: number | number[] | null,
): Promise<string | null> {
  return k.blZuordnung.effectiveNumber(art, rbId, konten(konto));
}

// Eine Abfrage für viele Nummern; jede Zeile kommt zurück, damit nichts zweimal gefragt wird.
export async function blFetchNumbers(
  k: CatalogContext,
  art: BlArt,
  rbIds: string[],
  konto?: number | number[] | null,
): Promise<Map<string, string>> {
  const raus = new Map<string, string>();
  if (!rbIds.length) return raus;
  const zeilen = await k.blZuordnung.effectiveNumbers(art, rbIds, konten(konto));
  for (const z of zeilen) raus.set(String(z.rb_id), String(z.nr));
  return raus;
}

export function merkeBlFarbnummer(k: CatalogContext, colorId: number, blColorId: number): Promise<void> {
  return k.blZuordnung.writeBlColorNumber(colorId, blColorId);
}

/** Rebrickable liefert `ext_ids` als Liste oder die Liste direkt. */
type ExterneNumbers = { external_ids?: { BrickLink?: { ext_ids?: number[] } & number[] } } | null | undefined;
export function blColorNumberFrom(farbe: ExterneNumbers): number | null {
  const id = farbe?.external_ids?.BrickLink?.ext_ids?.[0] ?? farbe?.external_ids?.BrickLink?.[0];
  return id ?? null;
}
