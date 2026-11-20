/** Write resolved items of the wanted list as report rows and via the creators
 * into the inventory. */
import { logAndContinue } from '../infra/error';
import type { WantedArt } from './wantedParser';
import type { Aufloesung, Sicherheit } from './wantedResolution';

/** Image and name travel along, because the preview shows them like the parts list. */
export interface ItemResult {
  blId: string;
  art: WantedArt;
  blFarbe: number | null;
  menge: number;
  zustand: string | null;
  /** Per piece; it is in the report because the preview shows it as editable. */
  maxPreis: number | null;
  rbId: string | null;
  rbFarbe: number | null;
  sicherheit: Sicherheit | null;
  ausgang: 'angelegt' | 'aufgestockt' | 'offen' | 'fehler';
  grund?: string;
  /** Identifier instead of a sentence, so that the UI renders it in the viewer's language. */
  grundCode?: 'nummer_unbekannt' | 'farbe_unbekannt';
  /** Description from the catalog — empty if it does not know the number. */
  name?: string | null;
  bild?: string | null;
  /** Name and image found under the BL number, not via a mapping — the
   * UI must mark that. */
  nameGeraten?: boolean;
  farbName?: string | null;
  farbHex?: string | null;
}

/** As an interface: the route plugs in the real functions, a test counters. */
export interface Creator {
  teil: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  figur: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  set: (
    uid: number,
    setNummer: string,
    menge: number,
    zustand: string | null,
    kaufpreis: number | null,
  ) => Promise<unknown>;
}

export interface WriteOptions {
  creator?: Creator;
  /** Passed in, so that this function stays write-free except for the creator. */
  rememberNumber?: (
    art: WantedArt,
    rbId: string,
    blId: string,
    quelle: 'korrigiert' | 'rebrickable',
  ) => Promise<unknown>;
}

/** The report row of an item, before writing. */
export function reportRow(a: Aufloesung): ItemResult {
  // A color that cannot be mapped is not invented: color_id 0 is black at
  // Rebrickable, not "no color".
  const grund =
    a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.farbeOffen
        ? `BrickLink-Farbe ${a.posten.blFarbe} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
  const grundCode: ItemResult['grundCode'] =
    a.rbId === null ? 'nummer_unbekannt' : a.farbeOffen ? 'farbe_unbekannt' : undefined;
  return {
    blId: a.posten.blId,
    art: a.posten.art,
    blFarbe: a.posten.blFarbe,
    menge: a.posten.menge,
    zustand: a.posten.zustand ?? null,
    maxPreis: a.posten.maxPreis ?? null,
    rbId: a.rbId,
    rbFarbe: a.rbFarbe,
    sicherheit: a.sicherheit,
    ausgang: a.rbId === null ? 'offen' : 'angelegt',
    ...(grund ? { grund } : {}),
    ...(grundCode ? { grundCode } : {}),
    farbName: a.rbFarbName,
    farbHex: a.rbFarbHex,
  };
}

/** Creates a resolved item. @returns whether it is new or was topped up */
export async function writeItem(
  uid: number,
  a: Aufloesung,
  rbId: string,
  opt: WriteOptions,
): Promise<'angelegt' | 'aufgestockt'> {
  if (!opt.creator) throw new Error('Kein Anleger übergeben — siehe Anleger');
  let rueckmeldung: unknown;
  if (a.posten.art === 'part') {
    // The color name travels along: the parts list reads it from the row; without it
    // it does not fall back to the catalog.
    rueckmeldung = await opt.creator.teil(uid, {
      part_number: rbId,
      color_id: a.rbFarbe ?? 0,
      ...(a.rbFarbName ? { color_name: a.rbFarbName } : {}),
      ...(a.rbFarbHex ? { color_hex: a.rbFarbHex } : {}),
      quantity: a.posten.menge,
      condition: a.posten.zustand ?? undefined,
      // `undefined` instead of `null`: the creators distinguish "nothing specified"
      // (market price) from an explicit zero.
      ...(a.posten.maxPreis !== null ? { unit_price: a.posten.maxPreis } : {}),
    });
  } else if (a.posten.art === 'fig') {
    rueckmeldung = await opt.creator.figur(uid, {
      fig_number: rbId,
      quantity: a.posten.menge,
      condition: a.posten.zustand ?? undefined,
      ...(a.posten.maxPreis !== null ? { unit_price: a.posten.maxPreis } : {}),
    });
  } else {
    rueckmeldung = await opt.creator.set(uid, rbId, a.posten.menge, a.posten.zustand, a.posten.maxPreis);
  }
  // 'rebrickable' is remembered too: blTeilZuRb checks every hit against the
  // searched BL number; it is a mapping, not a guess.
  if ((a.sicherheit === 'korrigiert' || a.sicherheit === 'rebrickable') && opt.rememberNumber) {
    // A failure does not abort the import: the item is already in the inventory.
    await opt
      .rememberNumber(a.posten.art, rbId, a.posten.blId, a.sicherheit)
      .catch(logAndContinue('wanted:nummer-merken'));
  }
  // The creator knows whether created or topped up; without the question a
  // second import would count everything as created.
  return (rueckmeldung as { action?: string } | null | undefined)?.action !== 'updated' ? 'angelegt' : 'aufgestockt';
}
