/** Set zum Barcode: eigener Katalog, Rebrickable, Brickset und EAN-Quellen. */
import { resolveImageLocal } from '../katalog/bilder/images';
import { normalizeSetNumber } from './erfassen';
import { istVermutung } from '../katalog/barcodeQuelle';
import { setnummerKandidaten } from '../katalog/produkttitel';
import { mitVersion } from '../infra/setNummer';
import { getSetByBarcode, getSetByEan, rebrickableJson, produktTitel } from '../katalog/quellen';
import * as repo from './repository/setDetail';
import * as katalogStamm from '../katalog/setStamm';
import { versuche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

export interface BarcodeTreffer {
  success: true;
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
  const rbData = await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/`);
  const mfData = rbData
    ? await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/minifigs/?page_size=1`)
    : null;
  // Ohne Fang: Eine gestörte Datenbank ist kein „nicht im Katalog“.
  const local = await repo.setKatalog(sk.db, setNumber);

  const minifigs = mfData?.count ?? local?.minifigs ?? null;
  const image_url = rbData?.set_img_url || local?.image_url || null;
  const image_local = local?.image_local ? resolveImageLocal(local.image_local) : null;
  const unsicher = istVermutung(source);

  if (local) {
    return {
      success: true,
      unsicher,
      set_number: setNumber,
      name: local.name || rbData?.name || name,
      year: local.year || rbData?.year,
      pieces: local.pieces || rbData?.num_parts,
      theme: local.theme || rbData?.theme_name,
      minifigs,
      image_local,
      image_url,
      source,
    };
  }
  if (rbData?.set_num) {
    // Der Cache spart nur den nächsten Abruf; der Treffer gilt auch ohne ihn.
    await versuche(
      'sets:catalog_cache schreiben',
      katalogStamm.merkeKatalogCache(
        sk.db,
        setNumber,
        rbData.name,
        rbData.year,
        rbData.theme_name,
        rbData.num_parts,
        rbData.set_img_url,
      ),
    );
    return {
      success: true,
      unsicher,
      set_number: setNumber,
      name: rbData.name || name,
      year: rbData.year,
      pieces: rbData.num_parts,
      theme: rbData.theme_name,
      minifigs,
      image_url,
      source,
    };
  }
  const cat = await repo.katalogCacheEintrag(sk.db, setNumber);
  if (cat) {
    return {
      success: true,
      unsicher,
      set_number: setNumber,
      name: cat.name || name,
      year: cat.year,
      pieces: cat.pieces,
      theme: cat.theme,
      minifigs,
      image_url: cat.image_url || image_url,
      source,
    };
  }
  return { success: true, unsicher, set_number: setNumber, name, minifigs, image_url, source };
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
    const rb = await rebrickableJson(`/lego/sets/?search=${encodeURIComponent(ean13)}&page_size=5`);
    for (const set of rb?.results || []) {
      const detail = await rebrickableJson(`/lego/sets/${encodeURIComponent(set.set_num)}/`);
      const extIds = Object.values(detail?.external_ids || {})
        .flat()
        .map(String);
      if (extIds.includes(ean13) || extIds.includes(barcode))
        return barcodeErgebnis(sk, set.set_num, set.name, 'rebrickable-ean');
    }
    const plausibel = rb?.results?.find((s: { year: number; num_parts: number }) => s.year > 2010 && s.num_parts > 0);
    if (plausibel) return barcodeErgebnis(sk, plausibel.set_num, plausibel.name, 'rebrickable-search');

    const bsEan = await getSetByEan(ean13);
    if (bsEan) {
      const r = await barcodeErgebnis(sk, bsEan.set_number, bsEan.name, 'brickset-ean');
      return { ...r, year: r.year || bsEan.year, theme: r.theme || bsEan.theme, pieces: r.pieces || bsEan.pieces };
    }

    // Der Titel ist Händlertext: Erst die Kandidaten, die der Katalog kennt; sonst bleibt der erste als
    // markierte Vermutung stehen.
    const titel = await produktTitel(ean13);
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
    const bs = await getSetByBarcode(barcode);
    if (bs) return barcodeErgebnis(sk, bs.set_number, bs.name, 'brickset-item');
    const rb = await rebrickableJson(`/lego/sets/${barcode}-1/`);
    if (rb?.set_num) return barcodeErgebnis(sk, rb.set_num, rb.name, 'rebrickable-direct');
  }
  return null;
}
