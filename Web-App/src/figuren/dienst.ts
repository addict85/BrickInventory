import { logAndContinue } from '../infra/fehler';
import type { KatalogZeile } from './zeilen';
import type { FigurenKontext } from './kontext';
export type { FigurTeil, KatalogZeile } from './zeilen';

function katalogTeile(k: FigurenKontext, figNumber: string): Promise<KatalogZeile[]> {
  return k.figurTeile.katalogTeileDerFigur(figNumber);
}

/** Fehlen BrickLink-Nummern, wird vor der Antwort angereichert; die Bilder
 * lädt danach ein Nachlauf, damit die Antwort nicht auf sie wartet. */
export async function teileDerFigur(kx: FigurenKontext, figNumber: string) {
  // Figuren haben keinen Versionsanhang, sondern ein 'fig-' davor.
  // Ein Lesefehler ist nicht „unbekannte Figur“ (not_found): Er geht weiter.
  const invId = await kx.katalog.inventarFuerKandidaten([figNumber, figNumber.replace('fig-', '')]);
  if (!invId) return { parts: [], source: 'not_found' };

  const teile = await kx.figurTeile.inventarTeileDerFigur(invId);

  let kat = await katalogTeile(kx, figNumber);
  if (!kat.length || kat.some(r => !r.bl_part_number || r.bl_part_number === r.part_number)) {
    const elternSet = await kx.figurTeile.setMitFigur(figNumber);
    if (elternSet)
      await kx.nacharbeit.figurenAnreichern(elternSet.set_number).catch(logAndContinue('figuren:enrichSetMinifigs'));
    else await kx.nacharbeit.setTeileAnreichern(figNumber).catch(logAndContinue('figuren:enrichSetParts'));
    kat = await katalogTeile(kx, figNumber);
  }
  const jeTeil = new Map(kat.map(r => [`${r.part_number}|${r.color_id}`, r]));
  const parts = teile.map(p => {
    const k = jeTeil.get(`${p.part_number}|${p.color_id}`);
    return {
      ...p,
      bl_part_number: k?.bl_part_number || p.bl_part_number,
      image_url: k?.image_local || k?.image_url || null,
    };
  });
  setImmediate(() => {
    kx.nacharbeit.setBilderLaden(figNumber).catch(logAndContinue('figuren:downloadSetImages'));
  });
  return { parts, source: kat.length ? 'enriched' : 'csv_cache' };
}
