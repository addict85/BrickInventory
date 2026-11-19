import * as repo from './repository/partsList';
import { blFarbnummerAus } from '../katalog';
import { resolveImageLocal } from '../bilder';
import { type RbSetTeil, ersteBlNummer } from '../fremdquellen';
import { asIds, type Sicht, type BlickfeldEingabe, type BlickfeldEingabe as Blickfeld } from '../haushalt';
import { istErsatzteil, colorId } from '../infra/validate';
import { summaryFresh } from './summary';
import { clampPageSize, MAX_PAGE_SIZE, UNPAGED_LIMIT, SET_PARTS_MAX_PAGE_SIZE } from '../bestand';
import { meldeFehler, logAndContinue } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { mitVersion, ohneVersion } from '../infra/setNummer';
import type { PartsContext } from './context';

/** With fallback levels (CSV cache, Rebrickable), so a set shows a parts list even
 * without its own rows. */

/** Without manual entries — those have their own view. Hex fallback from
 * rb_colors for parts without a value of their own. */
export async function partColorsQuery(k: PartsContext, userIdWahl: Sicht | Blickfeld) {
  const userId = await k.haushalt.blickfeldAus(userIdWahl);
  // asIds(), so older callers with a bare ID keep working.
  const uids = asIds(userId);
  // From the summary (quantities there are already multiplied by the set count);
  // strict, so the webapp and the app show the same numbers.
  return k.partsList.stockColors(uids, await summaryFresh(k, uids, { strict: true }));
}

function partsFilter(query: Record<string, unknown>): repo.PartsFilter {
  const text = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    color: text(query.color),
    category: text(query.category),
    search: text(query.search),
    spare: query.spare === '0' || query.spare === '1' ? query.spare : null,
    set_number: query.set_number ? mitVersion(String(query.set_number)) : null,
    storage: text(query.storage),
    // Manual parts have their own area, not in the set's parts list.
    ohneManuelle: query.exclude_manual === '1' || query.exclude_manual === true,
  };
}

// The local CSV catalog first (free), then the Rebrickable API (quota).
async function partsFallbackSource(k: PartsContext, set_number: string, ab: Abstriche) {
  // Rebrickable knows some sets only without the version suffix.
  const n = mitVersion(set_number),
    alt = ohneVersion(n);
  const invId = await ab.oder('katalog_inventar', k.katalog.neuestesInventar(set_number), null);
  if (invId) {
    const csvParts = await k.partsList.inventoryAsParts(invId, set_number);
    if (csvParts.length > 0)
      // page_size belongs on every return path: the client decides from it whether to
      // keep paging. Here everything comes at once, so it's the row count.
      return {
        parts: csvParts,
        total: csvParts.length,
        source: 'csv_cache',
        page_size: csvParts.length,
        ...ab.angabe(),
      };
  }

  // Fallback via runCatalogFollowUp-style lookups, only with a Rebrickable key.
  const rbKey = await k.einstellungen.globalValue('rebrickable_api_key');
  if (rbKey) {
    for (const sn of [n, alt]) {
      const items = await ab.oder('rebrickable_teile', k.katalog.alleSetTeile(sn), []);
      if (!items?.length) continue;
      const rbParts = items
        .filter((it: RbSetTeil) => !it.is_spare && it.part?.part_num)
        .map((it: RbSetTeil) => ({
          part_number: it.part?.part_num ?? '',
          bl_part_number: ersteBlNummer(it.part?.external_ids) || it.part?.part_num || null,
          part_name: it.part?.name || it.part?.part_num || null,
          color_id: it.color?.id ?? 0,
          color_name: it.color?.name || '',
          color_hex: it.color?.rgb || null,
          category_name: null,
          image_url: it.part?.part_img_url || null,
          image_local: null,
          is_spare: false,
          total_quantity: it.quantity,
          quantity: it.quantity,
          in_sets: set_number,
        }));
      if (rbParts.length)
        return {
          parts: rbParts,
          total: rbParts.length,
          source: 'rebrickable',
          page_size: rbParts.length,
          ...ab.angabe(),
        };
    }
  }

  return null;
}

/** Same on both paths, otherwise the webapp and the app would paginate differently. */
function resolvedPageSize(pageSize: unknown, mitSet: boolean): number {
  if (!pageSize) return UNPAGED_LIMIT;
  const obergrenze = mitSet ? SET_PARTS_MAX_PAGE_SIZE : MAX_PAGE_SIZE;
  return Math.min(obergrenze, Math.max(1, parseInt(String(pageSize), 10) || 100));
}

