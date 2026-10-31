/**
 * Lagerort — wo liegt das eigentlich?
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#abschnitt
 */
import { meldeUndLiefere } from '../infra/httpError';
import * as db from '../../db/database';
import * as orte from './repository/lagerort';
import type { LagerTabelle } from './repository/lagerort';
import { asIds } from '../haushalt/haushalt';
import type { BlickfeldEingabe } from '../haushalt/haushalt';
import { fehlerWerfen } from '../infra/fehlerTexte';
// Statisch und nicht als dynamischer Import: Einen Kreis gibt es nicht
// (settings.ts kennt nur db und httpError), und `await import('./settings')`
// verlangt unter moduleResolution node16 die Dateiendung — eine Schreibweise,
// die im Baum sonst nirgends steht.
import { setUserSetting, deleteUserSetting } from '../konto/settings';

/**
 * Wie lang ein Lagerortname höchstens sein darf.
 * Kein technisches Limit (die Spalte ist TEXT), sondern ein fachliches: Was
 * hier steht, muss auf eine Kachel und in eine Auswahlliste passen. Ein
 * abgeschnittener Name in der Liste wäre schlimmer als eine Absage beim
 * Eintragen.
 */
export const LAGERORT_MAX_ZEICHEN = 60;

/** Die Arten mit Lagerort; die Tabellennamen stehen als Whitelist im Repository. */
export type LagerArt = LagerTabelle;

/**
 * Eingabe zu dem machen, was in der Spalte steht.
 *
 * Leer und NULL sind dasselbe: „nicht erfasst". Ein leerer Text wäre ein Ort
 * namens „nichts" und stünde in jeder Auswahlliste — siehe die Begründung in
 * db/migrations/0018-lagerort.sql.
 */
export function normalisiereLagerort(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > LAGERORT_MAX_ZEICHEN) fehlerWerfen('lagerort_zu_lang', 400);
  return s;
}

/**
 * Lagerort setzen — für die Zeilen EINES Kontos.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#setzelagerort
 * @returns wie viele Zeilen betroffen waren (0 = es gibt nichts zu setzen)
 */
export async function setzeLagerort(
  art: LagerArt, besitzerIds: number[], schluessel: string[], ort: string | null,
): Promise<number> {
  if (ort === null) return orte.ordneOrtZu(db, art, besitzerIds, null, schluessel);
  // Ein neuer Name kommt in den Vorrat — vor der Zuordnung, die ihn über die ID findet.
  // Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#setzelagerort-2
  return await db.transaction(async (tx) => {
    const ids = await orte.besitzerMitZeile(tx, art, besitzerIds, schluessel);
    if (!ids.length) return 0;
    await orte.nimmOrtAuf(tx, ids, ort);
    return orte.ordneOrtZu(tx, art, ids, ort, schluessel);
  });
}

/**
 * Ein Lagerort — der Vorrat, aus dem gewählt wird.
 *
 * `user_id` steht mit drin, weil eine Liste über mehrere Konten spannen kann
 * (der Grossvater sieht beim Set des Enkels dessen Orte) und die Oberfläche
 * sonst nicht wüsste, wessen Eintrag sie gerade bearbeitet.
 */
export interface Lagerort { id: number; user_id: number; name: string }

function nameOderFehler(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) fehlerWerfen('lagerort_leer', 400);
  if (s.length > LAGERORT_MAX_ZEICHEN) fehlerWerfen('lagerort_zu_lang', 400);
  return s;
}

/**
 * Der Vorrat EINES oder MEHRERER Konten.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#ortevon
 */
export async function orteVon(userIds: number[]): Promise<Lagerort[]> {
  const rows = await orte.orteDerKonten(userIds);
  type Zeile = { id: string | number; user_id: string | number; name: string };
  return (rows as Zeile[] || []).map(r => ({
    id: parseInt(String(r.id)), user_id: parseInt(String(r.user_id)), name: r.name,
  }));
}

/**
 * Einen Ort in den Vorrat legen — oder den vorhandenen zurückgeben.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#legeortan
 */
export async function legeOrtAn(userId: number, name: unknown):
  Promise<{ ort: Lagerort; war_neu: boolean }> {
  const n = nameOderFehler(name);
  const neu = await orte.fuegeOrtEin(userId, n);
  if (neu) return { ort: { id: parseInt(String(neu.id)), user_id: userId, name: neu.name },
                    war_neu: true };
  const alt = await orte.ortNachName(userId, n);
  // Ohne Treffer ist etwas anderes schiefgegangen als ein Duplikat — dann
  // lieber eine Absage als ein stilles „schon da".
  if (!alt) fehlerWerfen('lagerort_unbekannt', 500);
  return { ort: { id: parseInt(String(alt.id)), user_id: userId, name: alt.name },
           war_neu: false };
}

/**
 * Einen Ort umbenennen.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#benenneortum
 */
export async function benenneOrtUm(userId: number, id: number, name: unknown): Promise<Lagerort> {
  const neu = nameOderFehler(name);
  const alt = await orte.ortName(id, userId);
  if (!alt) fehlerWerfen('lagerort_unbekannt', 404);
  // Ein anderer Eintrag mit demselben Namen (Gross-/Kleinschreibung egal)
  // würde am Index scheitern — die Absage vorher ist die verständlichere.
  const kollision = await orte.andererOrtGleichenNamens(userId, neu, id);
  if (kollision) fehlerWerfen('lagerort_doppelt', 409);
  await orte.schreibeOrtNamen(id, userId, neu);
  return { id, user_id: userId, name: neu };
}

