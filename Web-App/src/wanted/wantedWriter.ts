/** Write resolved items of the wanted list as report rows and via the creators
 * into the inventory. */
import { logAndContinue } from '../infra/error';
import type { WantedKind } from './wantedParser';
import type { Resolution, Confidence } from './wantedResolution';

/** Image and name travel along, because the preview shows them like the parts list. */
export interface ItemResult {
  blId: string;
  kind: WantedKind;
  blColor: number | null;
  quantity: number;
  condition: string | null;
  /** Per piece; it is in the report because the preview shows it as editable. */
  maxPrice: number | null;
  rbId: string | null;
  rbColor: number | null;
  confidence: Confidence | null;
  outcome: 'created' | 'topped_up' | 'open' | 'error';
  reason?: string;
  /** Identifier instead of a sentence, so that the UI renders it in the viewer's language. */
  reasonCode?: 'nummer_unbekannt' | 'farbe_unbekannt';
  /** Description from the catalog — empty if it does not know the number. */
  name?: string | null;
  image?: string | null;
  /** Name and image found under the BL number, not via a mapping — the
   * UI must mark that. */
  nameGuessed?: boolean;
  colorName?: string | null;
  colorHex?: string | null;
}

/** As an interface: the route plugs in the real functions, a test counters. */
export interface Creator {
  part: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  minifig: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  set: (
    uid: number,
    setNumber: string,
    quantity: number,
    condition: string | null,
    purchasePrice: number | null,
  ) => Promise<unknown>;
}

export interface WriteOptions {
  creator?: Creator;
  /** Passed in, so that this function stays write-free except for the creator. */
  rememberNumber?: (
    kind: WantedKind,
    rbId: string,
    blId: string,
    source: 'korrigiert' | 'rebrickable',
  ) => Promise<unknown>;
}

/** The report row of an item, before writing. */
export function reportRow(a: Resolution): ItemResult {
  // A color that cannot be mapped is not invented: color_id 0 is black at
  // Rebrickable, not "no color".
  const reason =
    a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.colorPending
        ? `BrickLink-Farbe ${a.items.blColor} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
  const reasonCode: ItemResult['reasonCode'] =
    a.rbId === null ? 'nummer_unbekannt' : a.colorPending ? 'farbe_unbekannt' : undefined;
  return {
    blId: a.items.blId,
    kind: a.items.kind,
    blColor: a.items.blColor,
    quantity: a.items.quantity,
    condition: a.items.condition ?? null,
    maxPrice: a.items.maxPrice ?? null,
    rbId: a.rbId,
    rbColor: a.rbColor,
    confidence: a.confidence,
    outcome: a.rbId === null ? 'open' : 'created',
    ...(reason ? { reason } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    colorName: a.rbColorName,
    colorHex: a.rbColorHex,
  };
}

/** Creates a resolved item. @returns whether it is new or was topped up */
export async function writeItem(
  uid: number,
  a: Resolution,
  rbId: string,
  opt: WriteOptions,
): Promise<'created' | 'topped_up'> {
  if (!opt.creator) throw new Error('Kein Anleger übergeben — siehe Anleger');
  let feedback: unknown;
  if (a.items.kind === 'part') {
    // The color name travels along: the parts list reads it from the row; without it
    // it does not fall back to the catalog.
    feedback = await opt.creator.part(uid, {
      part_number: rbId,
      color_id: a.rbColor ?? 0,
      ...(a.rbColorName ? { color_name: a.rbColorName } : {}),
      ...(a.rbColorHex ? { color_hex: a.rbColorHex } : {}),
      quantity: a.items.quantity,
      condition: a.items.condition ?? undefined,
      // `undefined` instead of `null`: the creators distinguish "nothing specified"
      // (market price) from an explicit zero.
      ...(a.items.maxPrice !== null ? { unit_price: a.items.maxPrice } : {}),
    });
  } else if (a.items.kind === 'fig') {
    feedback = await opt.creator.minifig(uid, {
      fig_number: rbId,
      quantity: a.items.quantity,
      condition: a.items.condition ?? undefined,
      ...(a.items.maxPrice !== null ? { unit_price: a.items.maxPrice } : {}),
    });
  } else {
    feedback = await opt.creator.set(uid, rbId, a.items.quantity, a.items.condition, a.items.maxPrice);
  }
  // 'rebrickable' is remembered too: blTeilZuRb checks every hit against the
  // searched BL number; it is a mapping, not a guess.
  if ((a.confidence === 'korrigiert' || a.confidence === 'rebrickable') && opt.rememberNumber) {
    // A failure does not abort the import: the item is already in the inventory.
    await opt
      .rememberNumber(a.items.kind, rbId, a.items.blId, a.confidence)
      .catch(logAndContinue('wanted:nummer-merken'));
  }
  // The creator knows whether created or topped up; without the question a
  // second import would count everything as created.
  return (feedback as { action?: string } | null | undefined)?.action !== 'updated' ? 'created' : 'topped_up';
}
