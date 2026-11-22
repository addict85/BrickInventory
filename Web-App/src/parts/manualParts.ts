/** Here and not in a route, because the session route and the v1 factory both
 * reach for it — a route shouldn't import another route. */
import type { Sicht } from '../household';
import { publicError } from '../infra/error';
import { Degradations, attempts } from '../infra/result';
import { csvSharedFields, csvRowsFromRequest } from '../infra/csvExport';
import { quantityRequest } from '../inventory';
import { KEINE_FARBE } from '../catalog';
import type { Sources } from '../externalSources';
import * as V0 from '../infra/validate';
import { moneyInput } from '../infra/money';
import { failDomain } from '../infra/errorTexts';
import type { PartsContext } from './context';

// One calculation for adding, editing and CSV import; without a value, price/unit stays empty.
export async function manualPartPurchase(
  k: PartsContext,
  uid: number,
  {
    partNumber,
    colorId,
    unitPrice = null,
    condition = null,
  }: { partNumber: string; colorId: number; unitPrice?: unknown; condition?: string | null },
) {
  // The rule lives in src/finances/priceRule.ts; what remains here is only what
  // differs for a PART versus a minifig: the lookup key.
  const r = await k.finances.manualPurchasePrice(uid, { unitPrice, condition }, condition =>
    k.finances.marketPriceWithOrigin(partNumber, colorId, uid, condition),
  );
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.condition,
    // null when there is nothing to flag.
    priceFromState: r.priceFromState,
    geschaetzt: r.geschaetzt,
  };
}

/** One path for the webapp and the app, so purchase price and storage are handled the same everywhere. */
export async function addManualPart(k: PartsContext, uid: number, rawBody: Record<string, unknown>) {
  // Without a given location, the account's default location applies (src/inventory/storageLocation.ts).
  const location = await k.inventory.locationService.locationForNewEntry(uid, rawBody?.storage);
  // The SAME conversion as in the body, on the same input — it cannot drift apart.
  const color = V0.colorId(rawBody?.color_id);
  const result = await addManualPartInternal(k, uid, rawBody);
  if (location && result?.part_number) {
    await k.inventory.locationService.setLocation('part', [uid], [result.part_number, String(color)], location);
  }
  return result;
}

async function addManualPartInternal(k: PartsContext, uid: number, rawBody: Record<string, unknown>) {
  // Every field validated: they get rendered later, and unvalidated they were the
  // server half of a stored-XSS chain. image_url must be https.
  const V = V0;
  const part_number = V.numberRequired(rawBody?.part_number, 'part_number');
  const color_id = V.colorId(rawBody?.color_id);
  const color_name = V.optionalText(rawBody?.color_name, 100);
  const color_hex = V.optionalHex(rawBody?.color_hex);
  const quantity = V.acquisitionQuantity(rawBody?.quantity, 1);
  const condition = V.optionalCondition(rawBody?.condition);
  // Negative amounts used to end up in the finance tab's totals.
  const unit_price = moneyInput(rawBody?.unit_price, 'Stückpreis');
  // Allows several acquisitions of the same part at different times.
  const acquiredAt = String(rawBody?.acquired_at || '').trim() || null;

  // Validated in this order: with several errors, the first one reports.
  const name = V.optionalText(rawBody?.part_name, 200);
  const image = V.optionalImageUrl(rawBody?.image_url);
  const input = { name, kategorie: V.optionalText(rawBody?.category_name, 100), image };
  const { part_name, found } = await partDescription(k, uid, part_number, color_id, input);

  // Only existence counts: the quantity adds up via a second acquisition.
  if (await manualPartExists(k, uid, part_number, color_id)) {
    await additionalAcquisition(k, uid, part_number, color_id, { condition, unit_price, quantity, acquiredAt });
    return { action: 'updated', part_number };
  }

  // One calculation, the same one used in the CSV import.
  const { erfassungsPreis, effectiveCondition, priceFromState, geschaetzt } = await manualPartPurchase(k, uid, {
    partNumber: part_number,
    colorId: color_id,
    unitPrice: unit_price,
    condition,
  });
  // Without a color code, the color dot in the UI would stay grey.
  const rbColorCode = await k.manualParts.rbColorHex(color_id);

  // Description applies to ALL accounts (catalog), the stock to one.
  await k.catalog.rememberPart(part_number, found?.part_name, found?.category_name);
  await k.catalog.rememberPart(part_number, input.name, input.kategorie, k.db, uid);
  await k.catalog.rememberPartColor(part_number, color_id, null, rbColorCode, found?.image_url);
  await k.catalog.rememberPartColor(part_number, color_id, color_name, color_hex, input.image, null, k.db, uid);

  // Price, condition and quantity live in the acquisition, not on the row.
  await k.inventory.manuell.createRow('part', uid, [part_number, color_id]);
  await k.inventory.bookDailyEntry('part', uid, [part_number, color_id], {
    quantity,
    price: erfassungsPreis,
    geschaetzt,
    condition: effectiveCondition,
    createdAt: acquiredAt,
  });

  // `price_from_condition`: the carried-over market price comes from the OTHER
  // condition — carried over, but flagged.
  return { action: 'added', part_number, part_name, price_from_condition: priceFromState };
}

