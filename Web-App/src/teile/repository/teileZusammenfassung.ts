import * as db from '../../../db/database';
import type { DbSchnittstelle } from '../../../db/database';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../../../db/bestandsmenge';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';
import { teilSichtJoin, TEIL } from '../../../db/katalogSicht';
import { LOCKS } from '../../infra/lockNamespaces';

/** Stand der Rohdaten eines Kontos und ob Katalogänderungen offen sind (Migration 0079). */
export async function rohstand(userId: number): Promise<{ v: number; katalogOffen: boolean }> {
  const r = await db.get<{ v: number | null; katalog_offen: boolean }>(
    `SELECT (SELECT v FROM parts_version_user WHERE user_id = $1) AS v,
            EXISTS (SELECT 1 FROM parts_katalog_offen) AS katalog_offen`, [userId]);
  return { v: Number(r?.v) || 0, katalogOffen: !!r?.katalog_offen };
}

export async function gebauterStand(userId: number): Promise<number | null> {
  const r = await db.get<{ built_version: number }>('SELECT built_version FROM parts_summary_state WHERE user_id = $1', [userId]);
  return r ? Number(r.built_version) : null;
}

/** Dieselbe Abfrage für den vollen Aufbau und das Nachziehen, damit beide
 * nicht auseinanderlaufen. */
function zusammenfassungEinfuegen(nurGruppen: boolean): string {
  return `
      INSERT INTO parts_summary (user_id, part_key, color_id, part_number, bl_part_number,
        part_name, color_name, color_hex, category_name, image_url, image_local,
        is_spare, total_quantity, in_sets, storage)
      SELECT p.user_id,
             -- Gruppiert wird nach der BrickLink-Nummer, soweit eine abweicht.
             ${blNummerSql('p.part_number')},
             p.color_id,
             MIN(p.part_number), MIN(${blNummerSql('p.part_number')}),
             MIN(${TEIL.name}), MIN(${TEIL.farbname}), MIN(${TEIL.farbcode}), MIN(${TEIL.kategorie}),
             MIN(${TEIL.bild}), MIN(${TEIL.bildDatei}),
             -- Ersatzteil ist eine Angabe der Setliste; dasselbe Teil kann in
             -- einem Set Ersatz und im nächsten Pflicht sein.
             bool_or(COALESCE(tm_k.is_spare, false)),
             SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}),
             STRING_AGG(DISTINCT p.set_number, ','),
             -- Alle Lagerorte der Gruppe: Dasselbe Teil liegt aus mehreren Sets in verschiedenen Kisten.
             NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '')
        FROM parts p
        ${mengeJoin('p', 'sm', '= $1')}
        ${teilmengeJoin('p', 'part', 'tm', '= $1')}
        ${blJoin('p.part_number', 'part')}
        LEFT JOIN storage_locations lo ON lo.id = p.storage_id
        ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
       WHERE p.user_id = $1 AND COALESCE(p.source, 'set') <> 'manual'${nurGruppen ? `
         AND ${blNummerSql('p.part_number')} = ANY($2)` : ''}
       GROUP BY p.user_id, ${blNummerSql('p.part_number')}, p.color_id`;
}

export async function sperreKonto(tx: DbSchnittstelle, userId: number): Promise<boolean> {
  return !!(await tx.get<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', [LOCKS.TEILE_SUMMARY, userId]))?.ok;
}

/** Dieselbe Sperre, aber wartend: Ein laufender Neuaufbau wird abgewartet. */
export async function warteAufKonto(tx: DbSchnittstelle, userId: number): Promise<void> {
  await tx.get('SELECT pg_advisory_xact_lock($1, $2)', [LOCKS.TEILE_SUMMARY, userId]);
}

export async function baueNeu(tx: DbSchnittstelle, userId: number, stand: number): Promise<void> {
  await tx.run('DELETE FROM parts_summary WHERE user_id = $1', [userId]);
  await tx.run(zusammenfassungEinfuegen(false), [userId]);
  await tx.run(`
      INSERT INTO parts_summary_state (user_id, built_version, built_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET built_version = $2, built_at = NOW()`, [userId, stand]);
}

export async function baueGruppenNeu(tx: DbSchnittstelle, userId: number, gruppen: string[]): Promise<void> {
  await tx.run('DELETE FROM parts_summary WHERE user_id = $1 AND part_key = ANY($2)', [userId, gruppen]);
  await tx.run(zusammenfassungEinfuegen(true), [userId, gruppen]);
}

export function analysiere() {
  return db.exec('ANALYZE parts_summary');
}

export async function sperreKatalogNachzug(tx: DbSchnittstelle): Promise<boolean> {
  return !!(await tx.get<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1, 0) AS ok', [LOCKS.TEILE_KATALOG]))?.ok;
}

/** Was danach eintrifft, bleibt für den nächsten Lauf. */
export async function holeOffeneNummern(tx: DbSchnittstelle): Promise<string[]> {
  return [...new Set((await tx.all<{ nummer: string }>('DELETE FROM parts_katalog_offen RETURNING nummer')).map(r => r.nummer))];
}

/** Alle Stände verwerfen: Jedes Konto baut beim nächsten Lesen neu. */
export async function verwirfAlleStaende(tx: DbSchnittstelle): Promise<number> {
  return (await tx.run('DELETE FROM parts_summary_state')).changes ?? 0;
}

/** Vorher wie nachher: Eine neue Zuordnung verschiebt ein Teil in eine andere Gruppe. */
export function betroffeneGruppen(tx: DbSchnittstelle, nummern: string[]) {
  return tx.all<{ user_id: number; part_key: string }>(`
      SELECT DISTINCT p.user_id, ${blNummerSql('p.part_number')} AS part_key
        FROM parts p
        ${blJoin('p.part_number', 'part')}
        JOIN parts_summary_state st ON st.user_id = p.user_id
       WHERE COALESCE(p.source, 'set') <> 'manual'
         AND (p.part_number = ANY($1) OR ${blNummerSql('p.part_number')} = ANY($1))
      UNION
      SELECT user_id, part_key FROM parts_summary WHERE part_key = ANY($1) OR part_number = ANY($1)`, [nummern]);
}
