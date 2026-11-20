/** Here, not in a route, because the session route and the v1 factory both
 * reach it — a route should not import another route. */
import type { Sicht } from '../household';
import { publicError } from '../infra/error';
import { Degradations, versuche } from '../infra/result';
import { csvSharedFields, csvRowsFromRequest } from '../infra/csvExport';
import { mengenwunsch } from '../inventory';
import type { Quellen } from '../externalSources';
import * as V from '../infra/validate';
import { moneyInput } from '../infra/geld';
import { fachfehler } from '../infra/errorTexts';
import type { MinifigsContext } from './context';

// Without a BrickLink minifig number the market price is estimated from part
// prices: the RB→BL mapping is reliable for parts, not for minifigs.

// Price and condition once for single entry and CSV import; the market price applies without a price.
export async function manualMinifigPurchase(
  k: MinifigsContext,
  uid: number,
  {
    figNumber,
    blFigNumber = null,
    unitPrice = null,
    condition = null,
  }: { figNumber: string; blFigNumber?: string | null; unitPrice?: unknown; condition?: string | null },
) {
  // Same rule as for parts (src/finances/priceRule.ts), so a minifig without a
  // market price doesn't count differently than a part.
  const r = await k.finances.manuellerKaufpreis(uid, { unitPrice, condition }, zustand =>
    k.finances.figMarketPriceWithOrigin(figNumber, uid, blFigNumber || null, zustand),
  );
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    acquisitionPrice: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    priceFromCondition: r.priceFromState,
    estimated: r.geschaetzt,
  };
}

/** Twin of manuellesTeilAnlegen — one implementation for webapp and app. */
export async function addManualMinifig(k: MinifigsContext, uid: number, body: Record<string, unknown>) {
  // Without a given location, the account's default location applies.
  const ort = await k.inventory.locationService.locationForNewEntry(uid, body?.storage);
  const ergebnis = await addManualMinifigInternal(k, uid, body);
  if (ort && ergebnis?.fig_number) {
    await k.inventory.locationService.setLocation('fig', [uid], [String(ergebnis.fig_number)], ort);
  }
  return ergebnis;
}

async function addManualMinifigInternal(k: MinifigsContext, uid: number, body: Record<string, unknown>) {
  // Same input validation as manual parts: the fields get rendered.
  const num = V.numberRequired(body?.fig_number, 'fig_number');
  const blNum = body?.bl_fig_number ? V.numberRequired(body.bl_fig_number, 'bl_fig_number') : null;
  const quantity = V.acquisitionQuantity(body?.quantity, 1);
  const condition = V.optionalCondition(body?.condition);
  const unit_price = moneyInput(body?.unit_price, 'Stückpreis');
  // Allows several acquisitions of the same minifig at different times.
  const acquiredAt = String(body?.acquired_at || '').trim() || null;
  // Only looked-up data goes into the catalog as verified.
  const eingabe = { name: V.optionalText(body?.fig_name, 200), bild: V.optionalImageUrl(body?.image_url) };
  const { fig_name, found } = await minifigDescription(k, uid, num, eingabe);

  const existing = await findManualMinifig(k, uid, num);

  if (existing) {
    // A re-entered minifig also gets an acquisition (price, date); the
    // quantity follows from it when reading.
    const re = await manualMinifigPurchase(k, uid, {
      figNumber: num,
      blFigNumber: blNum,
      unitPrice: unit_price,
      condition,
    });
    // One acquisition per day and condition (src/inventory/acquisitions.ts).
    await k.inventory.bookDailyEntry('fig', uid, [num], {
      quantity,
      // In the base row, 0 is a display value; in the acquisition it would
      // mean "bought for free".
      price: re.acquisitionPrice,
      geschaetzt: re.estimated,
      condition: re.effectiveCondition,
      createdAt: acquiredAt,
    });

    return { action: 'updated', fig_number: num };
  }

  const { acquisitionPrice, effectiveCondition, priceFromCondition, estimated } = await manualMinifigPurchase(k, uid, {
    figNumber: num,
    blFigNumber: blNum,
    unitPrice: unit_price,
    condition,
  });
  // The catalog first: if the request fails in between, a description without
  // a holding is invisible, a holding without a name is not.
  await k.catalog.rememberMinifig(num, found?.fig_name, found?.image_url);
  await k.catalog.rememberMinifig(num, eingabe.name, eingabe.bild, null, k.db, uid);
  // Without quantity, price and condition: they sit in the acquisition below.
  await k.inventory.manuell.putRowAn('fig', uid, [num]);
  if (blNum) await k.catalog.rememberOwnBlNumber(uid, 'fig', num, blNum);
  // With the price actually used (market price or estimate), so acquisition
  // history and P&L agree.
  await k.inventory.bookDailyEntry('fig', uid, [num], {
    quantity,
    price: acquisitionPrice,
    geschaetzt: estimated,
    condition: effectiveCondition,
    createdAt: acquiredAt,
  });

  return { action: 'added', fig_number: num, fig_name, price_from_condition: priceFromCondition };
}

