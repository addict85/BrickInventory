/** Read BrickLink wanted XML: the file carries BL numbers; the mapping to
 * Rebrickable numbers is done by wantedResolution.ts. */

export type WantedArt = 'part' | 'fig' | 'set';

// Only P, M and S have a place in the inventory; other kinds are counted and
// reported instead of silently discarded.
const ARTEN: Record<string, WantedArt> = { P: 'part', M: 'fig', S: 'set' };

export interface WantedItem {
  art: WantedArt;
  /** ITEMID — a BrickLink number, NOT a Rebrickable number. */
  blId: string;
  /** COLOR as a BrickLink color number; null for sets and colorless items. */
  blFarbe: number | null;
  /** MINQTY, at least 1. */
  menge: number;
  /** CONDITION: N or U; X ("any") becomes null. */
  zustand: 'N' | 'U' | null;
  /** MAXPRICE; -1 means "no maximum price" and becomes null. */
  maxPreis: number | null;
}

/** Two searches for fixed text instead of `<name>([\s\S]*?)</name>`: with an open tag the lazy
 * pattern restarts at every match position — quadratic. */
function zwischen(text: string, name: string, ab: number): { inhalt: string; ende: number } | null {
  const auf = new RegExp(`<${name}>`, 'gi');
  auf.lastIndex = ab;
  const a = auf.exec(text);
  if (!a) return null;
  const zu = new RegExp(`</${name}>`, 'gi');
  zu.lastIndex = auf.lastIndex;
  const z = zu.exec(text);
  if (!z) return null;
  return { inhalt: text.slice(auf.lastIndex, z.index), ende: zu.lastIndex };
}

function feld(block: string, name: string): string | null {
  const m = zwischen(block, name, 0);
  if (!m) return null;
  // Only the five predefined entities; &amp; LAST, otherwise
  // "&amp;lt;" would become a "<".
  return m.inhalt
    .trim()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface ReadResult {
  posten: WantedItem[];
  fremdeArten: Record<string, number>;
  ohneNummer: number;
}

/** Does NOT throw for foreign kinds or missing fields: a list that is nine tenths
 * usable should arrive nine tenths complete; the rest is in the result. */
export function readWantedList(xml: string): ReadResult {
  const posten: WantedItem[] = [];
  const fremdeArten: Record<string, number> = {};
  let ohneNummer = 0;

  for (let m = zwischen(xml, 'ITEM', 0); m !== null; m = zwischen(xml, 'ITEM', m.ende)) {
    const block = m.inhalt;
    const typ = (feld(block, 'ITEMTYPE') ?? '').toUpperCase();
    const art = ARTEN[typ];
    const blId = feld(block, 'ITEMID');

    if (!blId) {
      ohneNummer++;
      continue;
    }
    if (!art) {
      fremdeArten[typ || '(ohne)'] = (fremdeArten[typ || '(ohne)'] ?? 0) + 1;
      continue;
    }

    const colorRaw = feld(block, 'COLOR');
    const farbe = colorRaw === null ? null : parseInt(colorRaw, 10);
    const quantityRaw = parseInt(feld(block, 'MINQTY') ?? '1', 10);
    const stateRaw = (feld(block, 'CONDITION') ?? '').toUpperCase();
    const priceRaw = parseFloat(feld(block, 'MAXPRICE') ?? '');

    posten.push({
      art,
      blId,
      // At BrickLink color 0 is "(Not Applicable)", not a color.
      blFarbe: farbe !== null && Number.isFinite(farbe) && farbe > 0 ? farbe : null,
      menge: Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1,
      // X means "any": null, so that the account's setting decides.
      zustand: stateRaw === 'N' || stateRaw === 'U' ? stateRaw : null,
      // MAXPRICE is a search limit, not a purchase price — -1 means "none".
      maxPreis: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
    });
  }

  return { posten, fremdeArten, ohneNummer };
}