/** Typed and looked-up kept apart: only what Rebrickable returns goes into the shared
 * catalog as verified. Without a name, the own catalog first, then Rebrickable. */
async function partDescription(
  k: PartsContext,
  uid: number,
  part_number: string,
  color_id: number,
  input: { name: string | null; kategorie: string | null; image: string | null },
) {
  let part_name = input.name;
  let image_url = input.image;
  let found: Awaited<ReturnType<Sources['lookupPart']>> | null = null;
  if (part_name) return { part_name, found };

  const hasColor = color_id !== KEINE_FARBE;
  const local = await k.catalog.catalogPart(part_number, hasColor ? color_id : null, uid);
  if (local) {
    part_name = local.name;
    image_url = image_url || local.image;
  }

  // `hatImage` instead of `image_url`: a local path would fail the URL check, but
  // still proves the fetch has nothing more to get.
  if (!part_name || !(image_url || local?.hatImage)) {
    // Without Rebrickable, the part gets logged with whatever the catalog already knows.
    const fetch = await attempts(
      'parts:lookupPart',
      k.externalSources.sources.lookupPart(part_number, hasColor ? color_id : null),
    );
    found = fetch.ok ? fetch.wert : null;
    // `||`: what the catalog already knew stays as-is.
    if (found) part_name = part_name || found.part_name;
  }
  return { part_name, found };
}

/** An already-logged part: just another acquisition; without a condition, the stock's. */
async function additionalAcquisition(
  k: PartsContext,
  uid: number,
  part_number: string,
  color_id: number,
  e: { condition: string | null; unit_price: number | null; quantity: number; acquiredAt: string | null },
) {
  const reCond =
    e.condition && ['N', 'U'].includes(e.condition)
      ? e.condition
      : await k.finances.partState(uid, part_number, color_id);
  const reEntered = e.unit_price;
  const rePrice =
    reEntered !== null ? reEntered : await k.finances.currentPartMarketPrice(part_number, color_id, uid, reCond);

  // One acquisition per day and condition (src/inventory/acquisitions.ts).
  await k.inventory.bookDailyEntry('part', uid, [part_number, color_id], {
    quantity: e.quantity,
    price: (rePrice ?? 0) > 0 ? rePrice : null,
    condition: reCond,
    createdAt: e.acquiredAt,
    geschaetzt: reEntered === null,
  });
}

/** Same path for the webapp and the app.
 * @returns the resulting quantity, if it was part of the request */
