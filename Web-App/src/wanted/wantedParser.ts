/** Read BrickLink wanted XML: the file carries BL numbers; the mapping to
 * Rebrickable numbers is done by wantedResolution.ts. */

export type WantedArt = 'part' | 'fig' | 'set';

// Only P, M and S have a place in the inventory; other kinds are counted and
// reported instead of silently discarded.
const KINDS: Record<string, WantedArt> = { P: 'part', M: 'fig', S: 'set' };

export interface WantedItem {
  kind: WantedArt;
  /** ITEMID — a BrickLink number, NOT a Rebrickable number. */
  blId: string;
  /** COLOR as a BrickLink color number; null for sets and colorless items. */
  blColor: number | null;
  /** MINQTY, at least 1. */
  quantity: number;
  /** CONDITION: N or U; X ("any") becomes null. */
  condition: 'N' | 'U' | null;
  /** MAXPRICE; -1 means "no maximum price" and becomes null. */
  maxPrice: number | null;
}

/** Two searches for fixed text instead of `<name>([\s\S]*?)</name>`: with an open tag the lazy
 * pattern restarts at every match position — quadratic. */
function between(text: string, name: string, ab: number): { content: string; end: number } | null {
  const auf = new RegExp(`<${name}>`, 'gi');
  auf.lastIndex = ab;
  const a = auf.exec(text);
  if (!a) return null;
  const zu = new RegExp(`</${name}>`, 'gi');
  zu.lastIndex = auf.lastIndex;
  const z = zu.exec(text);
  if (!z) return null;
  return { content: text.slice(auf.lastIndex, z.index), end: zu.lastIndex };
}

function field(block: string, name: string): string | null {
  const m = between(block, name, 0);
  if (!m) return null;
  // Only the five predefined entities; &amp; LAST, otherwise
  // "&amp;lt;" would become a "<".
  return m.content
    .trim()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface ReadResult {
  items: WantedItem[];
  foreignTypes: Record<string, number>;
  withoutNumber: number;
}

/** The values of one ITEM whose kind and number are known. */
function itemOf(block: string, kind: WantedItem['kind'], blId: string): WantedItem {
  const colorRaw = field(block, 'COLOR');
  const color = colorRaw === null ? null : parseInt(colorRaw, 10);
  const quantityRaw = parseInt(field(block, 'MINQTY') ?? '1', 10);
  const stateRaw = (field(block, 'CONDITION') ?? '').toUpperCase();
  const priceRaw = parseFloat(field(block, 'MAXPRICE') ?? '');
  return {
    kind,
    blId,
    // At BrickLink color 0 is "(Not Applicable)", not a color.
    blColor: color !== null && Number.isFinite(color) && color > 0 ? color : null,
    quantity: Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1,
    // X means "any": null, so that the account's setting decides.
    condition: stateRaw === 'N' || stateRaw === 'U' ? stateRaw : null,
    // MAXPRICE is a search limit, not a purchase price — -1 means "none".
    maxPrice: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
  };
}

/** Does NOT throw for foreign kinds or missing fields: a list that is nine tenths
 * usable should arrive nine tenths complete; the rest is in the result. */
export function readWantedList(xml: string): ReadResult {
  const items: WantedItem[] = [];
  const foreignTypes: Record<string, number> = {};
  let withoutNumber = 0;

  for (let m = between(xml, 'ITEM', 0); m !== null; m = between(xml, 'ITEM', m.end)) {
    const block = m.content;
    const type = (field(block, 'ITEMTYPE') ?? '').toUpperCase();
    const kind = KINDS[type];
    const blId = field(block, 'ITEMID');
    if (!blId) withoutNumber++;
    else if (!kind) foreignTypes[type || '(ohne)'] = (foreignTypes[type || '(ohne)'] ?? 0) + 1;
    else items.push(itemOf(block, kind, blId));
  }

  return { items, foreignTypes, withoutNumber };
}
