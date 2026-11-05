import { meldeUndLiefere } from '../infra/httpError';
import * as db from '../../db/database';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../infra/fremdeAdressen';
import { colorId as farbeLesen } from '../infra/validate';
import * as stamm from './repository/katalogStamm';

type Schreiber = stamm.Schreiber;

// Ausführlich: docs/begruendungen/src/katalog/katalogPflege.ts.md#merketeil

/** `null` heisst: aus einer geprüften Quelle, sonst das Konto, das es eingetippt
 * hat. Eingetipptes landet in dessen eigenen Angaben, nie im gemeinsamen Katalog. */
type Von = number | null;

/** Im gemeinsamen Katalog stehen nur geprüfte Werte; der erste bleibt. */
const ersterWert = (tabelle: string, feld: string): string =>
  `${feld} = COALESCE(${tabelle}.${feld}, EXCLUDED.${feld})`;

const leer = (v: string | null | undefined): string | null => (v === undefined || v === null || v === '') ? null : v;
/** Ein eingetipptes Bild nur von den Hosts, die der Bild-Proxy ohnehin zeigt. */
const bildEingabe = (url: string | null, von: Von): string | null =>
  url !== null && von !== null && !hostErlaubt(url, ERLAUBTE_BILD_HOSTS) ? null : url;

export async function merkeTeil(
  partNumber: string,
  partName?: string | null,
  categoryName?: string | null,
  dbh: Schreiber = db,
  von: Von = null,
) {
  if (!partNumber) return;
  // 'Unknown' ist das Fehlen einer Kategorie und darf einen späteren, echten Wert
  // nicht blockieren.
  const name = leer(partName);
  const kategorie = leer(categoryName) === 'Unknown' ? null : leer(categoryName);
  if (von !== null) { await stamm.schreibeTeilEigen(dbh, von, partNumber, name, kategorie); return; }
  await stamm.schreibeTeilKatalog(dbh, partNumber, name, kategorie, ersterWert('part_catalog', 'part_name'), ersterWert('part_catalog', 'category_name'));
}

/** Je Teil UND Farbe — ein roter Stein sieht anders aus als ein blauer. */
export async function merkeTeilFarbe(
  partNumber: string,
  colorId: number | null | undefined,
  colorName?: string | null,
  colorHex?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Schreiber = db,
  von: Von = null,
) {
  if (!partNumber) return;
  // Ohne Angabe gilt KEINE_FARBE, nie 0 (Schwarz).
  const farbe = farbeLesen(colorId);
  const name = leer(colorName), code = leer(colorHex);
  const bild = bildEingabe(leer(imageUrl), von);
  // image_local schreibt nur der Server selbst (heruntergeladene Datei).
  if (von !== null) { await stamm.schreibeTeilFarbeEigen(dbh, von, partNumber, farbe, name, code, bild); return; }
  await stamm.schreibeTeilFarbe(dbh, partNumber, farbe, name, code, bild, imageLocal ?? null, ersterWert('part_color_catalog', 'color_name'), ersterWert('part_color_catalog', 'color_hex'), ersterWert('part_color_catalog', 'image_url'));
}

export async function merkeFigur(
  figNumber: string,
  figName?: string | null,
  imageUrl?: string | null,
  imageLocal?: string | null,
  dbh: Schreiber = db,
  von: Von = null,
) {
  if (!figNumber) return;
  const name = leer(figName);
  const bild = bildEingabe(leer(imageUrl), von);
  if (von !== null) { await stamm.schreibeFigurEigen(dbh, von, figNumber, name, bild); return; }
  await stamm.schreibeFigurKatalog(dbh, figNumber, name, bild, imageLocal ?? null, ersterWert('minifigs_catalog', 'fig_name'), ersterWert('minifigs_catalog', 'image_url'));
}

/** Nur Menge und Ersatzteil-Kennzeichen; Name, Farbe und Bild stehen je Teil
 * in den Katalogen. */
export async function merkeSetTeil(
  setNumber: string,
  partNumber: string,
  colorId: number | string | null | undefined,
  quantity: number,
  isSpare = false,
  dbh: Schreiber = db,
) {
  if (!setNumber || !partNumber) return;
  await stamm.schreibeSetTeil(dbh, setNumber, partNumber, farbeLesen(colorId), quantity || 1, isSpare);
}

export interface SetTeilZeile {
  partNumber: string; partName: string | null; kategorie: string | null;
  colorId: number; colorName: string | null; colorHex: string | null;
  imageUrl: string | null; imageLocal: string | null;
  quantity: number; isSpare: boolean;
  blNummer?: string | null;
}

function jeSchluessel<T>(zeilen: T[], schluessel: (z: T) => string, mische?: (a: T, b: T) => T): T[] {
  const m = new Map<string, T>();
  for (const z of zeilen) {
    const k = schluessel(z), alt = m.get(k);
    m.set(k, alt === undefined ? z : (mische ? mische(alt, z) : alt));
  }
  return [...m.values()];
}

/** Drei Anweisungen statt drei je Teil. ON CONFLICT DO UPDATE darf eine Zeile
 * nicht zweimal treffen, darum vorher je Schlüssel zusammengefasst: Die
 * Bauteilmenge zählt; Ersatzteil ist es nur, wenn alle es sind. */
