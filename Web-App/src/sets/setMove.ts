/** Verschoben wird über die Erfassungen: Die Menge beider Konten folgt daraus
 * beim Lesen, hier wird keine Menge geschrieben. */
import { fachfehler } from '../infra/fehlerTexte';
import { mitVersion } from '../infra/setNummer';
import * as repo from './repository/verschieben';
import type { SetsKontext } from './kontext';

export interface Verschiebung {
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
  for (const tab of ['parts', 'minifigs'] as const)
    if (!(await t.bestand.setZeilen.hatInhalt(tab, toId, sn)))
      n[tab] = await t.bestand.setInhalt.kopieren(tab, sn, fromId, toId);
  if (!(await repo.hatAnleitungen(t.db, toId, sn)))
    n.instructions = await repo.kopiereAnleitungen(t.db, sn, fromId, toId);
  return n;
}

/** In der Transaktion des Aufrufers (`t`), unter der Sperre des Quellbestands.
 * @param acquisitionIds leer = das ganze Set; sonst nur diese Kaufpreis-Zeilen */
export async function setErfassungenUmhaengen(
  t: SetsKontext,
  sn: string,
  fromId: number,
  toId: number,
  acquisitionIds?: number[],
): Promise<Verschiebung> {
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
  if (!dst) await t.bestand.setZeilen.legeAn(toId, sn, src.added_at);

  for (const a of wanted) {
    await t.bestand.bucheTageserfassung('set', toId, [sn], {
      quantity: a.quantity,
      price: a.purchase_price,
      condition: a.condition,
      createdAt: a.created_at,
      geschaetzt: a.price_estimated,
      currency: a.currency,
    });
    await t.bestand.setZeilen.loescheErfassung(a.id, [fromId]);
  }

  const counts = await copyContents(t, sn, fromId, toId);

  // Teilverschiebung: Der Absender behält Exemplare und damit Set und Inhalt.
  if (remaining > 0) {
    return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: false };
  }
  await repo.entferneAnleitungen(t.db, fromId, sn);
  await t.bestand.setZeilen.entferneVerschobenes(fromId, sn);
  return { quantity: movingQty, acquisitions: wanted.length, merged: !!dst, ...counts, source_emptied: true };
}

/** Konto als Kennung aus der Eingabe; schreibziel() prüft es. */
type KontoWunsch = string | number | null | undefined;

/** Der Einstieg: Drei Erfassungen sind drei Käufe, wer alles will, wählt alle Zeilen. Unter der
 * Sperre des Quellbestands, damit kein zweiter Weg dazwischen bucht. */
export async function setVerschieben(
  sk: SetsKontext,
  uid: number,
  roh: string,
  von: KontoWunsch,
  nach: KontoWunsch,
  erfassungen: number[],
) {
  if (!erfassungen.length) fachfehler('ungueltig', 'kaufpreise_angeben');
  const sn = mitVersion(roh);
  const fromId = await sk.haushalt.schreibziel(uid, von ?? uid);
  const toId = await sk.haushalt.schreibziel(uid, nach);
  if (fromId === toId) fachfehler('ungueltig', 'quelle_ziel_identisch');
  // Zwei Verschiebungen in Gegenrichtung sperren die Zeilen beider Konten in umgekehrter Reihenfolge.
  const r = await sk.transaktion(t => setErfassungenUmhaengen(t, sn, fromId, toId, erfassungen), {
    sperren: [{ konto: fromId, schluessel: sn }],
    wiederholeBeiKonflikt: true,
  });
  return { set_number: sn, from_user_id: fromId, to_user_id: toId, ...r };
}
