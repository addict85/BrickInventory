/** Set zum Barcode: eigener Katalog, Rebrickable, Brickset und EAN-Quellen. */
import {
  resolveImageLocal,
  istVermutung,
  setnummerKandidaten,
  merkeSetKatalog,
  RbSet,
  RbSetFigur,
  rbSeite,
} from '../katalog';
import { normalizeSetNumber } from './erfassen';
import { mitVersion } from '../infra/setNummer';
import * as repo from './repository/setDetail';
import { versuche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

export interface BarcodeTreffer {
  unsicher: boolean;
  set_number: string;
  name: string | null;
  year?: number | null;
  pieces?: number | null;
  theme?: string | null;
  minifigs: number | null;
  image_url: string | null;
  image_local?: string | null | undefined;
  source: string;
}

/** Rebrickable zuerst: Dort stehen Figurenzahl und Bild am verlässlichsten.
 * Jede Antwort sagt, wie sie zustande kam (src/katalog/barcodeQuelle.ts). */
async function barcodeErgebnis(
  sk: SetsKontext,
  setNumber: string,
  name: string | null,
  source: string,
): Promise<BarcodeTreffer> {
  const rbData = await sk.katalog.quellen.rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/`, RbSet);
  const mfData = rbData
    ? await sk.katalog.quellen.rebrickableJson(
        `/lego/sets/${encodeURIComponent(setNumber)}/minifigs/?page_size=1`,
        rbSeite(RbSetFigur),
      )
    : null;
  // Ohne Fang: Eine gestörte Datenbank ist kein „nicht im Katalog“.
  const local = await repo.setKatalog(sk.db, setNumber);

  const minifigs = mfData?.count ?? local?.minifigs ?? null;
  const image_url = rbData?.set_img_url || local?.image_url || null;
  const image_local = local?.image_local ? resolveImageLocal(local.image_local) : null;
  const unsicher = istVermutung(source);

  if (local) {
    return {
      unsicher,
      set_number: setNumber,
      name: local.name || rbData?.name || name,
      year: local.year || rbData?.year || null,
      pieces: local.pieces || rbData?.num_parts || null,
      theme: local.theme,
      minifigs,
      image_local,
      image_url,
      source,
    };
  }
  if (rbData?.set_num) {
    // In den Katalog wie jeder Abruf; der Treffer gilt auch, wenn das Ablegen scheitert.
    await versuche(
      'sets:katalog schreiben',
      merkeSetKatalog(
        sk.db,
        setNumber,
        rbData.name ?? null,
        rbData.year ?? null,
        null,
        rbData.num_parts ?? null,
        minifigs,
        rbData.set_img_url ?? null,
        null,
        Number(rbData.theme_id) || null,
      ),
    );
    return {
      unsicher,
      set_number: setNumber,
      name: rbData.name || name,
      year: rbData.year ?? null,
      pieces: rbData.num_parts ?? null,
      theme: null,
      minifigs,
      image_url,
      source,
    };
  }
  return { unsicher, set_number: setNumber, name, minifigs, image_url, source };
}

async function imKatalog(
  sk: SetsKontext,
  ...nummern: string[]
): Promise<{ set_number: string; name: string | null } | undefined> {
  return repo.ersterKatalogTreffer(sk.db, nummern);
}

/** Reihenfolge: eigener Katalog, EAN über Rebrickable, Brickset und UPCitemdb,
 * dann Bestellnummer — die billigste Quelle zuerst. */
export async function setZumBarcode(sk: SetsKontext, rohBarcode: string): Promise<BarcodeTreffer | null> {
  const barcode = rohBarcode.trim();
  const direct = await repo.katalogCacheNachNummer(sk.db, mitVersion(barcode));
  if (direct) return barcodeErgebnis(sk, direct.set_number, direct.name, 'catalog_cache');

  if (/^\d{12,13}$/.test(barcode)) {
    const ean13 = barcode.length === 12 ? '0' + barcode : barcode;
    const rb = await sk.katalog.quellen.rebrickableJson(
      `/lego/sets/?search=${encodeURIComponent(ean13)}&page_size=5`,
      rbSeite(RbSet),
    );
    for (const set of rb?.results || []) {
      const detail = await sk.katalog.quellen.rebrickableJson(`/lego/sets/${encodeURIComponent(set.set_num)}/`, RbSet);
      const extIds = Object.values(detail?.external_ids || {})
        .flat()
        .map(String);
      if (extIds.includes(ean13) || extIds.includes(barcode))
        return barcodeErgebnis(sk, set.set_num, set.name ?? null, 'rebrickable-ean');
    }
    const plausibel = rb?.results.find(s => (s.year ?? 0) > 2010 && (s.num_parts ?? 0) > 0);
    if (plausibel) return barcodeErgebnis(sk, plausibel.set_num, plausibel.name ?? null, 'rebrickable-search');

    const bsEan = await sk.katalog.quellen.getSetByEan(ean13);
    if (bsEan) {
      const r = await barcodeErgebnis(sk, bsEan.set_number, bsEan.name, 'brickset-ean');
      return { ...r, year: r.year || bsEan.year, theme: r.theme || bsEan.theme, pieces: r.pieces || bsEan.pieces };
    }

    // Der Titel ist Händlertext: Erst die Kandidaten, die der Katalog kennt; sonst bleibt der erste als
    // markierte Vermutung stehen.
    const titel = await sk.katalog.quellen.produktTitel(ean13);
    if (titel) {
      const kandidaten = setnummerKandidaten(titel);
      for (const k of kandidaten) {
        const bekannt = await imKatalog(sk, k, normalizeSetNumber(k));
        if (bekannt) return barcodeErgebnis(sk, bekannt.set_number, titel, 'upcitemdb');
      }
      if (kandidaten[0]) return barcodeErgebnis(sk, normalizeSetNumber(kandidaten[0]), titel, 'upcitemdb');
    }
  }

  if (/^\d{5,8}$/.test(barcode)) {
    const bs = await sk.katalog.quellen.getSetByBarcode(barcode);
    if (bs) return barcodeErgebnis(sk, bs.set_number, bs.name, 'brickset-item');
    const rb = await sk.katalog.quellen.rebrickableJson(`/lego/sets/${barcode}-1/`, RbSet);
    if (rb?.set_num) return barcodeErgebnis(sk, rb.set_num, rb.name ?? null, 'rebrickable-direct');
  }
  return null;
}