function partAsResponse(r: repo.PartRow) {
  // The Kotlin model carries is_spare as a boolean; a '0' would fail the whole page.
  return {
    ...r,
    total_quantity: parseInt(String(r.total_quantity), 10) || 0,
    is_spare: istErsatzteil(r.is_spare),
    image_local: resolveImageLocal(r.image_local) ?? null,
  };
}

export async function tryPartsSummary(k: PartsContext, userId: Blickfeld, o: Record<string, unknown>) {
  const uids = asIds(userId);
  // null means: the live query takes over. Fresh only if every account is.
  if (!(await summaryFresh(k, uids))) return null;
  const size = resolvedPageSize(o.page_size, !!o.set_number);
  const pg = Math.max(1, parseInt(String(o.page), 10) || 1);
  try {
    const { total, zeilen } = await k.partsList.pageFromSummary(uids, partsFilter(o), {
      groesse: size,
      versatz: (pg - 1) * size,
      mitSets: !!o.withSets,
      ordnung: repo.partsOrder(o.ordnung),
    });
    return { parts: zeilen.map(partAsResponse), total, source: 'summary', page_size: size };
  } catch (e) {
    // A fallback, not an error: as with staleness, the live query takes over.
    meldeFehler('parts:summary', e);
    return null;
  }
}

export async function partsQuery(k: PartsContext, userIdWahl: Sicht | Blickfeld, query: Record<string, unknown> = {}) {
  const userId = await k.haushalt.blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  const filter = partsFilter(query);
  const page = query.page ?? 1;
  // The sets per part are only needed by the detail view; they cost time and payload.
  const withSets = query.with_sets === '1' || query.with_sets === true;
  // Live with a set or storage filter: the summary only knows storage in
  // aggregate, and the filter makes the quantity small anyway.
  if (filter.ohneManuelle && !filter.set_number && !filter.storage) {
    const summary = await tryPartsSummary(k, uids, { ...query, page, withSets });
    if (summary) return summary;
  }
  const groesse = resolvedPageSize(query.page_size, !!filter.set_number);
  const versatz = (Math.max(1, parseInt(String(page), 10) || 1) - 1) * groesse;
  const [{ total, zeilen }, gebraucht] = await Promise.all([
    k.partsList.pageLive(uids, filter, {
      groesse,
      versatz,
      mitSets: withSets,
      ordnung: repo.partsOrder(query.ordnung),
    }),
    filter.ohneManuelle ? Promise.resolve([]) : k.partsList.usedManualParts(uids),
  ]);
  // One "used" acquisition makes the part used; without one, 'N'.
  const gebrauchtJe = new Set(gebraucht.filter(r => Number(r.any_used) > 0).map(r => `${r.pid}|${r.color_id}`));
  const parts = zeilen.map(p => ({
    ...partAsResponse(p),
    total_quantity: p.total_quantity,
    condition: gebrauchtJe.has(`${p.part_number}|${p.color_id}`) ? 'U' : 'N',
    image_url: p.image_url || null,
  }));

  // Fetch missing BrickLink numbers in the background; an empty bl_id means "already checked".
  setImmediate(async () => {
    try {
      if (await k.partsList.hasUnseenBlNumber(uids)) await k.katalog.blNummernNachladen();
    } catch (e) {
      meldeFehler('parts:bl-numbers-refresh', e);
    }
  });

  // An empty list after the fallback source fails is not "the set has no parts".
  const ab = new Abstriche();
  if (!parts.length && query.set_number) {
    const fallback = await partsFallbackSource(k, String(query.set_number), ab);
    if (fallback) return fallback;
  }
  return { parts, total, source: 'db', page_size: groesse, ...ab.angabe() };
}

/** The category from the own catalog, else from rb_parts: Rebrickable's set-parts
 * response usually has none, the list would otherwise consist of "Unknown". */
export async function partCategoriesQuery(k: PartsContext, userIdWahl: Sicht | Blickfeld) {
  const userId = await k.haushalt.blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  return k.partsList.categories(uids, await summaryFresh(k, uids, { strict: true }));
}

export async function partStatsQuery(k: PartsContext, userIdWahl: Sicht | Blickfeld) {
  const userId = await k.haushalt.blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  // From the summary only when it's fresh: the webapp and the app show the same numbers.
  if (await summaryFresh(k, uids, { strict: true })) {
    const r = await k.partsList.stats(uids, true);
    if (r) return r;
  }
  return (
    (await k.partsList.stats(uids, false)) ?? {
      unique_parts: 0,
      unique_colors: 0,
      total_parts: 0,
      manual_parts: 0,
    }
  );
}