/** Without a name, first the own catalog, then the external service: minifigs_catalog
 * carries name and image, a lookup per minifig would be unnecessary. */
async function minifigDescription(
  k: MinifigsContext,
  uid: number,
  num: string,
  eingabe: { name: string | null; bild: string | null },
) {
  let fig_name = eingabe.name;
  let image_url = eingabe.bild;
  let found: Awaited<ReturnType<Quellen['getMinifigInfo']>> | null = null;
  if (fig_name) return { fig_name, found };

  const lokal = await k.catalog.catalogMinifig(num, uid);
  if (lokal) {
    fig_name = lokal.name;
    image_url = image_url || lokal.bild;
  }
  // `hatImage`, not `image_url`: a local path would fail the URL check but
  // still proves there's nothing left to fetch.
  if (!fig_name || !(image_url || lokal?.hatImage)) {
    // Without Rebrickable, the minifig is entered with whatever the catalog already knows.
    const abruf = await versuche('figuren:getMinifigInfo', k.externalSources.quellen.getMinifigInfo(num));
    found = abruf.ok ? abruf.wert : null;
    // `||`: what the catalog already knew stays.
    if (found) fig_name = fig_name || found.fig_name;
  }
  return { fig_name, found };
}

/** Twin of manuellesTeilAendern.
 * @returns the quantity afterwards, if it was part of the request */
