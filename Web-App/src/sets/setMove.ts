/** Verschoben wird über die Erfassungen: Die Menge beider Konten folgt daraus
 * beim Lesen, hier wird keine Menge geschrieben. */
import { fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/verschieben';
import type { SetsKontext } from './kontext';

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
async function copyContents(t: SetsKontext, sn: string, fromId: number, toId: number) {
  const n = { parts: 0, minifigs: 0, instructions: 0 };
  for (const tab of ['parts', 'minifigs', 'instructions'] as const)
    if (!(await repo.hatInhalt(t.db, tab, toId, sn)))
      n[tab] =
        tab === 'instructions'
          ? await repo.kopiereAnleitungen(t.db, sn, fromId, toId)
          : await t.bestand.kopiereSetInhalt(tab, sn, fromId, toId);
  return n;
}

/** In der Transaktion des Aufrufers (`t`), unter der Sperre des Quellbestands.
 * @param acquisitionIds leer = das ganze Set; sonst nur diese Kaufpreis-Zeilen */
export async function moveSetBetweenAccounts(
  t: SetsKontext,
  sn: string,
  fromId: number,
  toId: number,
  acquisitionIds?: number[],
): Promise<MoveResult> {
  const src = await repo.setZeile(t.db, fromId, sn);
  if (!src) fachfehler('nicht_gefunden', 'nicht_gefunden');

  const all = await repo.erfassungenZumVerschieben(t.db, fromId, sn);
  const wanted = acquisitionIds?.length ? all.filter(a => acquisitionIds.includes(parseInt(String(a.id), 10))) : all;
  if (!wanted.length) fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');

  const gesamtQty = all.reduce((s, a) => s + (a.quantity || 1), 0);
  const movingQty = wanted.reduce((s, a) => s + (a.quantity || 1), 0);
  const remaining = Math.max(0, gesamtQty - movingQty);

  // Stammdaten beschreiben das Set, nicht das Exemplar: Liegt es beim Ziel
  // schon, genügt das Umhängen der Erfassungen.
  const dst = await repo.setZeile(t.db, toId, sn);
  if (!dst) await repo.legeSetAn(t.db, toId, sn, src.added_at);

  for (const a of wanted) {
    await t.bestand.recordAcquisitionForDay('set', toId, [sn], {
      quantity: a.quantity,
      price: a.purchase_price,
      condition: a.condition,
      createdAt: a.created_at,
      geschaetzt: a.price_estimated,
      currency: a.currency,
    });
    await repo.loescheSetErfassung(t.db, a.id, [fromId]);
  }

  const counts = await copyContents(t, sn, fromId, toId);

  // Teilverschiebung: Der Absender behält Exemplare und damit Set und Inhalt.
  if (remaining > 0) {
    return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: false };
  }
  await repo.entferneSet(t.db, fromId, sn);
  return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: true };
}

/** Über den KAUFPREIS, nicht über den Eintrag; was beim Absender bleibt, folgt
 * aus seinen Erfassungen. */
export async function moveManualAcquisition(
  t: SetsKontext,
  kind: 'part' | 'fig',
  keyValues: (string | number)[],
  acquisitionId: number,
  fromId: number,
  toId: number,
): Promise<{ quantity: number; merged: boolean; source_emptied: boolean }> {
  const acq = await repo.manuelleErfassung(t.db, kind, acquisitionId, fromId, keyValues);
  if (!acq) fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');

  const src = await repo.manuelleZeile(t.db, kind, fromId, keyValues);
  if (!src) fachfehler('nicht_gefunden', 'nicht_gefunden');

  const movingQty = Math.max(1, parseInt(String(acq.quantity), 10) || 1);
  const remaining = Math.max(0, (await repo.erfassteMenge(t.db, kind, fromId, keyValues)) - movingQty);

  const dst = await repo.manuelleZeile(t.db, kind, toId, keyValues);
  if (!dst) await t.bestand.legeManuellAn(kind, toId, keyValues);

  await t.bestand.recordAcquisitionForDay(kind, toId, keyValues, {
    quantity: movingQty,
    price: acq.unit_price,
    condition: acq.condition,
    createdAt: acq.created_at,
    geschaetzt: acq.price_estimated,
    currency: acq.currency,
  });
  await repo.loescheManuelleErfassung(t.db, kind, acq.id, [fromId]);

  if (remaining > 0) return { quantity: movingQty, merged: !!dst, source_emptied: false };
  await repo.entferneManuell(t.db, kind, fromId, keyValues, src.id);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}

/** Unter der Sperre des Quellbestands, damit kein zweiter Weg dazwischen bucht. */
export function verschiebeSet(
  sk: SetsKontext,
  sn: string,
  fromId: number,
  toId: number,
  erfassungen: number[],
): Promise<MoveResult> {
  // Zwei Verschiebungen in Gegenrichtung sperren die Zeilen beider Konten in umgekehrter Reihenfolge.
  return sk.transaktion(t => moveSetBetweenAccounts(t, sn, fromId, toId, erfassungen), {
    sperren: [{ konto: fromId, schluessel: sn }],
    wiederholeBeiKonflikt: true,
  });
}
