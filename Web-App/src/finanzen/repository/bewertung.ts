import * as db from '../../../db/database';
import { kaufpreisSpalten } from '../../../db/geldSql';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../../../db/bestandsmenge';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';

/** Was die Bewertung liest: Sets, manuelle Teile und Figuren im Blickfeld samt ihren Erfassungen. */

/** Eine Erfassung eines manuellen Teils oder einer Figur, Kaufpreis in der Kontowährung. */
export interface ManuelleErfassung {
  id: number; part_number?: string; color_id?: number | null; fig_number?: string; quantity: number;
  unit_price: string | null; kaufpreis_fremd: boolean; kaufpreis_umgerechnet: boolean; currency: string;
  price_estimated: boolean; condition: string; created_at: Date;
}

/** Erfassungen manueller Teile bzw. Figuren, älteste zuerst. */
export function manuelleErfassungen(art: 'part' | 'fig', uids: number[], waehrung: string) {
  return db.all<ManuelleErfassung>(art === 'part'
    ? `SELECT id, part_number, color_id, quantity,
              ${kaufpreisSpalten('unit_price', '$2')}, currency, price_estimated,
              COALESCE(condition,'N') AS condition, created_at
         FROM part_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`
    : `SELECT id, fig_number, quantity,
              ${kaufpreisSpalten('unit_price', '$2')}, currency, price_estimated,
              COALESCE(condition,'N') AS condition, created_at
         FROM minifig_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`,
  [uids, waehrung]);
}

export interface BewertetesSet {
  set_number: string; name: string | null; year: number | null; quantity: number;
  image_local: string | null; image_url: string | null; added_at: Date | null;
}

/** Die Sets im Blickfeld; Kaufpreis und Zustand stehen in den Erfassungen. */
export function setsZurBewertung(uids: number[]) {
  return db.all<BewertetesSet>(`SELECT s.set_number, c.name, c.year,
            ${mengeAus('sm', 0)}::int AS quantity,
            c.image_local, c.image_url, s.added_at
       FROM sets s
       LEFT JOIN set_catalog c ON c.set_number = s.set_number
       ${mengeJoin('s', 'sm', '= ANY($1)')}
      WHERE s.user_id = ANY($1)`, [uids]);
}

/** Katalogmerkmale (Gear, BrickLink-Art) vieler Sets; die Nummern tragen den Versionsanhang. */
export function katalogMerkmale(setNumbers: string[]) {
  return db.all<{ set_number: string; is_gear: boolean; bl_type: string | null; fetched_at: Date | null }>(
    'SELECT set_number, is_gear, bl_type, fetched_at FROM catalog_cache WHERE set_number = ANY($1)', [setNumbers]);
}

export interface ManuelleFigur {
  id: number; user_id: number; set_number: string | null; fig_number: string; bl_fig_number: string | null;
  quantity: number; source: string; storage_id: number | null;
  fig_name: string | null; image_url: string | null; image_local: string | null;
}

/** Manuell erfasste Figuren mit BrickLink-Nummer und Stückzahl aus den Erfassungen. */
export function manuelleFigurenZurBewertung(uids: number[]) {
  return db.all<ManuelleFigur>(`
    SELECT m.id, m.user_id, m.set_number, m.fig_number,
           ${blNummerSql('m.fig_number', 'blzf')} AS bl_fig_number,
           ${teilmengeAus('m', 'fig')} AS quantity,
           m.source, m.storage_id,
           mc.fig_name, mc.image_url, mc.image_local
      FROM minifigs m
      ${teilmengeJoin('m', 'fig')}
      ${blJoin('m.fig_number', 'fig', 'blzf')}
      LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
     WHERE m.user_id = ANY($1) AND m.source='manual'`, [uids]);
}

export interface ManuellesTeil {
  id: number; user_id: number; set_number: string | null; part_number: string; bl_part_number: string | null;
  color_id: number | null; quantity: number; source: string; storage_id: number | null; added_at: Date | null;
  part_name: string | null; category_name: string | null; color_name: string | null; color_hex: string | null;
  image_url: string | null; image_local: string | null;
}

/** Manuell erfasste Teile mit Beschreibung aus den Katalogen und Stückzahl aus den Erfassungen. */
export function manuelleTeileZurBewertung(uids: number[]) {
  return db.all<ManuellesTeil>(`
    SELECT p.id, p.user_id, p.set_number, p.part_number,
           ${blNummerSql('p.part_number')} AS bl_part_number,
           p.color_id,
           ${teilmengeAus('p', 'part')} AS quantity,
           p.source,
           p.storage_id, p.added_at,
           pc.part_name, pc.category_name,
           pcc.color_name, pcc.color_hex, pcc.image_url, pcc.image_local
      FROM parts p
      ${teilmengeJoin('p', 'part')}
      ${blJoin('p.part_number', 'part')}
      LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                      AND pcc.color_id    = p.color_id
     WHERE p.user_id = ANY($1) AND p.source = 'manual'`, [uids]);
}
