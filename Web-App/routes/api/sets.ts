/** /api/v2/sets — create, read, change and delete a set. Storage and alerts,
 * import and instructions hang beside it as routers of their own (index.ts). The work lives in src/sets/. */
import { viewOf, guardFor } from './middleware';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain, notFound } from '../../src/infra/errorTexts';

export function buildSetsRouter(d: Pick<Services, 'household' | 'account' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  // ── Fixed paths BEFORE the paths with :setNumber ─────────────────────────────
  // Otherwise Express reads "info" or "exists" as a set number.

  router.endpoint('GET /api/v2/sets/info/:setNumber', requireToken, async req => {
    return { ...(await d.sets.setInfoForAccount(req.apiUser.user_id, req.pathArgs.setNumber)) };
  });

  /** Only the scope of the asking account (own account or household). */
  router.endpoint('GET /api/v2/sets/exists/:setNumber', requireToken, async req => {
    return d.sets.setPresent(req.apiUser.user_id, req.pathArgs.setNumber);
  });

  router.endpoint('GET /api/v2/sets/barcode/:barcode', requireToken, async req => {
    const barcode = req.pathArgs.barcode;
    return { ...((await d.sets.setToBarcode(barcode)) ?? notFound('barcode_not_a_set', { barcode })) };
  });

  router.endpoint('GET /api/v2/sets/:setNumber/parts-list', requireToken, async req => {
    return { ...(await d.sets.partListWithRework(req.pathArgs.setNumber)) };
  });

  router.endpoint('GET /api/v2/sets/:setNumber/minifigs-list', requireToken, async req => {
    return { ...(await d.sets.minifigsListOfSets(req.pathArgs.setNumber)) };
  });

  router.endpoint('GET /api/v2/sets', requireToken, async req => {
    // Without page_size the list stays unlimited on purpose — for scripts and
    // older app versions.
    const r = await d.sets.readSets(viewOf(req), req.queryArgs);
    return { count: r.sets.length, total: r.total, sets: r.sets, ...(r.themes ? { themes: r.themes } : {}) };
  });

  router.endpoint('GET /api/v2/sets/:setNumber/price', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const sn = req.pathArgs.setNumber;
    // Scope instead of own id: in a household the set often belongs to a sub-account.
    const price = await d.sets.setPrice(uid, viewOf(req), sn);
    if (!price) notFound('set_not_found');
    return { ...price };
  });

  router.endpoint('GET /api/v2/sets/:setNumber/price-history', requireToken, async req => {
    // The same implementation as /api/finance/price-history (src/finances/priceHistory.ts).
    const sn = req.pathArgs.setNumber;
    return { set_number: sn, ...(await d.sets.setPriceHistory(req.apiUser.user_id, viewOf(req), sn)) };
  });

  /** MUST come before /sets/:setNumber: otherwise Express reads "household-members"
   * as a set number. */
  router.endpoint('GET /api/v2/sets/household-members', requireToken, async req => {
    return { members: await d.household.householdMembers(req.apiUser.user_id) };
  });

  router.endpoint('GET /api/v2/sets/:setNumber', requireToken, async req => {
    const set = await d.sets.readSet(viewOf(req), req.pathArgs.setNumber);
    if (!set) notFound('set_not_found');
    return { set };
  });

  router.endpoint('POST /api/v2/sets', requireToken, async req => {
    const e = req.input;
    // A job fetches catalog, image and market price; the response says so with `ergaenzung`.
    const r = await d.sets.acquireSet({
      requester: req.apiUser.user_id,
      ownerWish: e.owner_user_id,
      setNumber: String(e.set_number ?? ''),
      quantity: e.quantity ?? 1,
      purchasePrice: e.purchase_price ?? null,
      condition: e.condition?.toUpperCase() ?? null,
      storage: e.storage ?? null,
      recordedAt: e.date ?? null,
      currency: e.currency ?? null,
      strict: true,
    });
    const { owner: _owner, ...reply } = r.action === 'added' ? r : { ...r, owner: null };
    return { ...reply };
  });

  router.endpoint('PUT /api/v2/sets/:setNumber', requireToken, async req => {
    const e = req.input;
    if (
      e.quantity === undefined &&
      e.quantity_delta === undefined &&
      e.purchase_price === undefined &&
      e.condition === undefined
    ) {
      failDomain('invalid', 'acquisition_fields');
    }
    // The response carries the total quantity AFTER the change: a decrease capped
    // at 0 yields a different number than the one sent.
    const r = await d.sets.changeSet(req.apiUser.user_id, req.pathArgs.setNumber, req.input);
    return { ...(r || {}) };
  });

  /** By default in the whole WRITE scope. */
  router.endpoint('DELETE /api/v2/sets/:setNumber', requireToken, async req => {
    const trash = await d.sets.deleteSetFor(viewOf(req), req.pathArgs.setNumber);
    if (!trash) notFound('set_not_found');
    return { trash };
  });

  /** The same implementation as the webapp path (src/sets/setMove.ts), so the app
   * does not get rules of its own. */
  router.endpoint('POST /api/v2/sets/:sn/move', requireToken, async req => {
    const e = req.input;
    return {
      ...(await d.sets.moveSet(
        req.apiUser.user_id,
        req.pathArgs.sn,
        e.from_user_id,
        e.to_user_id,
        (e.acquisition_ids ?? []).map(Number),
      )),
    };
  });
  return router;
}
