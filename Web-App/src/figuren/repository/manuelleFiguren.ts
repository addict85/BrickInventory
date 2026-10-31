import * as db from '../../../db/database';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';

/**
 * Datenzugriff für manuell erfasste Minifiguren — Zwilling zu den Teilen
 * (src/teile/repository/manuelleTeile.ts). Die BrickLink-Nummer hängt an der
 * Figur (bl_zuordnung, Migration 0037), nicht am Exemplar.
 */

export function figurZeileManuell(uid: number, figNumber: string): Promise<{ id: number } | undefined> {
  return db.get("SELECT id FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'", [uid, figNumber]);
}

export function figurZeileMitZustand(uid: number, figNumber: string) {
  return db.get<{ id: number; bl_fig_number: string | null; condition: string | null }>(
    `SELECT m.id, ${blNummerSql('m.fig_number', 'z')} AS bl_fig_number,
            (SELECT a.condition FROM minifig_acquisitions a
              WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS condition
       FROM minifigs m
       ${blJoin('m.fig_number', 'fig', 'z')}
      WHERE m.user_id=$1 AND m.fig_number=$2 AND m.source='manual'`, [uid, figNumber]);
}

/** Ohne Menge: Sie entsteht aus der ersten Erfassung. */
export async function legeFigurManuellAn(uid: number, figNumber: string): Promise<void> {
  await db.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source)
                VALUES ($1, NULL, $2, 'manual') ON CONFLICT DO NOTHING`, [uid, figNumber]);
}

const NEUESTE = `(SELECT a.id FROM minifig_acquisitions a
                   WHERE a.user_id=$2 AND a.fig_number=$3
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`;

export async function setzeFigurpreisNeueste(uid: number, figNumber: string, preis: number | null): Promise<void> {
  await db.run(`UPDATE minifig_acquisitions SET unit_price = NULLIF($1::numeric, 0) WHERE id = ${NEUESTE}`,
    [preis, uid, figNumber]);
}

export async function setzeFigurzustandNeueste(uid: number, figNumber: string, zustand: string): Promise<void> {
  await db.run(`UPDATE minifig_acquisitions SET condition=$1 WHERE id = ${NEUESTE}`, [zustand, uid, figNumber]);
}

export function figurErfassungen(uids: number[], figNumber: string) {
  return db.all(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition, a.price_estimated, a.currency,
            a.created_at, a.user_id AS owner_user_id
     FROM minifig_acquisitions a
     WHERE a.user_id = ANY($1) AND a.fig_number=$2
     ORDER BY a.created_at ASC, a.id ASC`, [uids, figNumber]);
}
