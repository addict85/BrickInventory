/** Map the wanted list's BL numbers to Rebrickable numbers: first locally
 * (mappings, catalog), then via Rebrickable, finally the manual corrections. */
import { RebrickableLocked } from '../externalSources';
import { reportError } from '../infra/error';
import type { WantedArt, WantedItem } from './wantedParser';
import type { WantedContext } from './context';

export type Confidence =
  | 'zuordnung'
  | 'gleich_vermerkt'
  /** The number appears like this in the Rebrickable catalog — probably, not certainly. */
  | 'katalogtreffer'
  /** Mapped AND confirmed (external_ids.BrickLink); a level of its own, so that the
   * report shows what a fetch cost. */
  | 'rebrickable'
  /** Entered by hand — a level of its own, so that the report does not claim the
   * catalog delivered what someone typed. */
  | 'korrigiert';

export interface Resolution {
  items: WantedItem;
  rbId: string | null;
  rbColor: number | null;
  /** Travel along, because the parts list reads the color name from the row. */
  rbFarbName: string | null;
  rbFarbHex: string | null;
  confidence: Confidence | null;
  colorPending: boolean;
}

/** Without a third-party fetch; the three levels stay separate because they are differently
 * certain. */
export async function resolveLocalOn(
  k: WantedContext,
  item: WantedItem[],
  uid: number | null = null,
): Promise<Resolution[]> {
  if (!item.length) return [];

  // Three queries for the whole list instead of one per item.
  const numbers = [...new Set(item.map(p => p.blId))];
  const colors = [...new Set(item.map(p => p.blColor).filter((f): f is number => f !== null))];

  const mapping = new Map<string, { rbId: string; confidence: Confidence }>();
  const own = new Set<string>();
  for (const z of await k.wantedList.mappings(numbers, uid)) {
    const key = `${z.type}:${z.bl_id ?? z.rb_id}`;
    const level: Confidence = z.bl_id ? 'zuordnung' : 'gleich_vermerkt';
    const already = mapping.get(key);
    if (z.eigen) own.add(key);
    else if (own.has(key)) continue;
    if (!already || (already.confidence !== 'zuordnung' && level === 'zuordnung')) {
      mapping.set(key, { rbId: z.rb_id, confidence: level });
    }
  }

  const catalog = new Set<string>();
  for (const kind of ['part', 'fig', 'set'] as const) {
    for (const n of await k.wantedList.numbersInCatalog(kind, numbers)) catalog.add(`${kind}:${n}`);
  }

  const colorMap = new Map<number, { id: number; name: string | null; hex: string | null }>();
  for (const z of await k.wantedList.colorsToBlColors(colors)) {
    colorMap.set(Number(z.bl_color_id), {
      id: Number(z.id),
      name: z.name ?? null,
      hex: z.rgb ?? null,
    });
  }

  return item.map(p => {
    const hits = mapping.get(`${p.kind}:${p.blId}`);
    let rbId: string | null = null;
    let confidence: Confidence | null = null;
    if (hits) {
      rbId = hits.rbId;
      confidence = hits.confidence;
    } else if (catalog.has(`${p.kind}:${p.blId}`)) {
      rbId = p.blId;
      confidence = 'katalogtreffer';
    }

    const color = p.blColor === null ? null : (colorMap.get(p.blColor) ?? null);
    return {
      items: p,
      rbId,
      rbColor: color?.id ?? null,
      rbFarbName: color?.name ?? null,
      rbFarbHex: color?.hex ?? null,
      confidence,
      colorPending: rbId !== null && p.blColor !== null && color === null,
    };
  });
}

/** Rebrickable is the only direct path from BL to RB numbers. */
export type RebrickableAbort = 'kontingent' | 'kein_schluessel' | 'stoerung';
/** Two phases, because the Rebrickable fetches take much longer. */
export type WantedProgress = {
  phase: 'rebrickable' | 'schreiben';
  fertig: number;
  total: number;
};