export async function changeManualPart(
  k: PartsContext,
  uid: number,
  partNumber: string,
  colorId: number,
  body: Record<string, unknown>,
): Promise<{ quantity?: number; degraded?: string[] }> {
  const existing = await k.manualParts.manualPartWithCondition(uid, partNumber, colorId);
  if (!existing) failDomain('not_found', 'part_not_manual');

  const out: { quantity?: number } = {};
  // If the market price for the new acquisition didn't arrive, `degradiert` says so.
  const ab = new Degradations();
  const wish = quantityRequest(body);
  if (wish) {
    const cond = await k.settings.conditionForPrice(undefined, existing.condition, uid);
    out.quantity = await k.inventory.adjustManualQuantity(
      'part',
      uid,
      [partNumber, colorId],
      wish,
      cond,
      () => k.finances.currentPartMarketPrice(partNumber, colorId, uid, cond),
      ab,
    );
  }
  if (body.unit_price !== undefined) {
    // The rule lives in src/finances/priceRule.ts; only the lookup and table are here.
    const { unitPrice } = await k.finances.purchasePriceFromInput(
      body.unit_price,
      body.condition,
      existing.condition,
      uid,
      condition => k.finances.currentPartMarketPrice(partNumber, colorId, uid, condition),
    );
    // Into the LATEST acquisition: there NULL means "no price known", the 0 shown
    // on display is formed by the read query.
    await k.inventory.setNewest('part', 'preis', unitPrice, uid, [partNumber, colorId]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = V0.conditionOf(body.condition);
    await k.inventory.setNewest('part', 'zustand', cond, uid, [partNumber, colorId]);
  }
  return { ...out, ...ab.detail() };
}

export async function listPartAcquisitions(
  k: PartsContext,
  uidChoice: Sicht | number[],
  partNumber: string,
  colorId: string | number,
) {
  const uid = await k.household.scopeFrom(uidChoice);
  // The VIEWPOINT: each row comes with its owner, otherwise the picker in the
  // dialog wouldn't know what it's choosing from.
  return k.manualParts.partAcquisitions(uid, partNumber, V0.colorId(colorId));
}

export function manualPartExists(
  k: PartsContext,
  uid: number,
  partNumber: string,
  colorId: number,
): Promise<{ id: number } | undefined> {
  return k.manualParts.manualPartRow(uid, partNumber, colorId);
}

/** Same pricing rule as when adding by hand; one bad row doesn't abort the rest. */
export async function importPartsCsv(k: PartsContext, uid: number, text: string) {
  const { records, cleaned, uebersprungen } = csvRowsFromRequest(text);
  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ part_number: string; action: string; error?: string }> = [];

  for (const row of cleaned) {
    const partNumber = String(row.part_number || row.Teilenummer || row.part_num || Object.values(row)[0] || '').trim();
    if (!partNumber) continue;
    const colorId = V0.colorId(row.color_id ?? row['Farb-ID']);
    const colorName = row.color_name || row.Farbe || null;
    const { quantity: qty, preis: unitPrice, recordedAt: acquiredAt, condition: rawCondition } = csvSharedFields(row);

    try {
      let partName = row.part_name || row.Name || null;
      const typed = !!partName;
      let imageUrl: string | null = null,
        categoryName: string | null = null;
      if (!partName) {
        const fetch = await attempts(
          'parts:import-lookupPart',
          k.externalSources.sources.lookupPart(partNumber, colorId === KEINE_FARBE ? null : colorId),
        );
        const info = fetch.ok ? fetch.wert : null;
        if (info) {
          partName = info.part_name;
          imageUrl = info.image_url;
          categoryName = info.category_name;
        }
      }
      const { erfassungsPreis, effectiveCondition, geschaetzt } = await manualPartPurchase(k, uid, {
        partNumber,
        colorId,
        unitPrice,
        condition: rawCondition,
      });
      const acquisition = {
        quantity: qty,
        price: erfassungsPreis,
        geschaetzt,
        condition: effectiveCondition || 'N',
        createdAt: acquiredAt || k.clock.datum().toISOString().slice(0, 10),
      };

      if (await manualPartExists(k, uid, partNumber, colorId)) {
        await k.inventory.bookDailyEntry('part', uid, [partNumber, colorId], acquisition);
        updated++;
        results.push({ part_number: partNumber, action: 'updated' });
        continue;
      }
      // Catalog before stock: better a description without stock than the other way round.
      const colorHex = await k.manualParts.rbColorHex(colorId);
      if (typed) await k.catalog.rememberPart(partNumber, partName, null, k.db, uid);
      else await k.catalog.rememberPart(partNumber, partName, categoryName);
      await k.catalog.rememberPartColor(partNumber, colorId, null, colorHex, imageUrl);
      await k.catalog.rememberPartColor(partNumber, colorId, colorName, null, null, null, k.db, uid);
      await k.inventory.manuell.createRow('part', uid, [partNumber, colorId]);
      await k.inventory.bookDailyEntry('part', uid, [partNumber, colorId], acquisition);
      added++;
      results.push({ part_number: partNumber, action: 'added' });
    } catch (e) {
      errors++;
      results.push({
        part_number: partNumber,
        action: 'error',
        error: publicError(e, 'parts-csv:row').error,
      });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
