/** Eine Stelle für Teil, Figur und „alles löschen", damit alle Wege dieselben
 * Zeilen in den Papierkorb nehmen. */
import { legeInPapierkorb } from '../bestand/papierkorb';
import { loescheManuellesTeil, loescheManuelleFigur } from '../bestand/gemeinsam';
import { deleteSet } from '../sets';
import * as repo from './repository/loeschen';
import { sammlungBereich } from './prozess';

export async function loescheTeil(besitzer: number, pn: string, cid: number): Promise<number | null> {
  return sammlungBereich().db.transaction(async (tx) => {
    const id = await legeInPapierkorb(tx, 'teil', besitzer, pn, cid);
    const r = await loescheManuellesTeil(tx, besitzer, pn, cid);
    if (r.changes === 0) return null;
    // Erfassungen mit: Die Finanzsummen zählten das Teil sonst weiter.
    await repo.loescheTeilErfassungen(tx, besitzer, pn, cid || 0);
    return id;
  });
}

export async function loescheFigur(besitzer: number, fn: string): Promise<number | null> {
  return sammlungBereich().db.transaction(async (tx) => {
    const id = await legeInPapierkorb(tx, 'figur', besitzer, fn);
    const r = await loescheManuelleFigur(tx, besitzer, fn);
    if (r.changes === 0) return null;
    await repo.loescheFigurErfassungen(tx, besitzer, fn);
    return id;
  });
}

/** Nur das EIGENE Konto, nie das Blickfeld. Jedes Element einzeln, damit jedes
 * einzeln wiederherstellbar ist. */
export async function loescheAllesEigene(uid: number) {
  const sets = await sammlungBereich().loeschen.setsDesKontos(uid);
  const teile = await sammlungBereich().loeschen.manuelleTeileDesKontos(uid);
  const figuren = await sammlungBereich().loeschen.manuelleFigurenDesKontos(uid);
  const papierkorb: number[] = [];
  const n = { sets: 0, teile: 0, figuren: 0 };
  for (const s of sets) {
    const ids = await deleteSet([uid], s.set_number);
    if (ids) { papierkorb.push(...ids); n.sets++; }
  }
  for (const t of teile) {
    const id = await loescheTeil(uid, t.part_number, t.color_id);
    if (id !== null) { papierkorb.push(id); n.teile++; }
  }
  for (const f of figuren) {
    const id = await loescheFigur(uid, f.fig_number);
    if (id !== null) { papierkorb.push(id); n.figuren++; }
  }
  return { ...n, papierkorb };
}
