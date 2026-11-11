import { logAndContinue } from '../infra/fehler';
import { inventarFuerKandidaten } from '../katalog/rbInventar';
import { nacharbeit } from '../auftraege/nacharbeit';
import type { KatalogZeile } from './zeilen';
import { figurenBereich } from './prozess';
export type { FigurTeil, KatalogZeile } from './zeilen';


function katalogTeile(figNumber: string): Promise<KatalogZeile[]> {
  return figurenBereich().figurTeile.katalogTeileDerFigur(figNumber);
}

/** Fehlen BrickLink-Nummern, wird vor der Antwort angereichert; die Bilder
 * lädt danach ein Nachlauf, damit die Antwort nicht auf sie wartet. */
export async function teileDerFigur(figNumber: string) {
  // Figuren haben keinen Versionsanhang, sondern ein 'fig-' davor.
  // Ein Lesefehler ist nicht „unbekannte Figur“ (not_found): Er geht weiter.
  const invId = await inventarFuerKandidaten([figNumber, figNumber.replace('fig-', '')]);
  if (!invId) return { parts: [], source: 'not_found' };

  const teile = await figurenBereich().figurTeile.inventarTeileDerFigur(invId);

  let kat = await katalogTeile(figNumber);
  if (!kat.length || kat.some(r => !r.bl_part_number || r.bl_part_number === r.part_number)) {
    const elternSet = await figurenBereich().figurTeile.setMitFigur(figNumber);
    if (elternSet) await nacharbeit().figurenAnreichern(elternSet.set_number).catch(logAndContinue('figuren:enrichSetMinifigs'));
    else await nacharbeit().setTeileAnreichern(figNumber).catch(logAndContinue('figuren:enrichSetParts'));
    kat = await katalogTeile(figNumber);
  }
  const jeTeil = new Map(kat.map(r => [`${r.part_number}|${r.color_id}`, r]));
  const parts = teile.map(p => {
    const k = jeTeil.get(`${p.part_number}|${p.color_id}`);
    return { ...p, bl_part_number: k?.bl_part_number || p.bl_part_number, image_url: k?.image_local || k?.image_url || null };
  });
  setImmediate(() => { nacharbeit().setBilderLaden(figNumber).catch(logAndContinue('figuren:downloadSetImages')); });
  return { parts, source: kat.length ? 'enriched' : 'csv_cache' };
}
