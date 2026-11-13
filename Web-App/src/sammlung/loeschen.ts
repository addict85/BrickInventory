/** Eine Stelle für Teil, Figur und „alles löschen", damit alle Wege dieselben
 * Zeilen in den Papierkorb nehmen. */
import { legeInPapierkorb, loescheManuellesTeil, loescheManuelleFigur } from '../bestand';
import * as repo from './repository/loeschen';
import type { SammlungKontext } from './kontext';

export async function loescheTeil(
  k: SammlungKontext,
  besitzer: number,
  pn: string,
  cid: number,
): Promise<number | null> {
  return k.transaktion(async t => {
    const id = await legeInPapierkorb(t.db, 'teil', besitzer, pn, cid);
    const r = await loescheManuellesTeil(t.db, besitzer, pn, cid);
    if (r.changes === 0) return null;
    // Erfassungen mit: Die Finanzsummen zählten das Teil sonst weiter.
    await repo.loescheTeilErfassungen(t.db, besitzer, pn, cid || 0);
    return id;
  });
}

export async function loescheFigur(k: SammlungKontext, besitzer: number, fn: string): Promise<number | null> {
  return k.transaktion(async t => {
    const id = await legeInPapierkorb(t.db, 'figur', besitzer, fn);
    const r = await loescheManuelleFigur(t.db, besitzer, fn);
    if (r.changes === 0) return null;
    await repo.loescheFigurErfassungen(t.db, besitzer, fn);
    return id;
  });
}

/** Nur das EIGENE Konto, nie das Blickfeld. Jedes Element einzeln, damit jedes
 * einzeln wiederherstellbar ist. */
export async function loescheAllesEigene(k: SammlungKontext, uid: number) {
  const sets = await k.loeschen.setsDesKontos(uid);
  const teile = await k.loeschen.manuelleTeileDesKontos(uid);
  const figuren = await k.loeschen.manuelleFigurenDesKontos(uid);
  const papierkorb: number[] = [];
  const n = { sets: 0, teile: 0, figuren: 0 };
  for (const s of sets) {
    const ids = await k.sets.loescheSet([uid], s.set_number);
    if (ids) {
      papierkorb.push(...ids);
      n.sets++;
    }
  }
  for (const t of teile) {
    const id = await loescheTeil(k, uid, t.part_number, t.color_id);
    if (id !== null) {
      papierkorb.push(id);
      n.teile++;
    }
  }
  for (const f of figuren) {
    const id = await loescheFigur(k, uid, f.fig_number);
    if (id !== null) {
      papierkorb.push(id);
      n.figuren++;
    }
  }
  return { ...n, papierkorb };
}
