/**
 * Was bei BrickLink wie heisst — die Zuordnung, an einer Stelle.
 * Ausführlich: docs/begruendungen/src/katalog/blZuordnung.ts.md#abschnitt
 */
import { meldeUndLiefere } from '../infra/httpError';
import * as repo from './repository/blZuordnung';
import type { BlArt } from '../../db/blZuordnungSql';

/**
 * Die Art wird in SQL-Schnipseln EINGESETZT (ein Wert lässt sich dort nicht
 * binden); der Typ verhindert, dass dort je etwas anderes landet.
 * Ausführlich: docs/begruendungen/src/katalog/blZuordnung.ts.md#blart
 */
export type { BlArt };
/** Die Schnipsel stehen in db/, damit Repositories sie einsetzen können. */
export { blJoin, blNummerSql } from '../../db/blZuordnungSql';

/** Zu dieser Rebrickable-Nummer gehört jene BrickLink-Nummer (gleiche Nummer: „keine abweichende"). */
export function merkeBlNummer(art: BlArt, rbId: string, blId: string): Promise<void> {
  return repo.schreibeBlNummer(art, rbId, blId);
}

/** merkeBlNummer() für viele Nummern in einer Anweisung (Teile-Import eines Sets); je Nummer die letzte Angabe. */
export async function merkeBlNummern(art: BlArt, paare: { rbId: string; blId: string }[],
                                     dbh?: { run: (sql: string, p?: unknown[]) => Promise<unknown> }) {
  const eindeutig = [...new Map(paare.filter(p => p.rbId && p.blId).map(p => [p.rbId, p])).values()];
  if (!eindeutig.length) return;
  await repo.schreibeBlNummern(art, eindeutig.map(p => p.rbId), eindeutig.map(p => p.blId), dbh);
}

/**
 * Nur „nachgesehen" notieren, damit dasselbe Teil nicht immer wieder
 * abgefragt wird — eine gefundene Zuordnung bleibt stehen.
 * Ausführlich: docs/begruendungen/src/katalog/blZuordnung.ts.md#merkeblnummerunveraendert
 */
export function merkeBlNummerUnveraendert(art: BlArt, rbId: string): Promise<void> {
  return repo.notiereNachgesehen(art, rbId);
}

/**
 * Die BrickLink-Nummer, oder null für „keine abweichende bekannt" — ohne
 * Zeile und Zeile ohne Wert zusammen. Wer beides trennen muss, fragt blAbrufNummer.
 */
export function blNummerVon(art: BlArt, rbId: string): Promise<string | null> {
  return repo.abweichendeNummer(art, rbId).catch(meldeUndLiefere('bl-zuordnung:nummer lesen', null));
}

/**
 * Die Nummer, mit der BrickLink zu fragen ist; null nur, wenn noch nie
 * nachgesehen wurde. Das Vorladen der Preise merkt sich keine Fehlschläge und
 * braucht deshalb diesen Unterschied.
 * Ausführlich: docs/begruendungen/src/katalog/blZuordnung.ts.md#abschnitt-2
 */
export function blAbrufNummer(art: BlArt, rbId: string): Promise<string | null> {
  return repo.wirksameNummer(art, rbId).catch(meldeUndLiefere('bl-zuordnung:abrufnummer lesen', null));
}

/**
 * Dasselbe für viele Nummern, in EINER Abfrage.
 * Ausführlich: docs/begruendungen/src/katalog/blZuordnung.ts.md#blabrufnummern
 */
export async function blAbrufNummern(art: BlArt, rbIds: string[]): Promise<Map<string, string>> {
  const raus = new Map<string, string>();
  if (!rbIds.length) return raus;
  const zeilen = await repo.wirksameNummern(art, rbIds).catch(meldeUndLiefere('bl-zuordnung:zeilen', []));
  for (const z of zeilen) raus.set(String(z.rb_id), String(z.nr));
  return raus;
}

/** Zu dieser Rebrickable-Farbe gehört jene BrickLink-Farbnummer. */
export function merkeBlFarbnummer(colorId: number, blColorId: number): Promise<void> {
  return repo.schreibeBlFarbnummer(colorId, blColorId);
}

/** Rebrickable liefert `ext_ids` als Liste oder die Liste direkt. */
export function blFarbnummerAus(farbe: any): number | null {
  const id = farbe?.external_ids?.BrickLink?.ext_ids?.[0] ?? farbe?.external_ids?.BrickLink?.[0];
  return id ?? null;
}
