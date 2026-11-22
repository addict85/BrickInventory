import { ALLOWED_IMAGE_HOSTS, hostAllowed } from '../infra/foreignAddresses';
import { colorId as readColor } from '../infra/validate';
import * as master from './repository/catalogMaster';
import type { CatalogContext } from './context';

type Writer = master.Writer;

// The description applies to all accounts and lives only in the catalog (migration 0034).

/** `null` means: from a verified source, otherwise the account that typed it
 * in. Typed-in data ends up in that account's own details, never in the shared catalog. */
type From = number | null;

const leer = (v: string | null | undefined): string | null => (v === undefined || v === null || v === '' ? null : v);
/** A typed-in image only from the hosts the image proxy shows anyway. */
const imageInput = (url: string | null, fromValue: From): string | null =>
  url !== null && fromValue !== null && !hostAllowed(url, ALLOWED_IMAGE_HOSTS) ? null : url;

export async function rememberPart(
  k: CatalogContext,
  partNumber: string,
  partName?: string | null,
  categoryName?: string | null,
  dbh: Writer = k.db,
  fromValue: From = null,
) {
  if (!partNumber) return;
  // 'Unknown' is the absence of a category and must not block a later, real
  // value.
  const name = leer(partName);
  const category = leer(categoryName) === 'Unknown' ? null : leer(categoryName);
  if (fromValue !== null) {
    await master.writePartOwn(dbh, fromValue, partNumber, name, category);
    return;
  }
  await master.writePartCatalog(dbh, partNumber, name, category);
}

/** Per part AND color — a red brick looks different from a blue one. */
export async function rememberPartColor(
  k: CatalogContext,
  partNumber: string,
  colorId: number | null | undefined,
  colorName?: string | null,
  colorHex?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Writer = k.db,
  fromValue: From = null,
) {
  if (!partNumber) return;
  // Without a value KEINE_FARBE applies, never 0 (black).
  const color = readColor(colorId);
  const name = leer(colorName),
    code = leer(colorHex);
  const image = imageInput(leer(imageUrl), fromValue);
  // image_local is only written by the server itself (downloaded file).
  if (fromValue !== null) {
    await master.writePartColorOwn(dbh, fromValue, partNumber, color, name, code, image);
    return;
  }
  await master.writePartColor(dbh, partNumber, color, name, code, image, imageLocal ?? null);
}

export async function rememberMinifig(
  k: CatalogContext,
  figNumber: string,
  figName?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Writer = k.db,
  fromValue: From = null,
) {
  if (!figNumber) return;
  const name = leer(figName);
  const image = imageInput(leer(imageUrl), fromValue);
  if (fromValue !== null) {
    await master.writeMinifigOwn(dbh, fromValue, figNumber, name, image);
    return;
  }
  await master.writeMinifigCatalog(dbh, figNumber, name, image, imageLocal ?? null);
}

/** Only quantity and spare-part flag; name, color and image are kept per part
 * in the catalogs. */
export async function rememberSetPart(
  k: CatalogContext,
  setNumber: string,
  partNumber: string,
  colorId: number | string | null | undefined,
  quantity: number,
  isSpare = false,
  dbh: Writer = k.db,
) {
  if (!setNumber || !partNumber) return;
  await master.writeSetPart(dbh, setNumber, partNumber, readColor(colorId), quantity || 1, isSpare);
}

export interface SetPartRow {
  partNumber: string;
  partName: string | null;
  category: string | null;
  colorId: number;
  colorName: string | null;
  colorHex: string | null;
  imageUrl: string | null;
  imageLocal: string | null;
  quantity: number;
  isSpare: boolean;
  blNumber?: string | null;
}

function jeKey<T>(rows: T[], key: (z: T) => string, mix?: (a: T, b: T) => T): T[] {
  const m = new Map<string, T>();
  for (const z of rows) {
    const k = key(z),
      alt = m.get(k);
    m.set(k, alt === undefined ? z : mix ? mix(alt, z) : alt);
  }
  return [...m.values()];
}

/** Three statements instead of three per part. ON CONFLICT DO UPDATE must not hit a row
 * twice, so they are merged per key beforehand: the
 * part quantity adds up; it is a spare part only if all of them are. */