export async function blColorMapQuery(k: PartsContext) {
  // farbkarte() caches the map for ten minutes.
  const karte = await k.finanzen.farbkarte();
  if (karte.size > 0) {
    const map: Record<string, unknown> = {};
    for (const [id, blId] of karte) map[id] = blId;
    return { map, source: 'db' };
  }
  const key = await k.fremdquellen.quellen.getRbKey();
  if (!key) return { map: {}, source: 'empty' };
  // If the fetch breaks off, the table is incomplete; `degradiert` says so.
  const ab = new Abstriche();
  // Typed, otherwise TypeScript would see `{}` as empty and `map[c.id] = …` as an error.
  let page = 1,
    map: Record<string, unknown> = {},
    hasNext = true;
  while (hasNext) {
    const { status, body } = await ab.oder(
      'rebrickable_farben',
      k.fremdquellen.quellen.httpsGetRobust(
        `https://rebrickable.com/api/v3/lego/colors/?page_size=200&page=${page}`,
        { Authorization: `key ${key}` },
        15000,
      ),
      { status: 0, body: '' },
    );
    if (status !== 200) break;
    const data = JSON.parse(body);
    for (const c of data.results || []) {
      const blId = blFarbnummerAus(c);
      if (blId != null) {
        map[c.id] = blId;
        k.katalog.merkeBlFarbnummer(c.id, blId).catch(logAndContinue('parts:merkeBlFarbnummer'));
      }
    }
    hasNext = !!data.next;
    page++;
  }
  return { map, source: 'api', ...ab.angabe() };
}

/** @param viewerId whose settings (currency) apply; `userId` says whose data is read.
 * @param search filter bar's search text, for both lists. */
export async function manualPartsList(
  k: PartsContext,
  userIdWahl: Sicht | Blickfeld,
  viewerId: number,
  {
    page = 1,
    page_size = null,
    search = null,
    storage = null,
  }: { page?: unknown; page_size?: unknown; search?: string | null; storage?: string | null } = {},
  ab = new Abstriche(),
) {
  const userId = await k.haushalt.blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  const groesse = page_size ? clampPageSize(page_size, 60) : null;
  const seite = groesse ? { groesse, versatz: (Math.max(1, parseInt(String(page), 10) || 1) - 1) * groesse } : null;
  const rows = await k.partsList.manualParts(uids, { search, storage }, seite);
  const mitZustand = await k.bestand.setzeManuellenZustand(uids, rows, 'part');
  // One query for the whole list; the app reads `avg_price` in the detail view. Without
  // prices the list stays usable; `ab` collects why for `degradiert`.
  const preise = await ab.oder(
    'marktpreise',
    k.finanzen.marktpreiseAusCacheFuerTeile(mitZustand, viewerId),
    new Map<string, number>(),
  );
  const mitPreis = mitZustand.map(t => ({ ...t, avg_price: preise.get(`${t.part_number}|${t.color_id}`) ?? null }));
  return k.haushalt.besitzerAnhaengen(uids, mitPreis);
}

// Fills the "Have" column from the stock.
export const MAX_OWNED_PARTS = 5000;

export async function ownedQuantitiesQuery(
  k: PartsContext,
  blickfeldWahl: Sicht | BlickfeldEingabe,
  teile: Array<{ part_number?: string | number | undefined; color_id?: number | string | null | undefined }>,
): Promise<Record<string, { gesamt: number; lose: number }>> {
  const uids = await k.haushalt.blickfeldAus(blickfeldWahl);
  // Duplicate keys drop out: a list spanning several sets would otherwise ask
  // for the same part multiple times.
  const gesehen = new Set<string>();
  const nums: string[] = [];
  const farben: number[] = [];
  for (const t of teile || []) {
    const num = String(t?.part_number ?? '').trim();
    if (!num) continue;
    const farbe = colorId(t?.color_id);
    const key = `${num}|${farbe}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    nums.push(num);
    farben.push(farbe);
    if (nums.length >= MAX_OWNED_PARTS) break;
  }
  if (!nums.length) return {};

  // Spare parts count TOO: they sit in the box and can be used
  // — "owned", not "needed" like on the shortage page.
  const out: Record<string, { gesamt: number; lose: number }> = {};
  for (const r of await k.partsList.ownedParts(uids, nums, farben))
    out[`${r.part_number}|${r.color_id}`] = { gesamt: Number(r.gesamt) || 0, lose: Number(r.lose) || 0 };
  // Minifigs count too: a parts list also names a set's figures.
  for (const r of await k.partsList.ownedMinifigs(uids, nums)) {
    const key = `${r.part_number}|0`;
    if (out[key]) continue;
    out[key] = { gesamt: Number(r.gesamt) || 0, lose: Number(r.lose) || 0 };
  }
  return out;
}
