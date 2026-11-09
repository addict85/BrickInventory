/** Der Lagerort hängt an Sets, Teilen und Figuren; setzen, auflisten und
 * räumen stehen deshalb einmal hier statt je Route.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#abschnitt */
import { meldeUndLiefere } from '../infra/fehler';
import * as db from '../../db/database';
import * as orte from './repository/lagerort';
import type { LagerTabelle } from './repository/lagerort';
import { asIds, scopeIds, writableIds, blickfeldAus, type Sicht, schreibbereichAus, type Schreiber } from '../haushalt/haushalt';
import type { BlickfeldEingabe } from '../haushalt/haushalt';
import { fachfehler } from '../infra/fehlerTexte';
import { deleteUserSetting } from '../einstellungen/settings';
import { setUserSetting } from '../konto/nutzerEinstellung';

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

/** Wer schreiben darf, entscheidet src/haushalt/haushalt.ts; diese Funktion
 * bekommt die fertige Menge und fragt nicht nach.
 * @returns wie viele Zeilen betroffen waren (0 = es gibt nichts zu setzen) */
export async function setzeLagerort(
  art: LagerArt, besitzerIdsWahl: Schreiber | number[], schluessel: string[], ort: string | null,
): Promise<number> {
  const besitzerIds = await schreibbereichAus(besitzerIdsWahl);
  if (ort === null) return orte.ordneOrtZu(db, art, besitzerIds, null, schluessel);
  // Ein neuer Name kommt in den Vorrat — vor der Zuordnung, die ihn über die ID findet.
  return await db.transaction(async (tx) => {
    const ids = await orte.besitzerMitZeile(tx, art, besitzerIds, schluessel);
    if (!ids.length) return 0;
    await orte.nimmOrtAuf(tx, ids, ort);
    return orte.ordneOrtZu(tx, art, ids, ort, schluessel);
  });
}

/** `user_id`, weil eine Liste über mehrere Konten spannen kann und die
 * Oberfläche wissen muss, wessen Eintrag sie bearbeitet. */
export interface Lagerort { id: number; user_id: number; name: string }