/**
 * Einen Ort aus dem Vorrat nehmen.
 *
 * Absage, solange noch etwas darin liegt. Die Alternative — stilles Leeren —
 * verlöre die Zuordnung von Sets, die der Löschende gar nicht im Blick hatte,
 * und zwar ohne Weg zurück.
 */
export async function loescheOrt(userId: number, id: number): Promise<void> {
  const ort = await orte.ortName(id, userId);
  if (!ort) fehlerWerfen('lagerort_unbekannt', 404);
  // Alle drei Tabellen: Ein Ort, in dem NUR Figuren liegen, liesse sich sonst
  // loeschen, und ihre Zuordnung zeigte danach auf einen Namen, den der
  // Vorrat nicht mehr kennt.
  // Gezaehlt wird ueber die ID und nicht ueber den Namen. Mit dem Namen war
  // diese Pruefung umgehbar, ohne dass jemand etwas falsch machte: Lag am Set
  // „estrich" und im Vorrat „Estrich", zaehlte der zeichengenaue Vergleich
  // null — der Ort liess sich loeschen, und das Set behielt einen Namen, den
  // die Auswahlliste nicht mehr kannte (nachgestellt in Migration 0031).
  const belegt = await orte.ortBelegung(userId, id);
  if (parseInt(String(belegt?.n ?? 0)) > 0) fehlerWerfen('lagerort_in_benutzung', 409);
  await orte.entferneOrt(id, userId);
}

/**
 * Alle belegten Lagerorte im Blickfeld, mit Anzahl.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#lagerorte
 */
export async function lagerorte(blickfeld: BlickfeldEingabe) {
  const uids = asIds(blickfeld);
  // Gruppiert wird ueber den NAMEN und nicht ueber die ID — auch jetzt, wo die
  // Zuordnung eine ID ist. Das ist Absicht: Ein Blickfeld kann mehrere Konten
  // umfassen, und „Keller" des Grossvaters und „Keller" des Enkels sind zwei
  // Zeilen im Vorrat. In der Uebersicht gehoeren sie zusammen, sonst stuende
  // „Keller" zweimal da und niemand koennte den Unterschied sehen.
  const rows = await orte.orteMitBestand(uids);
  // Typisiert statt `(r: any)`: db.all() liefert Zeilen ohne Form, und dieser
  // Bauplan sagt, was diese Abfrage liefert. Die Summen stehen als string,
  // weil der Postgres-Treiber SUM() als Zeichenkette zurueckgibt — genau
  // deshalb steht darunter parseInt und nicht Number().
  type Zeile = { ort: string; sets: string | number; teile: string | number;
                 figuren: string | number };
  return (rows as Zeile[] || []).map(r => ({
    ort: r.ort,
    sets:    parseInt(String(r.sets))    || 0,
    teile:   parseInt(String(r.teile))   || 0,
    figuren: parseInt(String(r.figuren)) || 0,
  }));
}

/**
 * Warum die ID gespeichert wird und nicht der Name
 * Überall sonst in dieser Datei ist der NAME die Zuordnung (siehe die
 * Begründung oben: eine Fremdschlüssel-ID hätte jede bestehende Zeile
 * umschreiben müssen). Für die Vorgabe ist es umgekehrt, und zwar aus einem …
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#vorgabe-schluessel
 */
export const VORGABE_SCHLUESSEL = 'default_storage_id';

/**
 * Die Vorgabe EINES Kontos — oder null.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#vorgabevon
 */
export async function vorgabeVon(userId: number): Promise<Lagerort | null> {
  const row = await orte.vorgabeOrt(userId, VORGABE_SCHLUESSEL)
    .catch(meldeUndLiefere('lagerort:row', null));
  if (!row) return null;
  return { id: parseInt(String(row.id)), user_id: parseInt(String(row.user_id)),
           name: row.name };
}

/**
 * Der Ort, unter dem ein NEU erfasstes Stueck landet.
 * Ausführlich: docs/begruendungen/src/bestand/lagerort.ts.md#ortfuerneuerfassung
 */
export async function ortFuerNeuerfassung(
  userId: number, mitgegeben: unknown,
): Promise<string | null> {
  // Die Laengengrenze zuerst, und zwar an DEM Wert, der hereinkam: Ein zu
  // langer Ort soll absagen, bevor irgendetwas angelegt ist (die Begruendung
  // steht an den drei Anlegehuellen).
  const ort = normalisiereLagerort(mitgegeben);
  if (ort) return ort;
  if (mitgegeben !== undefined && mitgegeben !== null) return null;
  // Eine Vorgabe, deren Ort geloescht wurde, ist keine — das prueft vorgabeVon().
  return (await vorgabeVon(userId))?.name ?? null;
}

/**
 * Die Vorgabe setzen oder abschalten.
 * `null` löscht sie — das ist der zweite Druck auf denselben Stern. Ein Ort,
 * der dem Konto nicht gehört, wird abgelehnt und nicht stillschweigend
 * ignoriert: Der Stern stünde danach am falschen Eintrag, und niemand käme auf
 * den Grund.
 */
export async function setzeVorgabe(userId: number, id: number | null): Promise<Lagerort | null> {
  if (id === null) {
    await deleteUserSetting(userId, VORGABE_SCHLUESSEL);
    return null;
  }
  const ort = await orte.ortDesKontos(id, userId);
  if (!ort) fehlerWerfen('lagerort_unbekannt', 404);
  // Über die Einstellungen des Kontos, nicht mit eigener Anweisung: user_settings gehört dorthin.
  await setUserSetting(userId, VORGABE_SCHLUESSEL, String(id));
  return { id: parseInt(String(ort.id)), user_id: userId, name: ort.name };
}
