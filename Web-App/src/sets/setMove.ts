/** Verschoben wird über die Erfassungen: Die Menge beider Konten folgt daraus beim Lesen. */
import { fachfehler } from '../infra/errorTexts';
import { withVersion } from '../infra/setNumber';
import * as repo from './repository/move';
import type { SetsContext } from './context';

export interface Shift {
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
async function copyContents(t: SetsContext, sn: string, fromId: number, toId: number) {
  const n = { parts: 0, minifigs: 0, instructions: 0 };
  for (const tab of ['parts', 'minifigs'] as const)
    n[tab] = await t.inventory.setInhalt.kopieren(tab, sn, fromId, toId);
  if (!(await repo.hatInstructions(t.db, toId, sn)))
    n.instructions = await repo.copyInstructions(t.db, sn, fromId, toId);
  return n;
}

/** In der Transaktion des Aufrufers (`t`), unter der Sperre des Quellbestands.
 * @param acquisitionIds leer = das ganze Set; sonst nur diese Kaufpreis-Zeilen */
export async function setEntriesReassign(
  t: SetsContext,
  sn: string,
  fromId: number,
  toId: number,
  acquisitionIds?: number[],
): Promise<Shift> {
  const src = await repo.setRow(t.db, fromId, sn);
  if (!src) fachfehler('nicht_gefunden', 'nicht_gefunden');

  const all = await repo.moveEntriesTo(t.db, fromId, sn);
  const wanted = acquisitionIds?.length ? all.filter(a => acquisitionIds.includes(parseInt(String(a.id), 10))) : all;
  if (!wanted.length) fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');

  const totalQty = all.reduce((s, a) => s + (a.quantity || 1), 0);
  const movingQty = wanted.reduce((s, a) => s + (a.quantity || 1), 0);
  const remaining = Math.max(0, totalQty - movingQty);

  // Stammdaten beschreiben das Set, nicht das Exemplar: Liegt es beim Ziel
  // schon, genügt das Umhängen der Erfassungen.
  const dst = await repo.setRow(t.db, toId, sn);
  if (!dst) await t.inventory.putSetAn(toId, sn, src.added_at);

  for (const a of wanted) {
    await t.inventory.bookDailyEntry('set', toId, [sn], {
      quantity: a.quantity,
      price: a.purchase_price,
      condition: a.condition,
      createdAt: a.created_at,
      geschaetzt: a.price_estimated,
      currency: a.currency,
    });
    await t.inventory.erfassung.loesche('set', a.id, fromId);
  }

  const counts = await copyContents(t, sn, fromId, toId);

  // Teilverschiebung: Der Absender behält Exemplare und damit Set und Inhalt.
  if (remaining > 0) {
    return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: false };
  }
  await repo.removeInstructions(t.db, fromId, sn);
  await t.inventory.setInhalt.entfernen([fromId], sn);
  return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: true };
}

/** Konto als Kennung aus der Eingabe; schreibziel() prüft es. */
type AccountWish = string | number | null | undefined;

/** Der Einstieg: Drei Erfassungen sind drei Käufe, wer alles will, wählt alle Zeilen. Unter der
 * Sperre des Quellbestands, damit kein zweiter Weg dazwischen bucht. */
export async function moveSet(
  sk: SetsContext,
  uid: number,
  roh: string,
  von: AccountWish,
  nach: AccountWish,
  erfassungen: number[],
) {
  if (!erfassungen.length) fachfehler('ungueltig', 'kaufpreise_angeben');
  const sn = withVersion(roh);
  const fromId = await sk.household.schreibziel(uid, von ?? uid);
  const toId = await sk.household.schreibziel(uid, nach);
  if (fromId === toId) fachfehler('ungueltig', 'quelle_ziel_identisch');
  // Zwei Verschiebungen in Gegenrichtung sperren die Zeilen beider Konten in umgekehrter Reihenfolge.
  const r = await sk.transaktion(t => setEntriesReassign(t, sn, fromId, toId, erfassungen), {
    sperren: [{ konto: fromId, schluessel: sn }],
    repeatAtConflict: true,
  });
  return { set_number: sn, from_user_id: fromId, to_user_id: toId, ...r };
}
