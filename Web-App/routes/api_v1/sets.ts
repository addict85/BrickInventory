/** /api/v1/sets — create, read, change and delete a set. Storage and alerts,
 * import and instructions hang beside it as routers of their own (index.ts). The work lives in src/sets/. */
import { viewOf, guardFor } from './middleware';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { fachfehler, notFound } from '../../src/infra/errorTexts';

export function buildSetsRouter(d: Pick<Services, 'household' | 'account' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  // ── Fixed paths BEFORE the paths with :setNumber ─────────────────────────────
  // Otherwise Express reads "info" or "exists" as a set number.

  router.endpunkt('GET /api/v1/sets/info/:setNumber', requireToken, async req => {
    return { ...(await d.sets.setInfoForAccount(req.apiUser.user_id, req.pfad.setNumber)) };
  });

  /** Only the scope of the asking account (own account or household). */
  router.endpunkt('GET /api/v1/sets/exists/:setNumber', requireToken, async req => {
    return d.sets.setPresent(req.apiUser.user_id, req.pfad.setNumber);
  });

  router.endpunkt('GET /api/v1/sets/barcode/:barcode', requireToken, async req => {
    const barcode = req.pfad.barcode;
    return { ...((await d.sets.setToBarcode(barcode)) ?? notFound('barcode_kein_set', { barcode })) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/parts-list', requireToken, async req => {
    return { ...(await d.sets.partListWithRework(req.pfad.setNumber)) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/minifigs-list', requireToken, async req => {
    return { ...(await d.sets.minifigsListOfSets(req.pfad.setNumber)) };
  });

  router.endpunkt('GET /api/v1/sets', requireToken, async req => {
    // Without page_size the list stays unlimited on purpose — for scripts and
    // older app versions.
    const r = await d.sets.setsLesen(viewOf(req), req.abfrage);
    return { count: r.sets.length, total: r.total, sets: r.sets, ...(r.themes ? { themes: r.themes } : {}) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/price', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const sn = req.pfad.setNumber;
    // Scope instead of own id: in a household the set often belongs to a sub-account.
    const preis = await d.sets.setPrice(uid, viewOf(req), sn);
    if (!preis) notFound('set_nicht_gefunden');
    return { ...preis };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber/price-history', requireToken, async req => {
    // The same implementation as /api/finance/price-history (src/finances/priceHistory.ts).
    const sn = req.pfad.setNumber;
    return { set_number: sn, ...(await d.sets.setPriceHistory(req.apiUser.user_id, viewOf(req), sn)) };
  });

  /** MUST come before /sets/:setNumber: otherwise Express reads "household-members"
   * as a set number. */
  router.endpunkt('GET /api/v1/sets/household-members', requireToken, async req => {
    return { members: await d.household.householdMembers(req.apiUser.user_id) };
  });

  router.endpunkt('GET /api/v1/sets/:setNumber', requireToken, async req => {
    const set = await d.sets.readSet(viewOf(req), req.pfad.setNumber);
    if (!set) notFound('set_nicht_gefunden');
    return { set };
  });

  router.endpunkt('POST /api/v1/sets', requireToken, async req => {
    const e = req.eingabe;
    // A job fetches catalog, image and market price; the response says so with `ergaenzung`.
    const r = await d.sets.setErfassen({
      requester: req.apiUser.user_id,
      ownerWish: e.owner_user_id,
      setNumber: String(e.set_number ?? ''),
      menge: e.quantity ?? 1,
      kaufpreis: e.purchase_price ?? null,
      zustand: e.condition?.toUpperCase() ?? null,
      lagerort: e.storage ?? null,
      recordedAt: e.date ?? null,
      waehrung: e.currency ?? null,
      streng: true,
    });
    const { besitzer: _owner, ...reply } = r.action === 'added' ? r : { ...r, besitzer: null };
    return { ...reply };
  });

  router.endpunkt('PUT /api/v1/sets/:setNumber', requireToken, async req => {
    const e = req.eingabe;
    if (
      e.quantity === undefined &&
      e.quantity_delta === undefined &&
      e.purchase_price === undefined &&
      e.condition === undefined
    ) {
      fachfehler('ungueltig', 'erfassung_felder');
    }
    // The response carries the total quantity AFTER the change: a decrease capped
    // at 0 yields a different number than the one sent.
    const r = await d.sets.changeSet(req.apiUser.user_id, req.pfad.setNumber, req.eingabe);
    return { ...(r || {}) };
  });

  /** By default in the whole WRITE scope. */
  router.endpunkt('DELETE /api/v1/sets/:setNumber', requireToken, async req => {
    const papierkorb = await d.sets.deleteSetFor(viewOf(req), req.pfad.setNumber);
    if (!papierkorb) notFound('set_nicht_gefunden');
    return { papierkorb };
  });

  /** The same implementation as the webapp path (src/sets/setMove.ts), so the app
   * does not get rules of its own. */
  router.endpunkt('POST /api/v1/sets/:sn/move', requireToken, async req => {
    const e = req.eingabe;
    return {
      ...(await d.sets.moveSet(
        req.apiUser.user_id,
        req.pfad.sn,
        e.from_user_id,
        e.to_user_id,
        (e.acquisition_ids ?? []).map(Number),
      )),
    };
  });
  return router;
}
