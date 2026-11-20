/** One place for part, minifig and "delete everything", so every path puts the
 * same rows in the trash. */
import type { CollectionContext } from './context';

export async function deletePart(
  k: CollectionContext,
  besitzer: number,
  pn: string,
  cid: number,
): Promise<number | null> {
  return k.transaktion(async t => {
    const id = await t.bestand.putInTrash('teil', besitzer, pn, cid);
    const r = await t.bestand.deleteManual('part', besitzer, [pn, cid]);
    return r.changes === 0 ? null : id;
  });
}

export async function deleteMinifig(k: CollectionContext, besitzer: number, fn: string): Promise<number | null> {
  return k.transaktion(async t => {
    const id = await t.bestand.putInTrash('figur', besitzer, fn);
    const r = await t.bestand.deleteManual('fig', besitzer, [fn]);
    return r.changes === 0 ? null : id;
  });
}

/** Only the account's OWN, never the viewing scope. Each item one at a time, so
 * each can be restored on its own. */
export async function deleteEverythingOwn(k: CollectionContext, uid: number) {
  const sets = await k.sets.setsOfAccount(uid);
  const teile = await k.bestand.manuell.partsOfAccount(uid);
  const minifigs = await k.bestand.manuell.minifigsOfAccount(uid);
  const papierkorb: number[] = [];
  // Field names below (sets, teile, figuren) are the API contract (src/vertrag/bestand.ts)
  // and stay as-is.
  const n = { sets: 0, teile: 0, figuren: 0 };
  for (const s of sets) {
    const ids = await k.sets.deleteSet([uid], s.set_number);
    if (ids) {
      papierkorb.push(...ids);
      n.sets++;
    }
  }
  for (const t of teile) {
    const id = await deletePart(k, uid, t.part_number, t.color_id);
    if (id !== null) {
      papierkorb.push(id);
      n.teile++;
    }
  }
  for (const f of minifigs) {
    const id = await deleteMinifig(k, uid, f.fig_number);
    if (id !== null) {
      papierkorb.push(id);
      n.figuren++;
    }
  }
  return { ...n, papierkorb };
}
