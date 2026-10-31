/**
 * Farb-IDs sind Rebrickable-IDs. Dort ist 0 Schwarz und 9999 „[No Color/Any
 * Color]“; eine fehlende Farbe ist deshalb KEINE_FARBE und nie 0, sonst wird
 * aus „keine Angabe“ ein schwarzes Teil (Migration 0071).
 */
import * as db from '../db/database';
import { getBrickColors } from '../clients/rebrickable';
import { meldeUndLiefere } from '../src/infra/httpError';
import { KEINE_FARBE } from '../src/infra/validate';

export { KEINE_FARBE };

export interface Farbe { id: number; name: string; hex: string | null }

/**
 * Notliste, wenn weder rb_colors geladen noch Rebrickable erreichbar ist —
 * nur Farben, deren Rebrickable-ID feststeht. Eine falsche ID wäre schlimmer
 * als eine kurze Liste: Sie landet im Bestand und im Preisabruf.
 */
const NOTLISTE: Farbe[] = [
  { id: KEINE_FARBE, name: '[No Color/Any Color]', hex: null },
  { id: 0,   name: 'Black',             hex: '05131D' },
  { id: 1,   name: 'Blue',              hex: '0055BF' },
  { id: 2,   name: 'Green',             hex: '237841' },
  { id: 4,   name: 'Red',               hex: 'C91A09' },
  { id: 14,  name: 'Yellow',            hex: 'F2CD37' },
  { id: 15,  name: 'White',             hex: 'FFFFFF' },
  { id: 19,  name: 'Tan',               hex: 'E4CD9E' },
  { id: 25,  name: 'Orange',            hex: 'FE8A18' },
  { id: 70,  name: 'Reddish Brown',     hex: '582A12' },
  { id: 71,  name: 'Light Bluish Gray', hex: 'A0A5A9' },
  { id: 72,  name: 'Dark Bluish Gray',  hex: '6C6E68' },
];

/** Die Farbauswahl beim Erfassen: geladene Tabelle, sonst Rebrickable, sonst die Notliste. */
export async function farbliste(): Promise<Farbe[]> {
  const geladen = await db.all<{ id: number; name: string; hex: string | null }>(
    `SELECT id, name, NULLIF(rgb, '') AS hex FROM rb_colors
      WHERE id >= 0 AND name IS NOT NULL ORDER BY id`)
    .catch(meldeUndLiefere('farben:rb_colors', [] as Farbe[]));
  if (geladen.length) return geladen;
  const abgerufen = await getBrickColors();
  if (abgerufen.length) return abgerufen;
  return NOTLISTE;
}
