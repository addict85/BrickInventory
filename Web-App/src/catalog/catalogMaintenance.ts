import { ALLOWED_IMAGE_HOSTS, hostAllowed } from '../infra/foreignAddresses';
import { colorId as readColor } from '../infra/validate';
import * as stamm from './repository/catalogMaster';
import type { CatalogContext } from './context';

type Schreiber = stamm.Schreiber;

// The description applies to all accounts and lives only in the catalog (migration 0034).

/** `null` means: from a verified source, otherwise the account that typed it
 * in. Typed-in data ends up in that account's own details, never in the shared catalog. */
type Von = number | null;

const leer = (v: string | null | undefined): string | null => (v === undefined || v === null || v === '' ? null : v);
/** A typed-in image only from the hosts the image proxy shows anyway. */
const imageInput = (url: string | null, von: Von): string | null =>
  url !== null && von !== null && !hostAllowed(url, ALLOWED_IMAGE_HOSTS) ? null : url;

export async function rememberPart(
  k: CatalogContext,
  partNumber: string,
  partName?: string | null,
  categoryName?: string | null,
  dbh: Schreiber = k.db,
  von: Von = null,
) {
  if (!partNumber) return;
  // 'Unknown' is the absence of a category and must not block a later, real
  // value.
  const name = leer(partName);
  const kategorie = leer(categoryName) === 'Unknown' ? null : leer(categoryName);
  if (von !== null) {
    await stamm.writePartOwn(dbh, von, partNumber, name, kategorie);
    return;
  }
  await stamm.writePartCatalog(dbh, partNumber, name, kategorie);
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
  dbh: Schreiber = k.db,
  von: Von = null,
) {
  if (!partNumber) return;
  // Without a value KEINE_FARBE applies, never 0 (black).
  const farbe = readColor(colorId);
  const name = leer(colorName),
    code = leer(colorHex);
  const bild = imageInput(leer(imageUrl), von);
  // image_local is only written by the server itself (downloaded file).
  if (von !== null) {
    await stamm.writePartColorOwn(dbh, von, partNumber, farbe, name, code, bild);
    return;
  }
  await stamm.writePartColor(dbh, partNumber, farbe, name, code, bild, imageLocal ?? null);
}

export async function rememberMinifig(
  k: CatalogContext,
  figNumber: string,
  figName?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Schreiber = k.db,
  von: Von = null,
) {
  if (!figNumber) return;
  const name = leer(figName);
  const bild = imageInput(leer(imageUrl), von);
  if (von !== null) {
    await stamm.writeMinifigOwn(dbh, von, figNumber, name, bild);
    return;
  }
  await stamm.writeMinifigCatalog(dbh, figNumber, name, bild, imageLocal ?? null);
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
  dbh: Schreiber = k.db,
) {
  if (!setNumber || !partNumber) return;
  await stamm.writeSetPart(dbh, setNumber, partNumber, readColor(colorId), quantity || 1, isSpare);
}

export interface SetPartRow {
  partNumber: string;
  partName: string | null;
  kategorie: string | null;
  colorId: number;
  colorName: string | null;
  colorHex: string | null;
  imageUrl: string | null;
  imageLocal: string | null;
  quantity: number;
  isSpare: boolean;
  blNumber?: string | null;
}

function jeKey<T>(zeilen: T[], schluessel: (z: T) => string, mix?: (a: T, b: T) => T): T[] {
  const m = new Map<string, T>();
  for (const z of zeilen) {
    const k = schluessel(z),
      alt = m.get(k);
    m.set(k, alt === undefined ? z : mix ? mix(alt, z) : alt);
  }
  return [...m.values()];
}

/** Three statements instead of three per part. ON CONFLICT DO UPDATE must not hit a row
 * twice, so they are merged per key beforehand: the
 * part quantity adds up; it is a spare part only if all of them are. */
