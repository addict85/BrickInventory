/** Stammdaten, Teile- und Figurenliste eines Sets. */
import { proxyImageUrl } from '../images';
import { type RbSetTeil, firstBlNumber } from '../externalSources';
import { findSetInScope } from './erfassen';
import { istErsatzteil } from '../infra/validate';
import { withVersion, withoutVersion } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/setDetail';
import type { CatalogPart, ListenTeil, SetMaster } from './zeilen';
import { versuche, valueOr } from '../infra/ergebnis';
import { importParts } from './setInhaltImport';
import type { SetsContext } from './kontext';

/** Ohne Eintrag null. */
export async function setInfo(sk: SetsContext, setNumber: string): Promise<SetMaster | null> {
  return (await repo.setStamm(sk.db, withVersion(setNumber))) ?? null;
}

/** Was das fragende Konto über eine Nummer erfahren darf: Ein fremder Platzhalter
 * antwortet wie eine nie erfasste Nummer, sonst verriete er die Erfassung eines anderen. */
export async function setInfoForAccount(sk: SetsContext, uid: number, setNumber: string) {
  const n = withVersion(setNumber);
  const stamm = await setInfo(sk, n);
  const foreignPlaceholder = !!stamm?.platzhalter && !(await sk.images.setNumberInScope(uid, n));
  if (!stamm || foreignPlaceholder) return { set_number: n, name: n, im_katalog: false as const };
  const { platzhalter: _placeholder, ...row } = stamm;
  return { set_number: n, ...row, name: row.name || n, im_katalog: true as const };
}

function catalogOfSets(sk: SetsContext, setNumber: string): Promise<CatalogPart[]> {
  return repo.catalogPartsOfSets(sk.db, withVersion(setNumber));
}

/** Ungeblättert; die Seitenangaben stehen da, weil die App sie mit der Teileliste des Bestands teilt. */
const einePage = (n: number) => ({ total: n, page: 1, page_size: n });

export const SOURCE_DISRUPTED = 'quelle_gestoert';

