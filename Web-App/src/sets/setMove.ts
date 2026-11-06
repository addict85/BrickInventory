/** Verschoben wird über die Erfassungen: Die Menge beider Konten folgt daraus
 * beim Lesen, hier wird keine Menge geschrieben.
 * Ausführlich: docs/begruendungen/src/sets/setMove.ts.md#abschnitt */
import type { DbSchnittstelle } from '../../db/database';
import { withInventoryLock } from '../../db/txLock';
import { recordAcquisitionForDay } from '../bestand/acquisitions';
import { fehlerWerfen } from '../infra/fehlerTexte';
import * as repo from './repository/verschieben';

export interface MoveResult {
  quantity: number;
  acquisitions: number;
  merged: boolean;
  parts: number;
  minifigs: number;
  instructions: number;
  source_emptied: boolean;
}

/** Nacheinander statt Promise.all: alle Abfragen laufen auf derselben
 * Transaktionsverbindung. */
async function copyContents(tx: DbSchnittstelle, sn: string, fromId: number, toId: number) {
  const n = { parts: 0, minifigs: 0, instructions: 0 };
  for (const t of ['parts', 'minifigs', 'instructions'] as const)
    if (!await repo.hatInhalt(tx, t, toId, sn)) n[t] = await repo.kopiereInhalt(tx, t, sn, fromId, toId);
  return n;
}

/** @param acquisitionIds leer = das ganze Set; sonst nur diese Kaufpreis-Zeilen */
export async function moveSetBetweenAccounts(
  tx: DbSchnittstelle, sn: string, fromId: number, toId: number, acquisitionIds?: number[]
): Promise<MoveResult> {
  const src = await repo.setZeile(tx, fromId, sn);
  if (!src) fehlerWerfen('nicht_gefunden', 404);

  const all = await repo.erfassungenZumVerschieben(tx, fromId, sn);
  const wanted = acquisitionIds?.length
    ? all.filter(a => acquisitionIds.includes(parseInt(String(a.id))))
    : all;
  if (!wanted.length) fehlerWerfen('kaufpreis_nicht_gefunden', 404);

  const gesamtQty = all.reduce((s, a) => s + (a.quantity || 1), 0);
  const movingQty = wanted.reduce((s, a) => s + (a.quantity || 1), 0);
  const remaining = Math.max(0, gesamtQty - movingQty);

  // Stammdaten beschreiben das Set, nicht das Exemplar: Liegt es beim Ziel
  // schon, genügt das Umhängen der Erfassungen.
  const dst = await repo.setZeile(tx, toId, sn);
  if (!dst) await repo.legeSetAn(tx, toId, sn, src.added_at);

  for (const a of wanted) {
    await recordAcquisitionForDay('set', toId, [sn], {
      quantity: a.quantity, price: a.purchase_price,
      condition: a.condition, createdAt: a.created_at,
      geschaetzt: a.price_estimated, currency: a.currency,
    }, tx);
    await repo.loescheSetErfassung(tx, a.id);
  }

  const counts = await copyContents(tx, sn, fromId, toId);

  // Teilverschiebung: Der Absender behält Exemplare und damit Set und Inhalt.
  if (remaining > 0) {
    return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst,
             ...counts, source_emptied: false };
  }
  await repo.entferneSet(tx, fromId, sn);
  return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst,
           ...counts, source_emptied: true };
}

/** Über den KAUFPREIS, nicht über den Eintrag; was beim Absender bleibt, folgt
 * aus seinen Erfassungen. */
export async function moveManualAcquisition(
  tx: DbSchnittstelle, kind: 'part' | 'fig', keyValues: (string | number)[], acquisitionId: number,
  fromId: number, toId: number
): Promise<{ quantity: number; merged: boolean; source_emptied: boolean }> {
  const acq = await repo.manuelleErfassung(tx, kind, acquisitionId, fromId);
  if (!acq) fehlerWerfen('kaufpreis_nicht_gefunden', 404);

  const src = await repo.manuelleZeile(tx, kind, fromId, keyValues);
  if (!src) fehlerWerfen('nicht_gefunden', 404);

  const movingQty = Math.max(1, parseInt(String(acq.quantity)) || 1);
  const remaining = Math.max(0, await repo.erfassteMenge(tx, kind, fromId, keyValues) - movingQty);

  const dst = await repo.manuelleZeile(tx, kind, toId, keyValues);
  if (!dst) await repo.legeManuellAn(tx, kind, toId, keyValues);

  await recordAcquisitionForDay(kind, toId, keyValues, {
    quantity: movingQty, price: acq.unit_price,
    condition: acq.condition, createdAt: acq.created_at,
    geschaetzt: acq.price_estimated, currency: acq.currency,
  }, tx);
  await repo.loescheManuelleErfassung(tx, kind, acq.id);

  if (remaining > 0) return { quantity: movingQty, merged: !!dst, source_emptied: false };
  await repo.entferneManuell(tx, kind, fromId, keyValues, src.id);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}

/** Unter der Sperre des Quellbestands, damit kein zweiter Weg dazwischen bucht. */
export function verschiebeSet(sn: string, fromId: number, toId: number, erfassungen: number[]): Promise<MoveResult> {
  return withInventoryLock(fromId, sn, (tx) => moveSetBetweenAccounts(tx, sn, fromId, toId, erfassungen));
}