export async function updateManualMinifig(
  k: MinifigsContext,
  uid: number,
  figNumber: string,
  body: Record<string, unknown>,
): Promise<{ quantity?: number; degradiert?: string[] }> {
  const existing = await k.manualMinifigs.minifigRowWithCondition(uid, figNumber);
  if (!existing) fachfehler('nicht_gefunden', 'minifig_nicht_manuell');

  const raus: { quantity?: number } = {};
  // If the market price for the new acquisition didn't arrive, `degradiert` says so.
  const ab = new Degradations();
  const wish = mengenwunsch(body);
  if (wish) {
    const cond = await k.einstellungen.conditionForPrice(undefined, existing.condition, uid);
    raus.quantity = await k.inventory.passeManualQuantityAn(
      'fig',
      uid,
      [figNumber],
      wish,
      cond,
      () => k.finances.currentMinifigMarketPrice(figNumber, uid, existing.bl_fig_number, cond),
      ab,
    );
  }
  let newBlNum = existing.bl_fig_number;
  if (body.bl_fig_number !== undefined) {
    newBlNum = body.bl_fig_number ? String(body.bl_fig_number).trim() : null;
    // Cleared means "no different number", not "never looked up".
    await k.catalog.rememberOwnBlNumber(uid, 'fig', figNumber, newBlNum || figNumber);
  }
  if (body.unit_price !== undefined) {
    // Same rule as for parts (src/finances/priceRule.ts).
    const { unitPrice } = await k.finances.purchasePriceFromInput(
      body.unit_price,
      body.condition,
      existing.condition,
      uid,
      zustand => k.finances.currentMinifigMarketPrice(figNumber, uid, newBlNum, zustand),
    );
    // Into the NEWEST acquisition, as with parts.
    await k.inventory.setNewest('fig', 'preis', unitPrice, uid, [figNumber]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = V.zustand(body.condition);
    await k.inventory.setNewest('fig', 'zustand', cond, uid, [figNumber]);
  }
  return { ...raus, ...ab.angabe() };
}

/** `uid` is the viewing scope (list). */
export async function minifigAcquisitionsInScope(k: MinifigsContext, uidChoice: Sicht | number[], figNumber: string) {
  const uid = await k.household.scopeFrom(uidChoice);
  return k.manualMinifigs.minifigAcquisitions(uid, figNumber);
}

export function findManualMinifig(
  k: MinifigsContext,
  uid: number,
  figNumber: string,
): Promise<{ id: number } | undefined> {
  return k.manualMinifigs.manualMinifigRow(uid, figNumber);
}

/** Same pricing rule as adding by hand, estimate from parts included. */
export async function importMinifigsCsv(k: MinifigsContext, uid: number, text: string) {
  const { records, cleaned, uebersprungen } = csvRowsFromRequest(text);
  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ fig_number: string; action: string; fig_name?: string | null; error?: string }> = [];

  for (const row of cleaned) {
    const figNumber = String(row.fig_number || row.Nummer || row.fig_num || Object.values(row)[0] || '').trim();
    if (!figNumber) continue;
    const blFigNumber = String(row.bl_fig_number || row['BrickLink-Nr'] || '').trim() || null;
    const { menge: qty, preis: unitPrice, recordedAt: acquiredAt, zustand: rawCondition } = csvSharedFields(row);

    try {
      let figName = row.fig_name || row.Name || null;
      const typed = !!figName;
      let imageUrl: string | null = null;
      if (!figName) {
        // Without Rebrickable, the minifig is entered without a name; the image job won't fetch it later.
        const abruf = await versuche('figuren:import-info', k.externalSources.quellen.getMinifigInfo(figNumber));
        const info = abruf.ok ? abruf.wert : null;
        if (info) {
          figName = info.fig_name;
          imageUrl = info.image_url;
        }
      }
      const { acquisitionPrice, effectiveCondition, estimated } = await manualMinifigPurchase(k, uid, {
        figNumber,
        blFigNumber,
        unitPrice,
        condition: rawCondition,
      });
      const erfassung = {
        quantity: qty,
        price: acquisitionPrice,
        geschaetzt: estimated,
        condition: effectiveCondition || 'N',
        createdAt: acquiredAt || k.uhr.datum().toISOString().slice(0, 10),
      };

      if (await findManualMinifig(k, uid, figNumber)) {
        await k.inventory.bookDailyEntry('fig', uid, [figNumber], erfassung);
        updated++;
        results.push({ fig_number: figNumber, action: 'updated' });
        continue;
      }
      // A name from the file is an input of this account (katalogPflege.ts).
      await k.catalog.rememberMinifig(figNumber, figName, imageUrl, null, k.db, typed ? uid : null);
      await k.inventory.manuell.putRowAn('fig', uid, [figNumber]);
      if (blFigNumber) await k.catalog.rememberOwnBlNumber(uid, 'fig', figNumber, blFigNumber);
      await k.inventory.bookDailyEntry('fig', uid, [figNumber], erfassung);
      added++;
      results.push({ fig_number: figNumber, action: 'added', fig_name: figName });
    } catch (e) {
      errors++;
      results.push({
        fig_number: figNumber,
        action: 'error',
        error: publicError(e, 'figuren-csv:zeile').error,
      });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
