/** Purchase price acquisitions; the rules live in src/collection/acquisitions.ts. */
import { acquisitionTotals } from '../../src/inventory';
import { Degradations } from '../../src/infra/result';
import { viewOf, guardFor } from './middleware';
import type { ErfassungsArt } from '../../src/collection';
import { vertragsRouter, type Anfrage } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

/** Without a known price the amount is missing instead of null: money has a type in the contract. */
function withoutClearAmount<T extends { amount: number | null }>(sum: T) {
  const { amount, ...rest } = sum;
  return amount === null ? rest : { ...rest, amount };
}

/** Sum in the account currency (src/inventory/acquisitions.ts), in the shape of the contract. */
async function inKontowaehrung<T extends Parameters<Services['inventory']['erfassungenInKontowaehrung']>[0][number]>(
  d: Pick<Services, 'account' | 'inventory' | 'parts' | 'minifigs' | 'collection'>,
  rows: T[],
  viewer: number,
) {
  const { acquisitions, totals } = await d.inventory.erfassungenInKontowaehrung(rows, viewer);
  return { acquisitions, totals: withoutClearAmount(totals) };
}

type Key = (pfad: Record<string, string | number>) => Array<string | number>;
/** What the three routes share: the id in the path and a contract schema (Erfassungsaenderung). */
type Erfassungsanfrage<E = unknown> = AuthedRequest & {
  pfad: Record<string, string | number> & { acqId: number };
  eingabe: E;
};
type Aenderung = Erfassungsanfrage<Anfrage<'PUT /api/v1/sets/:setNumber/acquisitions/:acqId'>['eingabe']>;

const aendern =
  (d: Pick<Services, 'account' | 'inventory' | 'parts' | 'minifigs' | 'collection'>, art: ErfassungsArt, key: Key) =>
  (req: Aenderung) =>
    d.collection.changeAcquisition(art, req.apiUser.user_id, req.pfad.acqId, key(req.pfad), req.eingabe);

const loeschen =
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
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/sets/:setNumber/acquisitions', requireToken, async req => {
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
    return { ...(await inKontowaehrung(d, rows, uid)), owner_user_id: uid };
  });
  router.endpunkt('PUT /api/v1/sets/:setNumber/acquisitions/:acqId', requireToken, aendern(d, 'set', setKey));
  router.endpunkt('DELETE /api/v1/sets/:setNumber/acquisitions/:acqId', requireToken, loeschen(d, 'set', setKey));

  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/acquisitions', requireToken, async req => {
    const rows = await d.parts.partAcquisitions(viewOf(req), req.pfad.partNumber, req.pfad.colorId);
    return { ...(await inKontowaehrung(d, rows, req.apiUser.user_id)), owner_user_id: req.apiUser.user_id };
  });
  router.endpunkt(
    'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId',
    requireToken,
    aendern(d, 'part', partKey),
  );
  router.endpunkt(
    'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId',
    requireToken,
    loeschen(d, 'part', partKey),
  );

  router.endpunkt('GET /api/v1/minifigs/:figNumber/acquisitions', requireToken, async req => {
    const rows = await d.minifigs.minifigAcquisitions(viewOf(req), req.pfad.figNumber);
    return { ...(await inKontowaehrung(d, rows, req.apiUser.user_id)), owner_user_id: req.apiUser.user_id };
  });
  router.endpunkt('PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId', requireToken, aendern(d, 'fig', minifigKey));
  router.endpunkt(
    'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId',
    requireToken,
    loeschen(d, 'fig', minifigKey),
  );
  return router;
}
