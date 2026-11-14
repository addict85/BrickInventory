/** Der Lagerort hängt an Sets, Teilen und Figuren; auflisten und räumen stehen
 * deshalb einmal hier statt je Route (setzen: lagerortSetzen.ts). */
import type { BestandKontext } from './kontext';
import * as orte from './repository/lagerort';
import type { LagerTabelle } from './repository/lagerort';
import { asIds, type Sicht, type BlickfeldEingabe } from '../haushalt';
import { fachfehler } from '../infra/fehlerTexte';

/** Fachlich, nicht technisch (die Spalte ist TEXT): Der Name muss auf eine
 * Kachel passen, und eine Absage ist besser als ein abgeschnittener Name. */
export const LAGERORT_MAX_ZEICHEN = 60;

export type LagerArt = LagerTabelle;

/** Leer und NULL sind dasselbe: Ein leerer Text wäre ein Ort namens „nichts"
 * in jeder Auswahlliste (db/migrations/0018-lagerort.sql). */
export function normalisiereLagerort(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > LAGERORT_MAX_ZEICHEN) fachfehler('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** `user_id`, weil eine Liste über mehrere Konten spannen kann und die
 * Oberfläche wissen muss, wessen Eintrag sie bearbeitet. */
export interface Lagerort {
  id: number;
  user_id: number;
  name: string;
}

function nameOderFehler(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) fachfehler('ungueltig', 'lagerort_leer');
  if (s.length > LAGERORT_MAX_ZEICHEN) fachfehler('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** Wer wessen Liste sehen darf, entscheidet der Haushalt; die IDs kommen mit. */
export async function orteVon(k: BestandKontext, userIds: number[]): Promise<Lagerort[]> {
  const rows = await orte.orteDerKonten(k.db, userIds);
  type Zeile = { id: string | number; user_id: string | number; name: string };
  return ((rows as Zeile[]) || []).map(r => ({
    id: parseInt(String(r.id), 10),
    user_id: parseInt(String(r.user_id), 10),
    name: r.name,
  }));
}

/** Kein Fehler, wenn es ihn gibt: Beim Setzen eines Lagerorts wäre die Absage Unfug. */
export async function legeOrtAn(
  k: BestandKontext,
  userId: number,
  name: string | undefined,
): Promise<{ ort: Lagerort; war_neu: boolean }> {
  const n = nameOderFehler(name);
  const neu = await orte.fuegeOrtEin(k.db, userId, n);
  if (neu) return { ort: { id: parseInt(String(neu.id), 10), user_id: userId, name: neu.name }, war_neu: true };
  const alt = await orte.ortNachName(k.db, userId, n);
  // Ohne Treffer ging etwas anderes schief als ein Duplikat — lieber eine
  // Absage als ein stilles „schon da".
  if (!alt) fachfehler('intern', 'lagerort_unbekannt');
  return { ort: { id: parseInt(String(alt.id), 10), user_id: userId, name: alt.name }, war_neu: false };
}

/** Die Zuordnung ist eine ID; der neue Name gilt damit überall sofort. */
export async function benenneOrtUm(
  k: BestandKontext,
  userId: number,
  id: number,
  name: string | undefined,
): Promise<Lagerort> {
  const neu = nameOderFehler(name);
  const alt = await orte.ortName(k.db, id, userId);
  if (!alt) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Die Absage vorher ist verständlicher als der Fehler am Index.
  const kollision = await orte.andererOrtGleichenNamens(k.db, userId, neu, id);
  if (kollision) fachfehler('konflikt', 'lagerort_doppelt');
  await orte.schreibeOrtNamen(k.db, id, userId, neu);
  return { id, user_id: userId, name: neu };
}

/** Absage, solange noch etwas darin liegt: Stilles Leeren verlöre Zuordnungen,
 * die der Löschende nicht im Blick hatte, ohne Weg zurück. */
export async function loescheOrt(k: BestandKontext, userId: number, id: number): Promise<void> {
  const ort = await orte.ortName(k.db, id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Alle drei Tabellen, über die ID: Sonst liesse sich ein Ort löschen, in dem
  // nur Figuren liegen oder der anders geschrieben zugeordnet ist.
  const belegt = await orte.ortBelegung(k.db, userId, id);
  if (parseInt(String(belegt?.n ?? 0), 10) > 0) fachfehler('konflikt', 'lagerort_in_benutzung');
  await orte.entferneOrt(k.db, id, userId);
}

/** EINE Abfrage über alle Tabellen, damit nicht jede Oberfläche selbst zusammenführt. */
export async function lagerorte(k: BestandKontext, blickfeldWahl: Sicht | BlickfeldEingabe) {
  const blickfeld = await k.haushalt.blickfeldAus(blickfeldWahl);
  const uids = asIds(blickfeld);
  // Über den NAMEN gruppiert, absichtlich: „Keller" von Grossvater und Enkel
  // sind zwei Vorratszeilen, gehören in der Übersicht aber zusammen.
  const rows = await orte.orteMitBestand(k.db, uids);
  // SUM() kommt als Zeichenkette aus dem Treiber; deshalb parseInt darunter.
  type Zeile = { ort: string; sets: string | number; teile: string | number; figuren: string | number };
  return ((rows as Zeile[]) || []).map(r => ({
    ort: r.ort,
    sets: parseInt(String(r.sets), 10) || 0,
    teile: parseInt(String(r.teile), 10) || 0,
    figuren: parseInt(String(r.figuren), 10) || 0,
  }));
}

/** Für die Vorgabe zählt die ID: Ein umbenannter Ort bleibt die Vorgabe. */
export const VORGABE_SCHLUESSEL = 'default_storage_id';

/** Über einen JOIN auf den Vorrat: Eine Vorgabe, deren Ort gelöscht wurde,
 * ist keine, und eine fremde ID gilt nicht. */
export async function vorgabeVon(k: BestandKontext, userId: number): Promise<Lagerort | null> {
  const row = await orte.vorgabeOrt(k.db, userId, VORGABE_SCHLUESSEL);
  if (!row) return null;
  return { id: parseInt(String(row.id), 10), user_id: parseInt(String(row.user_id), 10), name: row.name };
}

/** Ohne mitgegebenen Ort gilt die Vorgabe — für jeden Erfassungsweg. */
export async function ortFuerNeuerfassung(
  k: BestandKontext,
  userId: number,
  mitgegeben: unknown,
): Promise<string | null> {
  // Die Längengrenze zuerst: Ein zu langer Ort soll absagen, bevor etwas
  // angelegt ist.
  const ort = normalisiereLagerort(mitgegeben);
  if (ort) return ort;
  if (mitgegeben !== undefined && mitgegeben !== null) return null;
  return (await vorgabeVon(k, userId))?.name ?? null;
}
