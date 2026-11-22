/** Master data, parts and figure list of a set. */
import { proxyImageUrl } from '../images';
import { type RbSetTeil, firstBlNumber } from '../externalSources';
import { findSetInScope } from './addSet';
import { isSparePart } from '../infra/validate';
import { withVersion, withoutVersion } from '../infra/setNumber';
import { failDomain } from '../infra/errorTexts';
import * as repo from './repository/setDetail';
import type { CatalogPart, ListenTeil, SetMaster } from './rows';
import { attempts, valueOr } from '../infra/result';
import { importParts } from './setContentImport';
import type { SetsContext } from './context';

/** null without an entry. */
export async function setInfo(sk: SetsContext, setNumber: string): Promise<SetMaster | null> {
  return (await repo.setMaster(sk.db, withVersion(setNumber))) ?? null;
}

/** What the asking account may learn about a number: a foreign placeholder
 * answers like a never captured number, otherwise it would reveal another account's acquisition. */
export async function setInfoForAccount(sk: SetsContext, uid: number, setNumber: string) {
  const n = withVersion(setNumber);
  const master = await setInfo(sk, n);
  const foreignPlaceholder = !!master?.platzhalter && !(await sk.images.setNumberInScope(uid, n));
  if (!master || foreignPlaceholder) return { set_number: n, name: n, im_katalog: false as const };
  const { platzhalter: _placeholder, ...row } = master;
  return { set_number: n, ...row, name: row.name || n, im_katalog: true as const };
}

function catalogOfSets(sk: SetsContext, setNumber: string): Promise<CatalogPart[]> {
  return repo.catalogPartsOfSets(sk.db, withVersion(setNumber));
}

/** Unpaged; the page fields are there because the app shares them with the inventory's parts list. */
const einePage = (n: number) => ({ total: n, page: 1, page_size: n });

export const SOURCE_DISRUPTED = 'quelle_gestoert';

export async function partListOfSets(sk: SetsContext, setNum: string, enrich: (sn: string) => Promise<unknown>) {
  const n = withVersion(setNum),
    bare = withoutVersion(n);
  const invId = await sk.catalog.newestInventory(setNum);
  let parts: ListenTeil[] = [];
  let source = 'db';
  if (invId) {
    parts = await repo.inventoryPartsOfSets(sk.db, invId);
  }
  if (!parts.length) {
    source = 'api';
    // If Rebrickable is disrupted, the response says so; an empty list would mean "the set has no parts".
    const fetched = await attempts('sets:alleTeileDesSets', sk.catalog.allSetParts(n));
    const rb =
      fetched.ok && fetched.wert ? fetched : await attempts('sets:alleTeileDesSets', sk.catalog.allSetParts(bare));
    if (!rb.ok) return { parts: [], source: SOURCE_DISRUPTED, error: rb.fehler.grund, ...einePage(0) };
    parts = (rb.wert || []).map((r: RbSetTeil) => ({
      part_number: r.part.part_num,
      bl_part_number: firstBlNumber(r.part.external_ids) || r.part.part_num,
      part_name: r.part.name || r.part.part_num,
      color_id: r.color.id,
      color_name: r.color.name || '',
      color_hex: r.color.rgb || null,
      rb_image_url: r.part.part_img_url || null,
      total_quantity: r.quantity,
      is_spare: !!r.is_spare,
    }));
  }
  if (!parts.length) return { parts: [], source: 'not_found', ...einePage(0) };

  const catalog = new Map<string, CatalogPart>();
  const remember = (rows: CatalogPart[]) => {
    for (const r of rows) catalog.set(`${r.part_number}|${r.color_id}`, r);
  };
  remember(await catalogOfSets(sk, setNum));
  if (parts.some(p => !catalog.has(`${p.part_number}|${p.color_id}`))) {
    await attempts('sets:enrichSetParts', enrich(setNum));
    remember(await catalogOfSets(sk, setNum));
  }

  // The key is the Rebrickable number including color: mold variants often share a BrickLink number and
  // must not merge.
  const rows = new Map<
    string,
    {
      part_number: string;
      bl_part_number: string;
      part_name: string;
      color_id: number;
      bl_color_id: number | null;
      color_name: string;
      color_hex: string | null;
      image_url: string | null;
      total_quantity: number;
      is_spare: boolean;
    }
  >();
  for (const p of parts) {
    const key = `${p.part_number}|${p.color_id}`;
    const cat = catalog.get(key);
    const menge = parseInt(String(p.total_quantity), 10) || 0;
    const image = cat?.image_local || (cat?.image_url ? proxyImageUrl(cat.image_url) : null) || p.rb_image_url || null;
    const da = rows.get(key);
    if (da) {
      da.total_quantity += menge;
      continue;
    }
    rows.set(key, {
      part_number: p.part_number,
      bl_part_number: cat?.bl_part_number || p.bl_part_number || p.part_number,
      part_name: cat?.part_name || p.part_name || p.part_number,
      color_id: p.color_id,
      bl_color_id: p.bl_color_id ?? null,
      color_name: cat?.color_name || p.color_name || '',
      color_hex: cat?.color_hex || p.color_hex || null,
      image_url: image,
      total_quantity: menge,
      is_spare: isSparePart(p.is_spare),
    });
  }
  await attempts(
    `sets:bilder einstellen ${setNum}`,
    sk.jobQueue.placeJobOne('bilder', { set_number: setNum }, { schluessel: `bilder:${n}`, maxAttempts: 3 }),
  );
  return { parts: [...rows.values()], source, ...einePage(rows.size) };
}

