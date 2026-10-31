import * as repo from './repository/gemeinsam';
import { istErsatzteil } from '../infra/validate';
import { asIds } from '../haushalt/haushalt';
import { KEINE_FARBE } from '../infra/validate';

/**
 * Was alle drei Domänen brauchen: Seitengrössen, Zustandsableitung aus
 * Erfassungen, Besitzer-Anreicherung.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#abschnitt
 */

/**
 * Obergrenze für page_size — je Anfrage, unabhängig vom Abfrageweg.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#max-page-size
 */
export const MAX_PAGE_SIZE = 500;

/**
 * Obergrenze, wenn ein Aufrufer GAR KEIN page_size schickt.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#unpaged-limit
 */
export const UNPAGED_LIMIT = 2000;

/**
 * Obergrenze für die Teileliste EINES Sets (Filter set_number).
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#set-parts-max-page-size
 */
export const SET_PARTS_MAX_PAGE_SIZE = 5000;

/** page_size auf einen brauchbaren Wert bringen: mindestens 1, höchstens MAX. */
export function clampPageSize(value: any, fallback: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(value)) || fallback));
}

/**
 * Eine Anzahl, wie sie aus der Datenbank kommt.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#zaehlwert
 */
type Zaehlwert = number | string | null | undefined;

/**
 * DIE Zustandsregel — für Sets, manuelle Teile und manuelle Minifiguren.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#conditionfromacquisitions
 */
export function conditionFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert) {
  // COUNT(*) kommt als Text ("2"); parseInt wie in der Schwesterfunktion.
  // Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#conditionfromacquisitions-acq
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  // Als Bedingungsausdruck und nicht als zwei Rueckgaben: Die Regel soll als
  // EIN Ausdruck lesbar sein, und test/set-condition-aggregate.test.js zaehlt
  // genau diese Form („die Aggregat-Regel steht nur noch an einer Stelle").
  if (acq > 0) return used > 0 ? 'U' : 'N';
  return 'N';
}

/**
 * WELCHE Zustände hat der Eintrag — für die Plaketten auf der Kachel.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#conditionsfromacquisitions
 */
export function conditionsFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert): ('N' | 'U')[] {
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  // Ohne Erfassungen die eine Plakette „Neu" — siehe die Begruendung in der
  // Schwesterfunktion oben, warum es keinen gespeicherten Wert mehr gibt.
  if (acq <= 0) return ['N'];
  const out: ('N' | 'U')[] = [];
  if (acq - used > 0) out.push('N');
  if (used > 0)       out.push('U');
  return out.length ? out : ['N'];
}

/**
 * Angezeigter Zustand manuell erfasster Teile und Minifiguren.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#abschnitt-2
 */
export async function applyManualCondition(userId: unknown, rows: any[], kind: 'part' | 'fig') {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  if (!rows?.length) return rows;

  const isPart = kind === 'part';
  const keyOf = (r: any) => isPart
    ? `${r.part_number}|${r.color_id ?? KEINE_FARBE}`
    : String(r.fig_number);

  const acq = await repo.erfassungsKennzahlen(isPart ? 'part' : 'fig', uids);

  const byKey = new Map<string, any>(acq.map((a: any) => [
    isPart ? `${a.part_number}|${a.color_id ?? KEINE_FARBE}` : String(a.fig_number),
    a,
  ] as [string, any]));

  return rows.map(r => {
    const a = byKey.get(keyOf(r));
    const acqCount = parseInt(a?.acq_count) || 0;
    const usedCount = parseInt(a?.used_count) || 0;
    return {
      ...r,
      // Ohne den gespeicherten Wert der Stammzeile: Migration 0035 hat die
      // Spalte geloescht und garantiert fuer jede manuelle Position eine
      // Erfassung.
      condition: conditionFromAcquisitions(acqCount, usedCount),
      conditions: conditionsFromAcquisitions(acqCount, usedCount),
      acq_count: acqCount,
      used_count: usedCount,
      // Mengengewichtet über die Erfassungen — die Kachel zeigte bisher den
      // Wert der Stammzeile, also den zuletzt geschriebenen Einzelpreis.
      avg_purchase_price: a?.avg_purchase_price != null ? parseFloat(a.avg_purchase_price) : null,
    };
  });
}

/**
 * Besitzer-Plaketten anhaengen — fuer EINZELNE Zeilen (`user_id`) und fuer
 * GRUPPIERTE (`owner_ids`).
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#withowners
 */
