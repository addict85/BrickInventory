/** One place for part, minifig and "delete everything", so every path puts the
 * same rows in the trash. */
import type { CollectionContext } from './context';

export async function loescheTeil(
  k: CollectionContext,
  besitzer: number,
  pn: string,
  cid: number,
): Promise<number | null> {
  return k.transaktion(async t => {
    const id = await t.bestand.legeInPapierkorb('teil', besitzer, pn, cid);
    const r = await t.bestand.loescheManuell('part', besitzer, [pn, cid]);
    return r.changes === 0 ? null : id;
  });
}

export async function loescheFigur(k: CollectionContext, besitzer: number, fn: string): Promise<number | null> {
  return k.transaktion(async t => {
    const id = await t.bestand.legeInPapierkorb('figur', besitzer, fn);
    const r = await t.bestand.loescheManuell('fig', besitzer, [fn]);
    return r.changes === 0 ? null : id;
  });
}

/** Only the account's OWN, never the viewing scope. Each item one at a time, so
 * each can be restored on its own. */
export async function loescheAllesEigene(k: CollectionContext, uid: number) {
  const sets = await k.sets.setsDesKontos(uid);
  const teile = await k.bestand.manuell.teileDesKontos(uid);
  const minifigs = await k.bestand.manuell.figurenDesKontos(uid);
  const papierkorb: number[] = [];
  // Field names below (sets, teile, figuren) are the API contract (src/vertrag/bestand.ts)
  // and stay as-is.
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
  for (const f of minifigs) {
    const id = await loescheFigur(k, uid, f.fig_number);
    if (id !== null) {
      papierkorb.push(id);
      n.figuren++;
    }
  }
  return { ...n, papierkorb };
}