function nameOderFehler(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) fachfehler('ungueltig', 'lagerort_leer');
  if (s.length > LAGERORT_MAX_ZEICHEN) fachfehler('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** Schnittmenge statt Absage; ohne Ansichtsfilter, denn die Frage ist „darf ich?“.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#lagerkonten */
export async function lagerKonten(nutzer: number, wunsch: string | number | undefined, schreiben: boolean): Promise<number[]> {
  const gewuenscht = String(wunsch ?? '').split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (!gewuenscht.length) return [nutzer];
  const erlaubt = schreiben ? await writableIds(nutzer) : await scopeIds(nutzer);
  return gewuenscht.filter(id => erlaubt.includes(id));
}

/** EIN Konto je Schreibaufruf, damit jeder Ort für sich scheitern kann; 403 ohne Recht. */
export async function lagerSchreibkonto(nutzer: number, wunsch: string | number | undefined): Promise<number> {
  const konto = (await lagerKonten(nutzer, wunsch, true))[0];
  if (konto === undefined) fachfehler('verboten', 'kein_schreibrecht');
  return konto;
}

/** Der Vorrat der gewünschten Konten, soweit das Konto sie sehen darf. */
export async function orteFuer(nutzer: number, wunsch: string | undefined): Promise<Lagerort[]> {
  return orteVon(await lagerKonten(nutzer, wunsch, false));
}

/** Wer wessen Liste sehen darf, entscheidet der Haushalt; die IDs kommen mit.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#ortevon */
export async function orteVon(userIds: number[]): Promise<Lagerort[]> {
  const rows = await orte.orteDerKonten(userIds);
  type Zeile = { id: string | number; user_id: string | number; name: string };
  return (rows as Zeile[] || []).map(r => ({
    id: parseInt(String(r.id)), user_id: parseInt(String(r.user_id)), name: r.name,
  }));
}

/** Kein Fehler, wenn es ihn gibt: Beim Setzen eines Lagerorts wäre die Absage Unfug.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#legeortan */
export async function legeOrtAn(userId: number, name: unknown):
  Promise<{ ort: Lagerort; war_neu: boolean }> {
  const n = nameOderFehler(name);
  const neu = await orte.fuegeOrtEin(userId, n);
  if (neu) return { ort: { id: parseInt(String(neu.id)), user_id: userId, name: neu.name },
                    war_neu: true };
  const alt = await orte.ortNachName(userId, n);
  // Ohne Treffer ging etwas anderes schief als ein Duplikat — lieber eine
  // Absage als ein stilles „schon da".
  if (!alt) fachfehler('intern', 'lagerort_unbekannt');
  return { ort: { id: parseInt(String(alt.id)), user_id: userId, name: alt.name },
           war_neu: false };
}

/** Die Zuordnung ist eine ID; der neue Name gilt damit überall sofort. */
export async function benenneOrtUm(userId: number, id: number, name: unknown): Promise<Lagerort> {
  const neu = nameOderFehler(name);
  const alt = await orte.ortName(id, userId);
  if (!alt) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Die Absage vorher ist verständlicher als der Fehler am Index.
  const kollision = await orte.andererOrtGleichenNamens(userId, neu, id);
  if (kollision) fachfehler('konflikt', 'lagerort_doppelt');
  await orte.schreibeOrtNamen(id, userId, neu);
  return { id, user_id: userId, name: neu };
}

/** Absage, solange noch etwas darin liegt: Stilles Leeren verlöre Zuordnungen,
 * die der Löschende nicht im Blick hatte, ohne Weg zurück. */
export async function loescheOrt(userId: number, id: number): Promise<void> {
  const ort = await orte.ortName(id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Alle drei Tabellen, über die ID: Sonst liesse sich ein Ort löschen, in dem
  // nur Figuren liegen oder der anders geschrieben zugeordnet ist.
  const belegt = await orte.ortBelegung(userId, id);
  if (parseInt(String(belegt?.n ?? 0)) > 0) fachfehler('konflikt', 'lagerort_in_benutzung');
  await orte.entferneOrt(id, userId);
}

/** EINE Abfrage über alle Tabellen, damit nicht jede Oberfläche selbst zusammenführt.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#lagerorte */
export async function lagerorte(blickfeldWahl: Sicht | BlickfeldEingabe) {
  const blickfeld = await blickfeldAus(blickfeldWahl);
  const uids = asIds(blickfeld);
  // Über den NAMEN gruppiert, absichtlich: „Keller" von Grossvater und Enkel
  // sind zwei Vorratszeilen, gehören in der Übersicht aber zusammen.
  const rows = await orte.orteMitBestand(uids);
  // SUM() kommt als Zeichenkette aus dem Treiber; deshalb parseInt darunter.
  type Zeile = { ort: string; sets: string | number; teile: string | number;
                 figuren: string | number };
  return (rows as Zeile[] || []).map(r => ({
    ort: r.ort,
    sets:    parseInt(String(r.sets))    || 0,
    teile:   parseInt(String(r.teile))   || 0,
    figuren: parseInt(String(r.figuren)) || 0,
  }));
}

/** Für die Vorgabe zählt die ID: Ein umbenannter Ort bleibt die Vorgabe.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#vorgabe-schluessel */
export const VORGABE_SCHLUESSEL = 'default_storage_id';

/** Über einen JOIN auf den Vorrat: Eine Vorgabe, deren Ort gelöscht wurde,
 * ist keine, und eine fremde ID gilt nicht. */
export async function vorgabeVon(userId: number): Promise<Lagerort | null> {
  const row = await orte.vorgabeOrt(userId, VORGABE_SCHLUESSEL)
    .catch(meldeUndLiefere('lagerort:row', null));
  if (!row) return null;
  return { id: parseInt(String(row.id)), user_id: parseInt(String(row.user_id)),
           name: row.name };
}

/** Ohne mitgegebenen Ort gilt die Vorgabe — für jeden Erfassungsweg.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#ortfuerneuerfassung */
export async function ortFuerNeuerfassung(
  userId: number, mitgegeben: unknown,
): Promise<string | null> {
  // Die Längengrenze zuerst: Ein zu langer Ort soll absagen, bevor etwas
  // angelegt ist.
  const ort = normalisiereLagerort(mitgegeben);
  if (ort) return ort;
  if (mitgegeben !== undefined && mitgegeben !== null) return null;
  return (await vorgabeVon(userId))?.name ?? null;
}

/** `null` löscht sie. Ein fremder Ort wird abgelehnt, nicht ignoriert: Der
 * Stern stünde sonst am falschen Eintrag. */
export async function setzeVorgabe(userId: number, id: number | null): Promise<Lagerort | null> {
  if (id === null) {
    await deleteUserSetting(userId, VORGABE_SCHLUESSEL);
    return null;
  }
  const ort = await orte.ortDesKontos(id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Über die Einstellungen des Kontos: user_settings gehört dorthin.
  await setUserSetting(userId, VORGABE_SCHLUESSEL, String(id));
  return { id: parseInt(String(ort.id)), user_id: userId, name: ort.name };
}