export async function withOwners(uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await repo.benutzerNamen(uids);
  const nameById = new Map<number, any>(owners.map((u: any) => [parseInt(u.id), u.username] as [number, any]));
  const platte = (id: number) => ({ id, username: nameById.get(id) || String(id) });
  return rows.map(r => {
    // `owner_ids` KANN als Schluessel mit dem Wert null dastehen: array_agg
    // liefert NULL, wenn der FILTER alles ausschliesst (ein Set, das niemand
    // mehr in Menge > 0 besitzt). Dann gehoert eine LEERE Plakettenliste
    // heraus, nicht keine — genau das tat getSets vorher schon.
    if ('owner_ids' in r) return { ...r, owners: (r.owner_ids || []).map((n: any) => platte(parseInt(n))) };
    if (r.user_id != null) return { ...r, owners: [platte(parseInt(r.user_id))] };
    return r;
  });
}

/**
 * In welchen Sets steckt dieses Teil / diese Figur?
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#verwendendesset
 */
export interface VerwendendesSet {
  set_number: string;
  set_name: string | null;
  quantity: number;
  image_local: string | null;
  image_url: string | null;
  owner_user_id: number;
}

/** Das Teil bzw. die Figur selbst — für die Kopfzeile des Dialogs. */
export interface BestandteilKopf {
  nummer: string;
  name: string | null;
  color_id: number | null;
  color_name: string | null;
  color_hex: string | null;
  category_name: string | null;
  image_local: string | null;
  image_url: string | null;
  is_spare: boolean;
  /**
   * Lagerort — verdichtet über alle Zeilen dieses Teils.
   * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#bestandteilkopf
   */
  storage: string | null;
  /**
   * Wem dieses Teil gehört — die Konten, in deren Sets es steckt.
   * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#bestandteilkopf-2
   */
  owner_ids: number[];
  /** Summe über ALLE Sets im Blickfeld. */
  total_quantity: number;
}

export interface BestandteilAntwort {
  item: BestandteilKopf | null;
  sets: VerwendendesSet[];
}

export async function verwendendeSets(
  uids: number[],
  tabelle: 'parts' | 'minifigs',
  schluessel: Record<string, string | number>,
): Promise<BestandteilAntwort> {
  const rows = await repo.setsMitBestandteil(uids, tabelle, schluessel);

  const sets: VerwendendesSet[] = rows.map((r: any) => ({
    set_number:    String(r.set_number),
    set_name:      r.set_name ?? null,
    quantity:      parseInt(r.quantity, 10) || 0,
    image_local:   r.set_image_local ?? null,
    image_url:     r.set_image_url ?? null,
    owner_user_id: parseInt(r.owner_user_id, 10),
  }));

  // Der Kopf entsteht aus denselben Zeilen wie die Liste; das Bild von der
  // ersten Zeile, die eines hat (es ist dasselbe Teil).
  const erste = rows[0] as any;
  const mitBild = (rows as any[]).find(r => r.teil_image_local || r.teil_image_url);
  const item: BestandteilKopf | null = erste ? {
    nummer:         String(erste.nummer),
    name:           erste.name ?? null,
    color_id:       erste.color_id == null ? null : parseInt(erste.color_id, 10),
    color_name:     erste.color_name ?? null,
    color_hex:      erste.color_hex ?? null,
    category_name:  erste.category_name ?? null,
    image_local:    mitBild?.teil_image_local ?? null,
    image_url:      mitBild?.teil_image_url ?? null,
    // is_spare kommt als INTEGER aus der Spalte; der Treiber liefert
    // Aggregate als ZEICHENKETTE, und "0" ist in JavaScript WAHR. Deshalb
    // ausdrücklich über istErsatzteil() — dieselbe Lesart wie überall sonst.
    is_spare:       istErsatzteil(erste.is_spare),
    storage:        erste.storage ?? null,
    // Aus DENSELBEN Zeilen wie die Liste darunter — siehe owner_ids.
    owner_ids:      [...new Set(sets.map(s => s.owner_user_id))].filter(Number.isFinite),
    total_quantity: sets.reduce((n, s) => n + s.quantity, 0),
  } : null;

  return { item, sets };
}

/**
 * Die manuell erfasste Stammzeile eines Teils bzw. einer Figur entfernen.
 * Ausführlich: docs/begruendungen/src/bestand/gemeinsam.ts.md#loeschemanuellesteil
 * @param dbh Transaktionsgriff, wo einer gebraucht wird
 */
export async function loescheManuellesTeil(
  dbh: { run: (sql: string, p?: any[]) => Promise<any> }, ownerId: number, partNumber: string, colorId: number,
) {
  return repo.loescheTeilZeile(dbh, ownerId, partNumber, colorId);
}

/** Wie loescheManuellesTeil, fuer eine manuell erfasste Figur. */
export async function loescheManuelleFigur(
  dbh: { run: (sql: string, p?: any[]) => Promise<any> }, ownerId: number, figNumber: string,
) {
  return repo.loescheFigurZeile(dbh, ownerId, figNumber);
}
