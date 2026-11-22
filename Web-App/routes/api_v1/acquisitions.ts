/** Purchase price acquisitions; the rules live in src/collection/acquisitions.ts. */
import { acquisitionTotals } from '../../src/inventory';
import { Degradations } from '../../src/infra/result';
import { viewOf, guardFor } from './middleware';
import type { ErfassungsArt } from '../../src/collection';
import { contractRouter, type Request0 } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

/** Without a known price the amount is missing instead of null: money has a type in the contract. */
function withoutClearAmount<T extends { amount: number | null }>(sum: T) {
  const { amount, ...rest } = sum;
  return amount === null ? rest : { ...rest, amount };
}

/** Sum in the account currency (src/inventory/acquisitions.ts), in the shape of the contract. */
async function inAccountCurrency<
  T extends Parameters<Services['inventory']['acquisitionsInAccountCurrency']>[0][number],
>(d: Pick<Services, 'account' | 'inventory' | 'parts' | 'minifigs' | 'collection'>, rows: T[], viewer: number) {
  const { acquisitions, totals } = await d.inventory.acquisitionsInAccountCurrency(rows, viewer);
  return { acquisitions, totals: withoutClearAmount(totals) };
}

type Key = (pfad: Record<string, string | number>) => Array<string | number>;
/** What the three routes share: the id in the path and a contract schema (Erfassungsaenderung). */
type Erfassungsanfrage<E = unknown> = AuthedRequest & {
  pfad: Record<string, string | number> & { acqId: number };
  eingabe: E;
};
type Change = Erfassungsanfrage<Request0<'PUT /api/v1/sets/:setNumber/acquisitions/:acqId'>['eingabe']>;

const change =
  (d: Pick<Services, 'account' | 'inventory' | 'parts' | 'minifigs' | 'collection'>, art: ErfassungsArt, key: Key) =>
  (req: Change) =>
    d.collection.changeAcquisition(art, req.apiUser.user_id, req.pfad.acqId, key(req.pfad), req.eingabe);

const remove =
  (d: Pick<Services, 'account' | 'inventory' | 'parts' | 'minifigs' | 'collection'>, art: ErfassungsArt, key: Key) =>
  (req: Erfassungsanfrage) =>
    d.collection.deleteAcquisition(art, req.apiUser.user_id, req.pfad.acqId, key(req.pfad));
const setKey: Key = p => [String(p.setNumber)];
const partKey: Key = p => [String(p.partNumber), Number(p.colorId)];
const minifigKey: Key = p => [String(p.figNumber)];

export function buildAcquisitionsRouter(
  d: Pick<Services, 'account' | 'inventory' | 'parts' | 'minifigs' | 'collection'>,
) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v1');

  router.endpoint('GET /api/v1/sets/:setNumber/acquisitions', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // Scope: in a household the purchase prices of a set often belong to several accounts.
    // If reading fails, the app shows an empty list instead of an error page;
    // `degradiert` tells it that it is not really empty.
    const ab = new Degradations();
    const rows = await ab.orElse(
      'erfassungen',
      d.collection.setAcquisitionsForSet(viewOf(req), req.pfad.setNumber),
      null,
    );
    if (!rows) return { acquisitions: [], totals: withoutClearAmount(acquisitionTotals([])), ...ab.detail() };
    return { ...(await inAccountCurrency(d, rows, uid)), owner_user_id: uid };
  });
  router.endpoint('PUT /api/v1/sets/:setNumber/acquisitions/:acqId', requireToken, change(d, 'set', setKey));
  router.endpoint('DELETE /api/v1/sets/:setNumber/acquisitions/:acqId', requireToken, remove(d, 'set', setKey));

  router.endpoint('GET /api/v1/parts/:partNumber/:colorId/acquisitions', requireToken, async req => {
    const rows = await d.parts.partAcquisitions(viewOf(req), req.pfad.partNumber, req.pfad.colorId);
    return { ...(await inAccountCurrency(d, rows, req.apiUser.user_id)), owner_user_id: req.apiUser.user_id };
  });
  router.endpoint(
    'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId',
    requireToken,
    change(d, 'part', partKey),
  );
  router.endpoint(
    'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId',
    requireToken,
    remove(d, 'part', partKey),
  );

  router.endpoint('GET /api/v1/minifigs/:figNumber/acquisitions', requireToken, async req => {
    const rows = await d.minifigs.minifigAcquisitions(viewOf(req), req.pfad.figNumber);
    return { ...(await inAccountCurrency(d, rows, req.apiUser.user_id)), owner_user_id: req.apiUser.user_id };
  });
  router.endpoint('PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId', requireToken, change(d, 'fig', minifigKey));
  router.endpoint('DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId', requireToken, remove(d, 'fig', minifigKey));
  return router;
}