export async function merkeSetTeile(k: CatalogContext, setNumber: string, zeilen: SetPartRow[], dbh: Schreiber = k.db) {
  if (!setNumber || !zeilen.length) return;
  const teile = jeKey(zeilen, z => z.partNumber);
  const kat = (v: string | null) => (leer(v) === 'Unknown' ? null : leer(v));
  await stamm.writePartsCatalog(
    dbh,
    teile.map(z => z.partNumber),
    teile.map(z => leer(z.partName)),
    teile.map(z => kat(z.kategorie)),
  );

  const farben = jeKey(zeilen, z => `${z.partNumber}|${z.colorId}`);
  await stamm.writePartColors(
    dbh,
    farben.map(z => z.partNumber),
    farben.map(z => z.colorId),
    farben.map(z => leer(z.colorName)),
    farben.map(z => leer(z.colorHex)),
    farben.map(z => leer(z.imageUrl)),
    farben.map(z => z.imageLocal),
  );

  const liste = jeKey(
    zeilen.map(z => ({ ...z })),
    z => `${z.partNumber}|${z.colorId}`,
    (a, b) => {
      if (a.isSpare === b.isSpare) return { ...a, quantity: a.quantity + b.quantity };
      return a.isSpare ? b : a;
    },
  );
  await stamm.writeSetParts(
    dbh,
    setNumber,
    liste.map(z => z.partNumber),
    liste.map(z => z.colorId),
    liste.map(z => z.quantity || 1),
    liste.map(z => z.isSpare),
  );
}

export async function rememberMinifigs(
  k: CatalogContext,
  figuren: { figNumber: string; figName: string | null; imageUrl: string | null }[],
  dbh: Schreiber = k.db,
) {
  const f = jeKey(
    figuren.filter(x => x.figNumber),
    x => x.figNumber,
  );
  if (!f.length) return;
  await stamm.writeMinifigsCatalog(
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
  dbh: Schreiber = k.db,
) {
  if (!partNumber || !imageLocal) return;
  await stamm.writePartImageLocal(dbh, partNumber, readColor(colorId), imageLocal);
}

export async function merkeSetFiguren(
  k: CatalogContext,
  setNumber: string,
  figuren: { figNumber: string; quantity?: number | null | undefined }[],
  dbh: Schreiber = k.db,
) {
  const f = jeKey(
    figuren.filter(x => x.figNumber),
    x => x.figNumber,
  );
  if (!setNumber || !f.length) return;
  await stamm.writeSetMinifigs(
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
  dbh: Schreiber = k.db,
) {
  if (!figNumber || !imageUrl) return;
  await stamm.writeMinifigImageAddress(dbh, figNumber, imageUrl);
}

/** OVERWRITE — like setPartImageLocal. */
export async function setMinifigImageLocal(
  k: CatalogContext,
  figNumber: string,
  imageLocal: string,
  dbh: Schreiber = k.db,
) {
  if (!figNumber || !imageLocal) return;
  await stamm.writeMinifigImageLocal(dbh, figNumber, imageLocal);
}

/** Asked before every Rebrickable lookup so that known data costs nothing. */
export interface CatalogPart {
  name: string | null;
  kategorie: string | null;
  /** Only as an https URL; a local path counts for `hatImage`, not here. */
  bild: string | null;
  hatImage: boolean;
  /** Set lists carry no images of their own; theirs are attached to the color. */
  bildQuelle: 'farbe' | 'allgemein' | null;
  bildDatei: string | null;
}

/** `fuer`: only that account's own details count as known; this query does not see
 * those of other accounts. */
export async function catalogPart(
  k: CatalogContext,
  partNumber: string,
  colorId: number | null,
  fuer: Von = null,
): Promise<CatalogPart | null> {
  if (!partNumber) return null;
  const z = await k.katalogStamm.partFromCatalog(partNumber, colorId, fuer);
  if (!z) return null;

  const quelle: CatalogPart['bildQuelle'] =
    z.farb_datei || z.farb_url ? 'farbe' : colorId === null && z.bild_allgemein ? 'allgemein' : null;
  const url = quelle === 'farbe' ? z.farb_url : quelle === 'allgemein' ? z.bild_allgemein : null;
  const datei = quelle === 'farbe' ? z.farb_datei : null;

  return {
    name: z.name ?? null,
    kategorie: z.kategorie ?? null,
    bild: url && String(url).startsWith('https:') ? String(url) : null,
    hatImage: quelle !== null,
    bildQuelle: quelle,
    bildDatei: datei ?? null,
  };
}

export async function catalogMinifig(
  k: CatalogContext,
  figNumber: string,
  fuer: Von = null,
): Promise<{ name: string | null; bild: string | null; hatImage: boolean } | null> {
  if (!figNumber) return null;
  const z = await k.katalogStamm.minifigFromCatalog(figNumber, fuer);
  if (!z) return null;
  return {
    name: z.fig_name ?? null,
    bild: z.image_url && String(z.image_url).startsWith('https:') ? String(z.image_url) : null,
    hatImage: !!(z.image_local || z.image_url),
  };
}