export async function resolveViaRebrickableOn(
  k: WantedContext,
  auf: Resolution[],
  limit = 250,
  progress?: (state: WantedProgress) => void,
): Promise<{
  auf: Resolution[];
  asked: number;
  found: number;
  filterIneffective: boolean;
  aborted?: RebrickableAbort;
}> {
  let asked = 0,
    found = 0;

  const result = [...auf];
  // Exactly the conditions of the loop below, otherwise the bar counts against
  // a different number than it fills.
  const total = Math.min(limit, result.filter(a => a.rbId === null && a.items.kind === 'part').length);
  for (let i = 0; i < result.length; i++) {
    const a = result[i]!;
    if (a.rbId !== null) continue;
    if (a.items.kind !== 'part') continue;
    if (asked >= limit) break;

    asked++;
    let rbId: string | null;
    // An error other than "unknown" also affects all following items; the report
    // names the reason instead of silently counting them as "not found".
    try {
      rbId = await k.externalSources.sources.blPartToRb(a.items.blId);
    } catch (e) {
      if (!(e instanceof RebrickableLocked)) reportError('wanted:rebrickable', e);
      const aborted = e instanceof RebrickableLocked ? e.reason : 'stoerung';
      return {
        auf: result,
        asked,
        found,
        filterIneffective: k.externalSources.sources.blFilterIneffective(),
        aborted,
      };
    }
    if (rbId) {
      found++;
      result[i] = { ...a, rbId, confidence: 'rebrickable' };
    }
    // After the fetch: "37 of 50" means 37 done.
    progress?.({ phase: 'rebrickable', fertig: asked, total });
  }
  return { auf: result, asked, found, filterIneffective: k.externalSources.sources.blFilterIneffective() };
}

/** Addressed via the index: the same number may appear several times in the list. */
export interface Correction {
  index: number;
  /** Cross-check — must match the item at [index]. */
  blId: string;
  kind: WantedArt;
  rbId?: string | null | undefined;
  rbColor?: number | null | undefined;
  /** The values from the file, changed by hand, so that a typo does not force
   * reading the file in again. */
  quantity?: number | undefined;
  /** null means "the account's default". */
  condition?: string | null | undefined;
  /** null means "none, fetch the market price". */
  kaufpreis?: number | null | undefined;
}

/** Three queries for the whole list, not one per item. */
export async function describeItem(
  k: WantedContext,
  auf: Resolution[],
): Promise<Map<number, { name: string | null; image: string | null; geraten: boolean }>> {
  const out = new Map<number, { name: string | null; image: string | null; geraten: boolean }>();

  // Without a Rebrickable number the BrickLink number serves as the key.
  const parts: { i: number; nr: string; farbe: number | null; geraten: boolean }[] = [];
  const minifigs: { i: number; nr: string; geraten: boolean }[] = [];
  const sets: { i: number; nr: string; geraten: boolean }[] = [];
  auf.forEach((a, i) => {
    const nr = a.rbId ?? a.items.blId;
    const geraten = a.rbId === null;
    if (!nr) return;
    if (a.items.kind === 'part') parts.push({ i, nr, farbe: a.rbColor, geraten });
    else if (a.items.kind === 'fig') minifigs.push({ i, nr, geraten });
    else sets.push({ i, nr, geraten });
  });

  if (parts.length) {
    const numbers = [...new Set(parts.map(t => t.nr))];
    const rows = await k.wantedList.partsDescription(numbers);
    const afterNumber = new Map(rows.map(z => [z.part_number, z]));
    const pairs = parts.filter(t => t.farbe !== null);
    const images = new Map<string, string>();
    if (pairs.length) {
      const colorRows = await k.wantedList.partColorImages(
        pairs.map(t => t.nr),
        pairs.map(t => t.farbe as number),
      );
      for (const z of colorRows) if (z.image) images.set(`${z.part_number}|${z.color_id}`, z.image);
    }
    for (const t of parts) {
      const z = afterNumber.get(t.nr);
      const name = z?.name ?? null;
      const image = images.get(`${t.nr}|${t.farbe}`) || z?.bild_allgemein || null;
      // `geraten` only on a find: calling an empty row "guessed" would be
      // a claim about nothing.
      out.set(t.i, { name, image, geraten: t.geraten && !!(name || image) });
    }
  }

  if (minifigs.length) {
    const rows = await k.wantedList.minifigsDescription([...new Set(minifigs.map(f => f.nr))]);
    const nach = new Map(rows.map(z => [z.fig_number, z]));
    for (const f of minifigs) {
      const z = nach.get(f.nr);
      const name = z?.fig_name ?? null,
        image = z?.image ?? null;
      out.set(f.i, { name, image, geraten: f.geraten && !!(name || image) });
    }
  }

  if (sets.length) {
    const numbers = [...new Set(sets.map(x => x.nr))];
    const rows = await k.wantedList.setsDescription(numbers);
    const nach = new Map(rows.map(z => [z.set_number, z]));
    for (const x of sets) {
      const z = nach.get(x.nr);
      const name = z?.name ?? null,
        image = z?.image ?? null;
      out.set(x.i, { name, image, geraten: x.geraten && !!(name || image) });
    }
  }

  return out;
}

