/**
 * Fachdienst Figuren: die Teile einer Figur aus der Rebrickable-CSV, mit
 * BrickLink-Nummern und Bildern aus dem gemeinsamen Katalog.
 */
import * as db from '../../db/database';
import { logAndContinue, meldeUndLiefere } from '../httpError';
import { ersatzteilSql } from '../validate';
import { inventarNachKandidaten } from '../rbInventar';
import { blJoin, blNummerSql } from '../blZuordnung';
import { nacharbeit } from '../nacharbeit';

interface FigurTeil {
  part_number: string; bl_part_number: string; part_name: string | null; color_id: number;
  color_name: string | null; color_hex: string | null; is_spare: boolean; quantity: number;
}
interface KatalogZeile { part_number: string; color_id: number; bl_part_number: string | null; image_url: string | null; image_local: string | null }

function katalog(figNumber: string): Promise<KatalogZeile[]> {
  return db.all<KatalogZeile>(
    `SELECT c.part_number, c.color_id, ${blNummerSql('c.part_number')} AS bl_part_number, c.image_url, c.image_local
       FROM set_parts_catalog c ${blJoin('c.part_number', 'part')}
      WHERE c.set_number = $1`, [figNumber]);
}

/**
 * Teile einer Figur. Fehlen BrickLink-Nummern, wird vor der Antwort
 * angereichert (die ganze Setliste der Figur auf einmal, sonst die Figur);
 * die Bilder lädt danach ein Nachlauf.
 */
export async function teileDerFigur(figNumber: string) {
  // Figuren haben keinen Versionsanhang, sondern ein 'fig-' davor.
  const invId = await inventarNachKandidaten([figNumber, figNumber.replace('fig-', '')])
    .catch(meldeUndLiefere('figuren:inventar', null));
  if (!invId) return { parts: [], source: 'not_found' };

  const teile = await db.all<FigurTeil>(
    `SELECT ip.part_num AS part_number, COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
            p.name AS part_name, ip.color_id, c.name AS color_name, c.rgb AS color_hex,
            ${ersatzteilSql('ip.is_spare')} AS is_spare, ip.quantity
       FROM rb_inventory_parts ip
       LEFT JOIN rb_parts  p ON p.part_num = ip.part_num
       LEFT JOIN rb_colors c ON c.id       = ip.color_id
       LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = ip.part_num
      WHERE ip.inventory_id = $1`, [invId]);

  let kat = await katalog(figNumber);
  if (!kat.length || kat.some(r => !r.bl_part_number || r.bl_part_number === r.part_number)) {
    const elternSet = await db.get<{ set_number: string }>('SELECT set_number FROM set_figuren WHERE fig_number=$1 LIMIT 1',
      [figNumber]).catch(meldeUndLiefere('figuren:elternset', undefined));
    if (elternSet) await nacharbeit().figurenAnreichern(elternSet.set_number).catch(logAndContinue('figuren:enrichSetMinifigs'));
    else await nacharbeit().setTeileAnreichern(figNumber).catch(logAndContinue('figuren:enrichSetParts'));
    kat = await katalog(figNumber);
  }
  const jeTeil = new Map(kat.map(r => [`${r.part_number}|${r.color_id}`, r]));
  const parts = teile.map(p => {
    const k = jeTeil.get(`${p.part_number}|${p.color_id}`);
    return { ...p, bl_part_number: k?.bl_part_number || p.bl_part_number, image_url: k?.image_local || k?.image_url || null };
  });
  setImmediate(() => { nacharbeit().setBilderLaden(figNumber).catch(logAndContinue('figuren:downloadSetImages')); });
  return { parts, source: kat.length ? 'enriched' : 'csv_cache' };
}
