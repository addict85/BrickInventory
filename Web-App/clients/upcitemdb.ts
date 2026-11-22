/**
 * UPCitemdb: product title for an EAN (free, 100 queries per day). The
 * title is retailer text; which number in it is the set number is decided by
 * src/catalog/productTitle.ts.
 */
import type { Rebrickable } from './rebrickable';
import { reportAndDeliver } from '../src/infra/error';

export async function productTitle(
  httpsGetRobust: Rebrickable['httpsGetRobust'],
  ean13: string,
): Promise<string | null> {
  try {
    const reply = await httpsGetRobust(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(ean13)}`,
      { 'User-Agent': 'BrickInventoryManager/1.0' },
      6000,
    );
    if (reply.status !== 200) return null;
    return JSON.parse(reply.body)?.items?.[0]?.title || null;
  } catch (e) {
    // Exception: the last of several barcode sources; without an answer the EAN counts as unknown.
    return reportAndDeliver('upcitemdb:abruf', null)(e);
  }
}
