import type { DbInterface } from '../../../db/database';
import { purchasePriceColumns } from '../../../db/geldSql';
import { mengeAus, subsetFrom } from '../../../db/stockQuantity';
import type { FinancesReadContract } from '../readContract';
import { blJoin, blNumberSql } from '../../../db/blMappingSql';
import { teilSichtJoin, minifigViewJoin, setMasterJoin, TEIL, MINIFIG, SET } from '../../../db/catalogView';

/** An acquisition of a manual part or a figure, purchase price in the account currency. */
export interface ManualEntry {
  id: number;
  user_id: number;
  part_number?: string;
  color_id?: number | null;
  fig_number?: string;
  quantity: number;
  unit_price: string | null;
  kaufpreis_fremd: boolean;
  kaufpreis_umgerechnet: boolean;
  currency: string;
  price_estimated: boolean;
  condition: string;
  created_at: Date;
}

export function manualEntries(
  db: DbInterface,
  l: FinancesReadContract,
  art: 'part' | 'fig',
  uids: number[],
  currency: string,
) {
  return db.all<ManualEntry>(
    art === 'part'
      ? `SELECT id, user_id, part_number, color_id, quantity,
              ${purchasePriceColumns('unit_price', '$2')}, currency, price_estimated,
              COALESCE(condition,'N') AS condition, created_at
         FROM ${l.teilErfassungen('= ANY($1)')} e ORDER BY created_at ASC, id ASC`
      : `SELECT id, user_id, fig_number, quantity,
              ${purchasePriceColumns('unit_price', '$2')}, currency, price_estimated,
              COALESCE(condition,'N') AS condition, created_at
         FROM ${l.figurErfassungen('= ANY($1)')} e ORDER BY created_at ASC, id ASC`,
    [uids, currency],
  );
}

export interface ValuedSet {
  user_id: number;
  set_number: string;
  name: string | null;
  year: number | null;
  quantity: number;
  image_local: string | null;
  image_url: string | null;
  added_at: Date | null;
}

/** Purchase price and condition are stored in the acquisitions. */
export function setsToValuation(db: DbInterface, l: FinancesReadContract, uids: number[]) {
  return db.all<ValuedSet>(
    `SELECT s.user_id, s.set_number, ${SET.name} AS name, ${SET.jahr} AS year,
            ${mengeAus('sm', 0)}::int AS quantity,
            c.image_local, c.image_url, s.added_at
       FROM ${l.setBestand('= ANY($1)')} s
       LEFT JOIN set_catalog c ON c.set_number = s.set_number
       ${setMasterJoin('s.set_number')}
       ${l.mengeJoin('s', 'sm', '= ANY($1)')}
      WHERE s.user_id = ANY($1)`,
    [uids],
  );
}

/** The numbers carry the version suffix. */
export function catalogFeatures(db: DbInterface, setNumbers: string[]) {
  return db.all<{ set_number: string; is_gear: boolean; bl_type: string | null; fetched_at: Date | null }>(
    'SELECT set_number, is_gear, bl_type, fetched_at FROM catalog_cache WHERE set_number = ANY($1)',
    [setNumbers],
  );
}

export interface ManuelleFigur {
  id: number;
  user_id: number;
  set_number: string | null;
  fig_number: string;
  bl_fig_number: string | null;
  quantity: number;
  source: string;
  storage_id: number | null;
  fig_name: string | null;
  image_url: string | null;
  image_local: string | null;
}

export function manualMinifigsToValuation(db: DbInterface, l: FinancesReadContract, uids: number[]) {
  return db.all<ManuelleFigur>(
    `
    SELECT m.id, m.user_id, m.set_number, m.fig_number,
           ${blNumberSql('m.fig_number', 'blzf')} AS bl_fig_number,
           ${subsetFrom('m', 'fig')} AS quantity,
           m.source, m.storage_id,
           ${MINIFIG.name} AS fig_name, ${MINIFIG.bild} AS image_url, ${MINIFIG.bildDatei} AS image_local
      FROM ${l.figurBestand('= ANY($1)')} m
      ${l.teilmengeJoin('m', 'fig')}
      ${blJoin('m.fig_number', 'fig', 'm.user_id', 'blzf')}
      ${minifigViewJoin('m.user_id', 'm.fig_number')}
     WHERE m.user_id = ANY($1) AND m.source='manual'`,
    [uids],
  );
}

export interface ManuellesTeil {
  id: number;
  user_id: number;
  set_number: string | null;
  part_number: string;
  bl_part_number: string | null;
  color_id: number | null;
  quantity: number;
  source: string;
  storage_id: number | null;
  added_at: Date | null;
  part_name: string | null;
  category_name: string | null;
  color_name: string | null;
  color_hex: string | null;
  image_url: string | null;
  image_local: string | null;
}

export function manualPartsToValuation(db: DbInterface, l: FinancesReadContract, uids: number[]) {
  return db.all<ManuellesTeil>(
    `
    SELECT p.id, p.user_id, p.set_number, p.part_number,
           ${blNumberSql('p.part_number')} AS bl_part_number,
           p.color_id,
           ${subsetFrom('p', 'part')} AS quantity,
           p.source,
           p.storage_id, p.added_at,
           ${TEIL.name} AS part_name, ${TEIL.kategorie} AS category_name,
           ${TEIL.farbname} AS color_name, ${TEIL.farbcode} AS color_hex,
           ${TEIL.bild} AS image_url, ${TEIL.bildDatei} AS image_local
      FROM ${l.teilBestand('= ANY($1)')} p
      ${l.teilmengeJoin('p', 'part')}
      ${blJoin('p.part_number', 'part', 'p.user_id')}
      ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
     WHERE p.user_id = ANY($1) AND p.source = 'manual'`,
    [uids],
  );
}
