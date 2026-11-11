import * as repo from './repository/gemeinsam';
export { entferneSetInhalt, kopiereSetInhalt, legeManuellAn } from './repository/gemeinsam';
import type { DbSchnittstelle } from '../../db/database';
import { istErsatzteil, KEINE_FARBE } from '../infra/validate';
import { haushaltBereich, asIds, type Sicht } from '../haushalt';
import { bestandBereich } from './prozess';

// Was Sets, Teile und Figuren gemeinsam brauchen.

/** Je Anfrage, unabhängig vom Abfrageweg — eine Stelle statt fünf Literale. */
export const MAX_PAGE_SIZE = 500;

/** Ohne page_size läge sonst der ganze Bestand in einer Antwort im Speicher. */
export const UNPAGED_LIMIT = 2000;

/** Die Set-Detailansicht der App holt nur Seite 1; die normale Grenze schnitte ab. */
export const SET_PARTS_MAX_PAGE_SIZE = 5000;

export function clampPageSize(value: unknown, fallback: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(value)) || fallback));
}

/** COUNT(*) ist bigint und kommt als Zeichenkette aus dem Treiber. */
type Zaehlwert = number | string | null | undefined;

/** DIE Zustandsregel für Sets, manuelle Teile und Figuren: eine gebrauchte
 * Erfassung macht den Eintrag gebraucht. */
export function conditionFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert) {
  // COUNT(*) kommt als Text ("2").
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  // Ein Ausdruck, damit die Regel als EINE Zeile lesbar bleibt.
  if (acq > 0) return used > 0 ? 'U' : 'N';
  return 'N';
}

/** Für die Plaketten: Wer neu und gebraucht hat, soll beides sehen. */
export function conditionsFromAcquisitions(acqCount: Zaehlwert, usedCount: Zaehlwert): ('N' | 'U')[] {
  const acq  = parseInt(String(acqCount ?? ''))  || 0;
  const used = parseInt(String(usedCount ?? '')) || 0;
  // Ohne Erfassungen die eine Plakette „Neu".
  if (acq <= 0) return ['N'];
  const out: ('N' | 'U')[] = [];
  if (acq - used > 0) out.push('N');
  if (used > 0)       out.push('U');
  return out.length ? out : ['N'];
}

// Wie bei Sets: Eine gebrauchte Erfassung macht den Eintrag gebraucht; eine Abfrage je Seite.
type Schluessel = { part_number?: string; color_id?: number | null; fig_number?: string };
export async function applyManualCondition<R extends Schluessel>(userId: number | number[], rows: R[], kind: 'part' | 'fig') {
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  if (!rows?.length) return rows;

  const isPart = kind === 'part';
  const keyOf = (r: Schluessel) => isPart
    ? `${r.part_number}|${r.color_id ?? KEINE_FARBE}`
    : String(r.fig_number);

  const acq = await bestandBereich().gemeinsam.erfassungsKennzahlen(isPart ? 'part' : 'fig', uids);

  const byKey = new Map(acq.map(a => [keyOf(a), a]));

  return rows.map(r => {
    const a = byKey.get(keyOf(r));
    const acqCount = parseInt(String(a?.acq_count)) || 0;
    const usedCount = parseInt(String(a?.used_count)) || 0;
    return {
      ...r,
      condition: conditionFromAcquisitions(acqCount, usedCount),
      conditions: conditionsFromAcquisitions(acqCount, usedCount),
      acq_count: acqCount,
      used_count: usedCount,
      // Mengengewichtet über die Erfassungen, nicht der zuletzt geschriebene Einzelpreis.
      avg_purchase_price: a?.avg_purchase_price != null ? Number(a.avg_purchase_price) : null,
    };
  });
}

// Eine Funktion für Teile und Figuren: Nur Tabelle und Schlüssel wechseln.
export interface VerwendendesSet {
  set_number: string;
  set_name: string | null;
  quantity: number;
  image_local: string | null;
  image_url: string | null;
  owner_user_id: number;
}

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
  /** string_agg: Dasselbe Teil kann in mehreren Kisten liegen; ein Wert verschwiege die anderen. */
  storage: string | null;
  /** Für die Lagerort-Auswahl im Dialog. */
  owner_ids: number[];
  total_quantity: number;
}

export interface BestandteilAntwort {
  item: BestandteilKopf | null;
  sets: VerwendendesSet[];
}

export async function verwendendeSets(
  uidsWahl: Sicht | number[],
  tabelle: 'parts' | 'minifigs',
  schluessel: Record<string, string | number>,
): Promise<BestandteilAntwort> {
  const uids = await haushaltBereich().haushalt.blickfeldAus(uidsWahl);
  const rows = await bestandBereich().gemeinsam.setsMitBestandteil(uids, tabelle, schluessel);

  const sets: VerwendendesSet[] = rows.map(r => ({
    set_number:    String(r.set_number),
    set_name:      r.set_name ?? null,
    quantity:      parseInt(String(r.quantity), 10) || 0,
    image_local:   r.set_image_local ?? null,
    image_url:     r.set_image_url ?? null,
    owner_user_id: parseInt(String(r.owner_user_id), 10),
  }));

  // Der Kopf aus denselben Zeilen wie die Liste; das Bild von der ersten mit Bild.
  const erste = rows[0];
  const mitBild = rows.find(r => r.teil_image_local || r.teil_image_url);
  const item: BestandteilKopf | null = erste ? {
    nummer:         String(erste.nummer),
    name:           erste.name ?? null,
    color_id:       erste.color_id == null ? null : parseInt(String(erste.color_id), 10),
    color_name:     erste.color_name ?? null,
    color_hex:      erste.color_hex ?? null,
    category_name:  erste.category_name ?? null,
    image_local:    mitBild?.teil_image_local ?? null,
    image_url:      mitBild?.teil_image_url ?? null,
    // istErsatzteil(): Aggregate kommen als Zeichenkette, und "0" ist wahr.
    is_spare:       istErsatzteil(erste.is_spare),
    storage:        erste.storage ?? null,
    owner_ids:      [...new Set(sets.map(s => s.owner_user_id))].filter(Number.isFinite),
    total_quantity: sets.reduce((n, s) => n + s.quantity, 0),
  } : null;

  return { item, sets };
}

/** Eine Stelle für Löschroute und Aufräumen der Erfassungen.
 * @param dbh Transaktionsgriff, wo einer gebraucht wird */
export async function loescheManuellesTeil(
  dbh: Pick<DbSchnittstelle, 'run'>, ownerId: number, partNumber: string, colorId: number,
) {
  return repo.loescheTeilZeile(dbh, ownerId, partNumber, colorId);
}

export async function loescheManuelleFigur(
  dbh: Pick<DbSchnittstelle, 'run'>, ownerId: number, figNumber: string,
) {
  return repo.loescheFigurZeile(dbh, ownerId, figNumber);
}