export async function rememberSetPartRows(
  k: CatalogContext,
  setNumber: string,
  rows: SetPartRow[],
  dbh: Writer = k.db,
) {
  if (!setNumber || !rows.length) return;
  const parts = jeKey(rows, z => z.partNumber);
  const kat = (v: string | null) => (leer(v) === 'Unknown' ? null : leer(v));
  await master.writePartsCatalog(
    dbh,
    parts.map(z => z.partNumber),
    parts.map(z => leer(z.partName)),
    parts.map(z => kat(z.category)),
  );

  const colors = jeKey(rows, z => `${z.partNumber}|${z.colorId}`);
  await master.writePartColors(
    dbh,
    colors.map(z => z.partNumber),
    colors.map(z => z.colorId),
    colors.map(z => leer(z.colorName)),
    colors.map(z => leer(z.colorHex)),
    colors.map(z => leer(z.imageUrl)),
    colors.map(z => z.imageLocal),
  );

  const list = jeKey(
    rows.map(z => ({ ...z })),
    z => `${z.partNumber}|${z.colorId}`,
    (a, b) => {
      if (a.isSpare === b.isSpare) return { ...a, quantity: a.quantity + b.quantity };
      return a.isSpare ? b : a;
    },
  );
  await master.writeSetParts(
    dbh,
    setNumber,
    list.map(z => z.partNumber),
    list.map(z => z.colorId),
    list.map(z => z.quantity || 1),
    list.map(z => z.isSpare),
  );
}

export async function rememberMinifigs(
  k: CatalogContext,
  minifigs: { figNumber: string; figName: string | null; imageUrl: string | null }[],
  dbh: Writer = k.db,
) {
  const f = jeKey(
    minifigs.filter(x => x.figNumber),
    x => x.figNumber,
  );
  if (!f.length) return;
  await master.writeMinifigsCatalog(
    dbh,
    f.map(x => x.figNumber),
    f.map(x => leer(x.figName)),
    f.map(x => leer(x.imageUrl)),
  );
}

/** Without COALESCE: after a real download the new path is correct, the
 * old one may point nowhere. */
export async function setPartImageLocal(
  k: CatalogContext,
  partNumber: string,
  colorId: number | string,
  imageLocal: string,
  dbh: Writer = k.db,
) {
  if (!partNumber || !imageLocal) return;
  await master.writePartImageLocal(dbh, partNumber, readColor(colorId), imageLocal);
}

export async function rememberSetMinifigs(
  k: CatalogContext,
  setNumber: string,
  minifigs: { figNumber: string; quantity?: number | null | undefined }[],
  dbh: Writer = k.db,
) {
  const f = jeKey(
    minifigs.filter(x => x.figNumber),
    x => x.figNumber,
  );
  if (!setNumber || !f.length) return;
  await master.writeSetMinifigs(
    dbh,
    setNumber,
    f.map(x => x.figNumber),
    f.map(x => Math.max(1, Number(x.quantity) || 1)),
  );
}

/** Only where none exists yet. */
export async function rememberMinifigImageAddress(
  k: CatalogContext,
  figNumber: string,
  imageUrl: string,
  dbh: Writer = k.db,
) {
  if (!figNumber || !imageUrl) return;
  await master.writeMinifigImageAddress(dbh, figNumber, imageUrl);
}

/** OVERWRITE — like setPartImageLocal. */
export async function setMinifigImageLocal(
  k: CatalogContext,
  figNumber: string,
  imageLocal: string,
  dbh: Writer = k.db,
) {
  if (!figNumber || !imageLocal) return;
  await master.writeMinifigImageLocal(dbh, figNumber, imageLocal);
}

/** Asked before every Rebrickable lookup so that known data costs nothing. */
export interface CatalogPart {
  name: string | null;
  category: string | null;
  /** Only as an https URL; a local path counts for `hatImage`, not here. */
  image: string | null;
  hatImage: boolean;
  /** Set lists carry no images of their own; theirs are attached to the color. */
  imageSource: 'farbe' | 'allgemein' | null;
  imageFile: string | null;
}

/** `fuer`: only that account's own details count as known; this query does not see
 * those of other accounts. */
export async function catalogPart(
  k: CatalogContext,
  partNumber: string,
  colorId: number | null,
  forUser: From = null,
): Promise<CatalogPart | null> {
  if (!partNumber) return null;
  const z = await k.catalogMaster.partFromCatalog(partNumber, colorId, forUser);
  if (!z) return null;

  const source: CatalogPart['imageSource'] =
    z.color_file || z.color_url ? 'farbe' : colorId === null && z.image_generic ? 'allgemein' : null;
  const url = source === 'farbe' ? z.color_url : source === 'allgemein' ? z.image_generic : null;
  const file = source === 'farbe' ? z.color_file : null;

  return {
    name: z.name ?? null,
    category: z.category ?? null,
    image: url && String(url).startsWith('https:') ? String(url) : null,
    hatImage: source !== null,
    imageSource: source,
    imageFile: file ?? null,
  };
}

export async function catalogMinifig(
  k: CatalogContext,
  figNumber: string,
  forUser: From = null,
): Promise<{ name: string | null; image: string | null; hatImage: boolean } | null> {
  if (!figNumber) return null;
  const z = await k.catalogMaster.minifigFromCatalog(figNumber, forUser);
  if (!z) return null;
  return {
    name: z.fig_name ?? null,
    image: z.image_url && String(z.image_url).startsWith('https:') ? String(z.image_url) : null,
    hatImage: !!(z.image_local || z.image_url),
  };
}