export async function merkeSetTeile(setNumber: string, zeilen: SetTeilZeile[], dbh: Schreiber = db) {
  if (!setNumber || !zeilen.length) return;
  const teile = jeSchluessel(zeilen, z => z.partNumber);
  const kat = (v: string | null) => leer(v) === 'Unknown' ? null : leer(v);
  await stamm.schreibeTeileKatalog(dbh, teile.map(z => z.partNumber), teile.map(z => leer(z.partName)), teile.map(z => kat(z.kategorie)), ersterWert('part_catalog', 'part_name'), ersterWert('part_catalog', 'category_name'));

  const farben = jeSchluessel(zeilen, z => `${z.partNumber}|${z.colorId}`);
  await stamm.schreibeTeilFarben(dbh, farben.map(z => z.partNumber), farben.map(z => z.colorId), farben.map(z => leer(z.colorName)), farben.map(z => leer(z.colorHex)), farben.map(z => leer(z.imageUrl)), farben.map(z => z.imageLocal), ersterWert('part_color_catalog', 'color_name'), ersterWert('part_color_catalog', 'color_hex'), ersterWert('part_color_catalog', 'image_url'));

  const liste = jeSchluessel(zeilen.map(z => ({ ...z })), z => `${z.partNumber}|${z.colorId}`, (a, b) => {
    if (a.isSpare === b.isSpare) return { ...a, quantity: a.quantity + b.quantity };
    return a.isSpare ? b : a;
  });
  await stamm.schreibeSetTeile(dbh, setNumber, liste.map(z => z.partNumber), liste.map(z => z.colorId), liste.map(z => z.quantity || 1), liste.map(z => z.isSpare));
}

export async function merkeFiguren(
  figuren: { figNumber: string; figName: string | null; imageUrl: string | null }[], dbh: Schreiber = db,
) {
  const f = jeSchluessel(figuren.filter(x => x.figNumber), x => x.figNumber);
  if (!f.length) return;
  await stamm.schreibeFigurenKatalog(dbh, f.map(x => x.figNumber), f.map(x => leer(x.figName)), f.map(x => leer(x.imageUrl)), ersterWert('minifigs_catalog', 'fig_name'), ersterWert('minifigs_catalog', 'image_url'));
}

/** Ohne COALESCE: Nach einem echten Download ist der neue Pfad richtig, der
 * alte kann ins Leere zeigen. */
export async function setzeTeilBildLokal(
  partNumber: string,
  colorId: number | string,
  imageLocal: string,
  dbh: Schreiber = db,
) {
  if (!partNumber || !imageLocal) return;
  await stamm.schreibeTeilbildLokal(dbh, partNumber, farbeLesen(colorId), imageLocal);
}

export async function merkeSetFiguren(
  setNumber: string, figuren: { figNumber: string; quantity?: number | null | undefined }[], dbh: Schreiber = db,
) {
  const f = jeSchluessel(figuren.filter(x => x.figNumber), x => x.figNumber);
  if (!setNumber || !f.length) return;
  await stamm.schreibeSetFiguren(dbh, setNumber, f.map(x => x.figNumber), f.map(x => Math.max(1, Number(x.quantity) || 1)));
}

/** Nur dort, wo noch keine steht. */
export async function merkeFigurBildAdresse(figNumber: string, imageUrl: string, dbh: Schreiber = db) {
  if (!figNumber || !imageUrl) return;
  await stamm.schreibeFigurBildAdresse(dbh, figNumber, imageUrl);
}

/** ÜBERSCHREIBEN — wie setzeTeilBildLokal. */
export async function setzeFigurBildLokal(
  figNumber: string,
  imageLocal: string,
  dbh: Schreiber = db,
) {
  if (!figNumber || !imageLocal) return;
  await stamm.schreibeFigurBildLokal(dbh, figNumber, imageLocal);
}

/** Vor jedem Abruf bei Rebrickable gefragt, damit Bekanntes nichts kostet.
 * Ausführlich: docs/begruendungen/src/katalog/katalogPflege.ts.md#katalogteil */
export interface KatalogTeil {
  name: string | null;
  kategorie: string | null;
  /** Nur als https-URL; ein lokaler Pfad zählt bei `hatBild` mit, nicht hier. */
  bild: string | null;
  hatBild: boolean;
  /** Die Setlisten führen keine eigenen Bilder; ihre stehen an der Farbe. */
  bildQuelle: 'farbe' | 'allgemein' | null;
  bildDatei: string | null;
}

/** `fuer`: Nur dessen eigene Angaben zählen als bekannt, die anderer Konten
 * sieht diese Abfrage nicht. */
export async function katalogTeil(
  partNumber: string, colorId: number | null, fuer: Von = null,
): Promise<KatalogTeil | null> {
  if (!partNumber) return null;
  const z = await stamm.teilAusKatalog(partNumber, colorId, fuer).catch(meldeUndLiefere('katalog:teil lesen', null));
  if (!z) return null;

  const quelle: KatalogTeil['bildQuelle'] =
      (z.farb_datei || z.farb_url) ? 'farbe'
    : (colorId === null && z.bild_allgemein) ? 'allgemein'
    : null;
  const url   = quelle === 'farbe' ? z.farb_url
              : quelle === 'allgemein' ? z.bild_allgemein : null;
  const datei = quelle === 'farbe' ? z.farb_datei : null;

  return {
    name: z.name ?? null,
    kategorie: z.kategorie ?? null,
    bild: url && String(url).startsWith('https:') ? String(url) : null,
    hatBild: quelle !== null,
    bildQuelle: quelle,
    bildDatei: datei ?? null,
  };
}

export async function katalogFigur(
  figNumber: string, fuer: Von = null,
): Promise<{ name: string | null; bild: string | null; hatBild: boolean } | null> {
  if (!figNumber) return null;
  const z = await stamm.figurAusKatalog(figNumber, fuer).catch(meldeUndLiefere('katalog:figur lesen', null));
  if (!z) return null;
  return {
    name: z.fig_name ?? null,
    bild: z.image_url && String(z.image_url).startsWith('https:') ? String(z.image_url) : null,
    hatBild: !!(z.image_local || z.image_url),
  };
}
