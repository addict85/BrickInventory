import { logAndContinue, meldeUndLiefere } from '../infra/httpError';
import { inventarNachKandidaten } from '../katalog/rbInventar';
import { nacharbeit } from '../auftraege/nacharbeit';
import * as repo from './repository/figurTeile';

export interface FigurTeil {
  part_number: string; bl_part_number: string; part_name: string | null; color_id: number;
  color_name: string | null; color_hex: string | null; is_spare: boolean; quantity: number;
}
export interface KatalogZeile { part_number: string; color_id: number; bl_part_number: string | null; image_url: string | null; image_local: string | null }

function katalog(figNumber: string): Promise<KatalogZeile[]> {
  return repo.katalogTeileDerFigur(figNumber);
}

/** Fehlen BrickLink-Nummern, wird vor der Antwort angereichert; die Bilder
 * lädt danach ein Nachlauf, damit die Antwort nicht auf sie wartet. */
export async function teileDerFigur(figNumber: string) {
  // Figuren haben keinen Versionsanhang, sondern ein 'fig-' davor.
  const invId = await inventarNachKandidaten([figNumber, figNumber.replace('fig-', '')])
    .catch(meldeUndLiefere('figuren:inventar', null));
  if (!invId) return { parts: [], source: 'not_found' };

  const teile = await repo.inventarTeileDerFigur(invId);

  let kat = await katalog(figNumber);
  if (!kat.length || kat.some(r => !r.bl_part_number || r.bl_part_number === r.part_number)) {
    const elternSet = await repo.setMitFigur(figNumber).catch(meldeUndLiefere('figuren:elternset', undefined));
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