/** Every correction is checked against kind and number at the index, otherwise after a file change
 * it would silently act on a foreign item. */
export function applyCorrections(
  auf: Resolution[],
  corrections: Correction[],
): { auf: Resolution[]; applied: number; rejected: Correction[] } {
  const result = [...auf];
  const rejected: Correction[] = [];
  let applied = 0;
  for (const k of corrections) {
    const a = result[k.index];
    if (!a || a.items.kind !== k.kind || a.items.blId !== k.blId) {
      rejected.push(k);
      continue;
    }
    // `undefined` means "not touched", `null` "explicitly cleared" — otherwise
    // a correction of the color would delete the number as well.
    const rbId = k.rbId === undefined ? a.rbId : k.rbId || null;
    const rbColor = k.rbColor === undefined ? a.rbColor : (k.rbColor ?? null);

    // An unusable value rejects the whole correction instead of silently
    // bending it into shape: quantity 0 is a typo, not a 1.
    let quantity = a.items.quantity;
    if (k.quantity !== undefined) {
      const m = Math.trunc(Number(k.quantity));
      if (!Number.isFinite(m) || m < 1) {
        rejected.push(k);
        continue;
      }
      quantity = m;
    }
    let condition = a.items.condition;
    if (k.condition !== undefined) {
      // null/'' means "the account's default" like CONDITION=X; anything other than N/U
      // is an error, not "any".
      if (k.condition === null || k.condition === '') condition = null;
      else if (k.condition === 'N' || k.condition === 'U') condition = k.condition;
      else {
        rejected.push(k);
        continue;
      }
    }
    let maxPrice = a.items.maxPrice;
    if (k.kaufpreis !== undefined) {
      if (k.kaufpreis === null || (k.kaufpreis as unknown) === '') maxPrice = null;
      else {
        const p = Number(k.kaufpreis);
        // 0 means "none", like MAXPRICE in the reader.
        if (!Number.isFinite(p) || p < 0) {
          rejected.push(k);
          continue;
        }
        maxPrice = p > 0 ? p : null;
      }
    }

    const numberChanged = rbId !== a.rbId || rbColor !== a.rbColor;
    const itemChanged =
      quantity !== a.items.quantity || condition !== a.items.condition || maxPrice !== a.items.maxPrice;
    if (!numberChanged && !itemChanged) continue; // nothing changed

    result[k.index] = {
      ...a,
      rbId,
      rbColor,
      ...(itemChanged ? { items: { ...a.items, quantity, condition, maxPrice } } : {}),
      // The color name belonged to the old number and is fetched again below.
      rbFarbName: rbColor === a.rbColor ? a.rbFarbName : null,
      rbFarbHex: rbColor === a.rbColor ? a.rbFarbHex : null,
      // `korrigiert` only for a changed number: the level decides whether the
      // mapping is remembered; a changed quantity says nothing about the number.
      confidence: numberChanged ? 'korrigiert' : a.confidence,
      colorPending: rbId !== null && a.items.blColor !== null && rbColor === null,
    };
    applied++;
  }
  return { auf: result, applied, rejected };
}

/** A color entered by hand was not part of the resolution; without
 * this step it would go to the creator without a name. */
export async function backfillColors(k: WantedContext, auf: Resolution[]): Promise<Resolution[]> {
  const open = auf.filter(a => a.rbColor !== null && a.rbFarbName === null).map(a => a.rbColor as number);
  if (!open.length) return auf;
  const rows = await k.wantedList.colorsToIds([...new Set(open)]);
  const nach = new Map(rows.map(z => [Number(z.id), z]));
  return auf.map(a => {
    if (a.rbColor === null || a.rbFarbName !== null) return a;
    const z = nach.get(a.rbColor);
    return z ? { ...a, rbFarbName: z.name ?? null, rbFarbHex: z.rgb ?? null } : a;
  });
}
