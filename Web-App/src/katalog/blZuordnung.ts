// BrickLink-Nummern stehen nur in bl_zuordnung.
import { meldeUndLiefere } from '../infra/fehler';
import * as repo from './repository/blZuordnung';
import type { BlArt } from '../../db/blZuordnungSql';

/** Die Art wird in SQL-Schnipsel EINGESETZT (dort lässt sich kein Wert binden);
 * der Typ verhindert, dass dort je etwas anderes landet. */
export type { BlArt };
/** In db/, damit Repositories sie einsetzen können. */

/** Nur für geprüfte Quellen (Rebrickable, BrickLink); gleiche Nummer heisst
 * „keine abweichende". Was ein Konto einträgt, geht an merkeEigeneBlNummer. */
export function merkeBlNummer(art: BlArt, rbId: string, blId: string): Promise<void> {
  return repo.schreibeBlNummer(art, rbId, blId);
}

/** Gilt nur für dieses Konto, in allen Lesewegen vor der gemeinsamen Zuordnung. */
export function merkeEigeneBlNummer(uid: number, art: BlArt, rbId: string, blId: string): Promise<void> {
  return repo.schreibeBlNummerEigen(uid, art, rbId, blId || rbId);
}

const konten = (k: number | number[] | null | undefined): number[] => k == null ? [] : Array.isArray(k) ? k : [k];

/** Je Nummer die letzte Angabe. */
export async function merkeBlNummern(art: BlArt, paare: { rbId: string; blId: string }[],
                                     dbh?: { run: (sql: string, p?: unknown[]) => Promise<unknown> }) {
  const eindeutig = [...new Map(paare.filter(p => p.rbId && p.blId).map(p => [p.rbId, p])).values()];
  if (!eindeutig.length) return;
  await repo.schreibeBlNummern(art, eindeutig.map(p => p.rbId), eindeutig.map(p => p.blId), dbh);
}

/** Damit dasselbe Teil nicht immer wieder abgefragt wird; eine gefundene
 * Zuordnung bleibt stehen. */
export function merkeBlNummerUnveraendert(art: BlArt, rbId: string): Promise<void> {
  return repo.notiereNachgesehen(art, rbId);
}

/** null für „keine abweichende bekannt" — ohne Zeile und Zeile ohne Wert
 * zusammen. Wer beides trennen muss, fragt blAbrufNummer. */
export function blNummerVon(art: BlArt, rbId: string, konto?: number | number[] | null): Promise<string | null> {
  return repo.abweichendeNummer(art, rbId, konten(konto)).catch(meldeUndLiefere('bl-zuordnung:nummer lesen', null));
}

/** null nur, wenn noch nie nachgesehen wurde: Das Vorladen der Preise merkt
 * sich keine Fehlschläge und braucht diesen Unterschied. */
export function blAbrufNummer(art: BlArt, rbId: string, konto?: number | number[] | null): Promise<string | null> {
  return repo.wirksameNummer(art, rbId, konten(konto)).catch(meldeUndLiefere('bl-zuordnung:abrufnummer lesen', null));
}

// Eine Abfrage für viele Nummern; jede Zeile kommt zurück, damit nichts zweimal gefragt wird.
export async function blAbrufNummern(art: BlArt, rbIds: string[], konto?: number | number[] | null): Promise<Map<string, string>> {
  const raus = new Map<string, string>();
  if (!rbIds.length) return raus;
  const zeilen = await repo.wirksameNummern(art, rbIds, konten(konto)).catch(meldeUndLiefere('bl-zuordnung:zeilen', []));
  for (const z of zeilen) raus.set(String(z.rb_id), String(z.nr));
  return raus;
}

export function merkeBlFarbnummer(colorId: number, blColorId: number): Promise<void> {
  return repo.schreibeBlFarbnummer(colorId, blColorId);
}

/** Rebrickable liefert `ext_ids` als Liste oder die Liste direkt. */
type ExterneNummern = { external_ids?: { BrickLink?: { ext_ids?: number[] } & number[] } } | null | undefined;
export function blFarbnummerAus(farbe: ExterneNummern): number | null {
  const id = farbe?.external_ids?.BrickLink?.ext_ids?.[0] ?? farbe?.external_ids?.BrickLink?.[0];
  return id ?? null;
}