/** Whatever did not come from the catalog is written in by a follow-up run. */
export async function minifigsListOfSets(sk: SetsContext, setNum: string) {
  const n = withVersion(setNum),
    bare = withoutVersion(n);
  const output = (f: {
    fig_number: string;
    fig_name?: string | null;
    quantity?: number | null;
    image_url?: string | null;
  }) => ({
    fig_number: f.fig_number,
    fig_name: f.fig_name || f.fig_number,
    quantity: f.quantity || 1,
    total_quantity: f.quantity || 1,
    image_url: proxyImageUrl(f.image_url),
    // The same shape as a figure of the inventory, without conditions and owners.
    source: 'set',
    conditions: [] as string[],
    owners: [] as { id: number; username: string }[],
  });

  const catalog = await sk.catalog.minifigsFromCatalog(setNum);
  if (catalog.length) return { figs: catalog.map(output), source: 'catalog' };

  type Fig = { fig_number: string; fig_name: string | null; quantity: number; image_url: string | null };
  let figs: Fig[] = [];
  const invId = await sk.catalog.newestInventory(setNum);
  if (invId) {
    figs = await repo.inventoryMinifigsOfSets(sk.db, invId);
  }
  if (!figs.length) {
    const fetched = await attempts('sets:getSetMinifigs', sk.externalSources.quellen.getSetMinifigs(n));
    const rb =
      fetched.ok && fetched.wert
        ? fetched
        : await attempts('sets:getSetMinifigs', sk.externalSources.quellen.getSetMinifigs(bare));
    if (!rb.ok) return { figs: [], source: SOURCE_DISRUPTED, error: rb.fehler.grund };
    figs = rb.wert || [];
  }
  if (!figs.length) return { figs: [], source: 'not_found' };
  setImmediate(() => {
    void attempts('sets:figurenkatalog schreiben', storeSetMinifigs(sk, n, figs));
  });
  return { figs: figs.map(output), source: 'csv_cache' };
}

async function storeSetMinifigs(
  k: SetsContext,
  n: string,
  figs: Array<{ fig_number: string; fig_name: string | null; quantity: number; image_url: string | null }>,
) {
  for (const f of figs) {
    let image = f.image_url || null;
    if (!image)
      image =
        valueOr(await attempts('sets:minifigur-info', k.externalSources.quellen.getMinifigInfo(f.fig_number)), null)
          ?.image_url || null;
    await k.catalog.rememberMinifig(f.fig_number, f.fig_name, image);
    await k.catalog.merkeSetFiguren(n, [{ figNumber: f.fig_number, quantity: f.quantity }]);
  }
}

/** Only for sets in scope and throttled: every import can cost Rebrickable quota. */
export async function importPartsOfSets(sk: SetsContext, uid: number, sn: string): Promise<number> {
  const set = await findSetInScope(sk, uid, sn);
  if (!set) failDomain('nicht_gefunden', 'set_nicht_gefunden');
  const tick = await sk.account.countRequest('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (tick.count > 30) failDomain('zu_viele', 'zu_viele_anfragen', { minuten: tick.waitMin });
  return importParts(sk, set.set_number, set.owner_user_id);
}

/** The route does not know the parts' job path; without an inventory the job process enriches. */
export function partListWithRework(sk: SetsContext, setNum: string) {
  return partListOfSets(sk, setNum, sn => sk.catalog.enrichSetParts(sn));
}