export async function partListOfSets(sk: SetsContext, setNum: string, anreichern: (sn: string) => Promise<unknown>) {
  const n = withVersion(setNum),
    bare = withoutVersion(n);
  const invId = await sk.catalog.newestInventory(setNum);
  let teile: ListenTeil[] = [];
  let source = 'db';
  if (invId) {
    teile = await repo.inventoryPartsOfSets(sk.db, invId);
  }
  if (!teile.length) {
    source = 'api';
    // Ist Rebrickable gestört, sagt die Antwort das; eine leere Liste hiesse „das Set hat keine Teile“.
    const mit = await versuche('sets:alleTeileDesSets', sk.catalog.allSetParts(n));
    const rb = mit.ok && mit.wert ? mit : await versuche('sets:alleTeileDesSets', sk.catalog.allSetParts(bare));
    if (!rb.ok) return { parts: [], source: SOURCE_DISRUPTED, error: rb.fehler.grund, ...einePage(0) };
    teile = (rb.wert || []).map((r: RbSetTeil) => ({
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
  if (!teile.length) return { parts: [], source: 'not_found', ...einePage(0) };

  const katalog = new Map<string, CatalogPart>();
  const remember = (zeilen: CatalogPart[]) => {
    for (const r of zeilen) katalog.set(`${r.part_number}|${r.color_id}`, r);
  };
  remember(await catalogOfSets(sk, setNum));
  if (teile.some(p => !katalog.has(`${p.part_number}|${p.color_id}`))) {
    await versuche('sets:enrichSetParts', anreichern(setNum));
    remember(await catalogOfSets(sk, setNum));
  }

  // Schlüssel ist die Rebrickable-Nummer samt Farbe: Formvarianten teilen sich oft eine BrickLink-Nummer und
  // dürfen nicht verschmelzen.
  const zeilen = new Map<
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
  for (const p of teile) {
    const key = `${p.part_number}|${p.color_id}`;
    const cat = katalog.get(key);
    const menge = parseInt(String(p.total_quantity), 10) || 0;
    const bild = cat?.image_local || (cat?.image_url ? proxyImageUrl(cat.image_url) : null) || p.rb_image_url || null;
    const da = zeilen.get(key);
    if (da) {
      da.total_quantity += menge;
      continue;
    }
    zeilen.set(key, {
      part_number: p.part_number,
      bl_part_number: cat?.bl_part_number || p.bl_part_number || p.part_number,
      part_name: cat?.part_name || p.part_name || p.part_number,
      color_id: p.color_id,
      bl_color_id: p.bl_color_id ?? null,
      color_name: cat?.color_name || p.color_name || '',
      color_hex: cat?.color_hex || p.color_hex || null,
      image_url: bild,
      total_quantity: menge,
      is_spare: istErsatzteil(p.is_spare),
    });
  }
  await versuche(
    `sets:bilder einstellen ${setNum}`,
    sk.auftraege.placeJobOne('bilder', { set_number: setNum }, { schluessel: `bilder:${n}`, maxAttempts: 3 }),
  );
  return { parts: [...zeilen.values()], source, ...einePage(zeilen.size) };
}

/** Was nicht aus dem Katalog kam, schreibt ein Nachlauf hinein. */
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
    // Dieselbe Form wie eine Figur des Bestands, ohne Zustände und Besitzer.
    source: 'set',
    conditions: [] as string[],
    owners: [] as { id: number; username: string }[],
  });

  const katalog = await sk.catalog.minifigsFromCatalog(setNum);
  if (katalog.length) return { figs: katalog.map(output), source: 'catalog' };

  type Fig = { fig_number: string; fig_name: string | null; quantity: number; image_url: string | null };
  let figs: Fig[] = [];
  const invId = await sk.catalog.newestInventory(setNum);
  if (invId) {
    figs = await repo.inventoryMinifigsOfSets(sk.db, invId);
  }
  if (!figs.length) {
    const mit = await versuche('sets:getSetMinifigs', sk.externalSources.quellen.getSetMinifigs(n));
    const rb =
      mit.ok && mit.wert ? mit : await versuche('sets:getSetMinifigs', sk.externalSources.quellen.getSetMinifigs(bare));
    if (!rb.ok) return { figs: [], source: SOURCE_DISRUPTED, error: rb.fehler.grund };
    figs = rb.wert || [];
  }
  if (!figs.length) return { figs: [], source: 'not_found' };
  setImmediate(() => {
    void versuche('sets:figurenkatalog schreiben', storeSetMinifigs(sk, n, figs));
  });
  return { figs: figs.map(output), source: 'csv_cache' };
}

async function storeSetMinifigs(
  k: SetsContext,
  n: string,
  figs: Array<{ fig_number: string; fig_name: string | null; quantity: number; image_url: string | null }>,
) {
  for (const f of figs) {
    let bild = f.image_url || null;
    if (!bild)
      bild =
        valueOr(await versuche('sets:minifigur-info', k.externalSources.quellen.getMinifigInfo(f.fig_number)), null)
          ?.image_url || null;
    await k.catalog.rememberMinifig(f.fig_number, f.fig_name, bild);
    await k.catalog.merkeSetFiguren(n, [{ figNumber: f.fig_number, quantity: f.quantity }]);
  }
}

/** Nur zu Sets im Blickfeld und gedrosselt: Jeder Import kann Rebrickable-Kontingent kosten. */
export async function importPartsOfSets(sk: SetsContext, uid: number, sn: string): Promise<number> {
  const set = await findSetInScope(sk, uid, sn);
  if (!set) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
  const takt = await sk.konto.countRequest('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (takt.count > 30) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: takt.waitMin });
  return importParts(sk, set.set_number, set.owner_user_id);
}

/** Die Route kennt den Auftragsweg der Teile nicht; ohne Inventar reichert der Job-Prozess an. */
export function partListWithRework(sk: SetsContext, setNum: string) {
  return partListOfSets(sk, setNum, sn => sk.catalog.enrichSetPartsAn(sn));
}
